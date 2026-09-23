import path from 'node:path';
import {promises as fs} from 'node:fs';
import {PLYLoader} from 'three/addons/loaders/PLYLoader.js';
import {fitScape} from './src/scape-layout.js';

const valid=id=>/^[a-f0-9-]{36}$/.test(id);
const exported=/^(manifest\.json|calibration\.json|spec\.json|evaluation\.json|camera-\d+\.jpg|comparison-\d{5}-\d+\.jpg|frame-\d{5}\.splat|mesh-\d{5}\.glb|seeds-\d{5}\.ply|pretraining\.blend|geometry-blender-preview\.png|blender-geometry\.json)$/;
async function jsonFile(file){return JSON.parse(await fs.readFile(file,'utf8'));}
async function atomic(file,value){await fs.writeFile(file+'.tmp',JSON.stringify(value,null,2));await fs.rename(file+'.tmp',file);}

export function experimentLibrary({root,store,serialized,body,json,fail,fileResponse}){
 const base=path.join(store,'Experiments'),builds=path.join(root,'.reconstructions');
 const folder=id=>path.join(base,id);
 async function copyOnce(source,target){
  await fs.mkdir(path.dirname(target),{recursive:true});
  try{const [a,b]=await Promise.all([fs.stat(source),fs.stat(target)]);if(a.size!==b.size)throw new Error(`Archive copy size mismatch: ${target}`);return;}catch(e){if(e.code!=='ENOENT')throw e;}
  // Real copies are independent: editing an exported model cannot change its source.
  await fs.copyFile(source,target+'.pending');await fs.rename(target+'.pending',target);
 }
 async function archive(rig){
  if(!valid(rig.id)||rig.status!=='saved')throw new Error('Only finalized takes can enter the experiment library');
  return serialized('experiment:'+rig.id,async()=>{
   const dir=folder(rig.id);await fs.mkdir(dir,{recursive:true});
   const originals=[];
   for(const camera of rig.cameras){
    if(!valid(camera.sessionId)||!Number.isSafeInteger(camera.slot)||camera.slot<0)throw new Error('Invalid camera archive reference');
    const relative=`originals/camera-${String(camera.slot+1).padStart(2,'0')}`,source=path.join(store,camera.sessionId);
    for(const name of ['recording.webm','session.json'])await copyOnce(path.join(source,name),path.join(dir,relative,name));
    for(const name of await fs.readdir(path.join(source,'timing')).catch(()=>[]))if(/^\d+\.json$/.test(name))await copyOnce(path.join(source,'timing',name),path.join(dir,relative,'timing',name));
    originals.push({slot:camera.slot,label:camera.label,sessionId:camera.sessionId,file:relative+'/recording.webm'});
   }
   await atomic(path.join(dir,'capture.json'),rig);
   const versions=[];
   for(const id of await fs.readdir(builds).catch(()=>[])){
    if(!valid(id))continue;
    let spec,status;try{spec=await jsonFile(path.join(builds,id,'spec.json'));status=await jsonFile(path.join(builds,id,'status.json'));}catch{continue;}
    if(spec.rigId!==rig.id||status.state!=='complete')continue;
    const source=path.join(builds,id),destination=path.join(dir,'reconstructions',id),manifest=await jsonFile(path.join(source,'manifest.json'));
    await fs.mkdir(destination,{recursive:true});
    const files=[];
    for(const name of await fs.readdir(source))if(exported.test(name)){
     if(name==='spec.json')await atomic(path.join(destination,name),{...spec,cameras:spec.cameras.map(c=>({...c,file:`../../${originals.find(o=>o.slot===c.slot).file}`}))});
     else if(name==='evaluation.json')await atomic(path.join(destination,name),await jsonFile(path.join(source,name)));
     else if(name.startsWith('comparison-')){await fs.copyFile(path.join(source,name),path.join(destination,name+'.pending'));await fs.rename(path.join(destination,name+'.pending'),path.join(destination,name));}
     else await copyOnce(path.join(source,name),path.join(destination,name));
     files.push(name);
    }
    if(manifest.frames[0]?.geometry?.seedFile){
     const scapeFile=path.join(destination,'scape-layout.json');
     try{await fs.access(scapeFile);}catch{
      const bytes=await fs.readFile(path.join(source,manifest.frames[0].geometry.seedFile)),geometry=new PLYLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
      try{const layout=fitScape(geometry.attributes.position.array);await atomic(scapeFile,{...layout,jobId:id,referenceTime:manifest.frames[0].time});}catch(error){await atomic(path.join(destination,'scape-error.json'),{error:error.message});}finally{geometry.dispose();}
     }
     try{await fs.access(scapeFile);files.push('scape-layout.json');}catch{}
    }
    const evaluation=await jsonFile(path.join(source,'evaluation.json')).catch(()=>null);
    versions.push({id,created:spec.created,profile:spec.profile,mode:spec.mode,frames:manifest.frames.length,optimizations:manifest.training?.optimizations||null,files,score:evaluation?.summary||null});
   }
   versions.sort((a,b)=>b.created.localeCompare(a.created));
   const entry={version:1,id:rig.id,name:rig.name,created:rig.created,ended:rig.ended,simulated:rig.simulated,path:dir,originals,reconstructions:versions,updated:new Date().toISOString(),state:'archived'};
   await atomic(path.join(dir,'experiment.json'),entry);
   await fs.writeFile(path.join(dir,'README.txt'),'Spatial Replay experiment\n\noriginals/: original camera videos, capture settings and timing.\ncapture.json: camera group and timing metadata.\nreconstructions/<build-id>/: one independent render version per build.\nEach frame-*.splat is a Gaussian time sample; manifest.json contains replay timing.\nmesh-*.glb and seeds-*.ply are geometry BEFORE Gaussian training.\npretraining.blend (when available) is the first sample only.\nscape-layout.json is an inferred static layout, not measured geometry.\nevaluation.json and comparison-*.jpg compare exported Gaussians with the source cameras.\nSource-view scores do not establish hidden geometry or novel-view realism.\n\nOpen this experiment from the app library to play every angle or a 3D replay.\n','utf8');
   return entry;
  });
 }
 async function sync(){const entries=[],errors=[];for(const file of await fs.readdir(path.join(store,'.rigs')).catch(()=>[]))if(/^[a-f0-9-]{36}\.json$/.test(file)){try{const rig=await jsonFile(path.join(store,'.rigs',file));if(rig.status==='saved')entries.push(await archive(rig));}catch(error){errors.push({file,error:error.message});}}return {entries,errors};}
 async function buildComplete(id){const spec=await jsonFile(path.join(builds,id,'spec.json')),rig=await jsonFile(path.join(store,'.rigs',`${spec.rigId}.json`));return archive(rig);}
 async function routes(req,res,url){
  if(!url.pathname.startsWith('/api/experiments'))return false;
  if(url.pathname==='/api/experiments'&&req.method==='GET'){
   const entries=[];for(const id of await fs.readdir(base).catch(()=>[]))if(valid(id)){try{entries.push(await jsonFile(path.join(folder(id),'experiment.json')));}catch{}}
   json(res,entries.sort((a,b)=>b.created.localeCompare(a.created)));return true;
  }
  if(url.pathname==='/api/experiments/sync'&&req.method==='POST'){json(res,await sync());return true;}
  const match=/^\/api\/experiments\/([a-f0-9-]{36})(?:\/files\/(.+))?$/.exec(url.pathname);
  if(!match||req.method!=='GET')throw fail(404,'Unknown experiment route');
  const [,id,file]=match;
  if(!file){json(res,await jsonFile(path.join(folder(id),'experiment.json')));return true;}
  const original=/^originals\/camera-\d+\/(recording\.webm|session\.json|timing\/\d+\.json)$/.test(file),build=/^reconstructions\/([a-f0-9-]{36})\/([^/]+)$/.exec(file);
  if(!['experiment.json','capture.json','README.txt'].includes(file)&&!original&&!(build&&(exported.test(build[2])||build[2]==='scape-layout.json')))throw fail(400,'Invalid experiment file');
  await fileResponse(req,res,path.join(folder(id),file));return true;
 }
 return {archive,sync,buildComplete,routes};
}
