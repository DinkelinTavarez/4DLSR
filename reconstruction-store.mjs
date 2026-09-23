import path from 'node:path';
import fs from 'node:fs';
import {promises as f} from 'node:fs';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';

export function reconstructionRoutes({root,store,body,json,fail,fileResponse,library,isPreviewBusy=()=>false}){
 const base=path.join(root,'.reconstructions'),jobs=new Map();let launching=false;
 const python=process.env.RECONSTRUCTION_PYTHON||path.join(root,'.reconstruction-env',process.platform==='win32'?'Scripts/python.exe':'bin/python');
 const valid=id=>/^[a-f0-9-]{36}$/.test(id);
 async function read(id){
  if(!valid(id))throw fail(400,'Invalid reconstruction ID');
  const dir=path.join(base,id);let spec,status;
  try{spec=JSON.parse(await f.readFile(path.join(dir,'spec.json'),'utf8'));status=JSON.parse(await f.readFile(path.join(dir,'status.json'),'utf8'));}catch{throw fail(404,'Reconstruction not found');}
  if(status.state==='running'&&!jobs.has(id))status={...status,state:'interrupted',stage:'Service restarted; start a new reconstruction'};
  if(status.state==='complete'&&jobs.get(id)?.kind==='build')status={...status,state:'running',stage:'Archiving experiment files',progress:.995};
  const evaluation=await f.readFile(path.join(dir,'evaluation.json'),'utf8').then(JSON.parse).catch(()=>null);
  return {id,rigId:spec.rigId,created:spec.created,profile:spec.profile,mode:spec.mode,time:spec.time,surfaceGuidance:spec.surfaceGuidance===true,optimizations:spec.optimizations===true,sourceFidelity:evaluation?.summary||null,...status};
 }
 async function saveState(dir,status){await f.writeFile(path.join(dir,'status.json'),JSON.stringify(status));}
 const routes=async(req,res,url)=>{
  if(!url.pathname.startsWith('/api/reconstructions'))return false;
  const suffix=url.pathname.slice('/api/reconstructions'.length);
  if(!suffix&&req.method==='GET'){
   const items=[];for(const id of await f.readdir(base).catch(()=>[]))if(valid(id)){try{items.push(await read(id));}catch{}}
   json(res,items.sort((a,b)=>b.created.localeCompare(a.created)));return true;
  }
  if(!suffix&&req.method==='POST'){
   if(jobs.size||launching||isPreviewBusy())throw fail(409,'The GPU is busy. Stop the live draft or wait for the current reconstruction.');
   launching=true;
   try{
   const input=JSON.parse((await body(req,16384)).toString());
   if(!valid(input.rigId)||!['quick','detailed','maximum'].includes(input.profile)||!['moment','sequence'].includes(input.mode))throw fail(400,'Choose a saved take, quality level and reconstruction mode');
   if(!['stereo','multiview'].includes(input.method))throw fail(400,'Choose a supported reconstruction method');
   if(input.surfaceGuidance!==undefined&&typeof input.surfaceGuidance!=='boolean')throw fail(400,'Surface guidance must be enabled or disabled');
   if(input.optimizations!==undefined&&typeof input.optimizations!=='boolean')throw fail(400,'Optimizations must be enabled or disabled');
   if(!Number.isFinite(input.time)||input.time<0||!Number.isFinite(input.offsetMs)||Math.abs(input.offsetMs)>5000||!Number.isFinite(input.hfov)||input.hfov<40||input.hfov>110)throw fail(400,'Invalid time, alignment or field of view');
   if(!Array.isArray(input.slots)||input.slots.length<2||input.slots.length>16||new Set(input.slots).size!==input.slots.length||input.slots.some(s=>!Number.isSafeInteger(s)||s<0))throw fail(400,'Select 2–16 different camera angles');
   if(input.method==='stereo'&&input.slots.length!==2)throw fail(400,'Strict stereo needs exactly two views; choose multi-view for larger rigs');
   if(input.offsetsMs!==undefined&&(!Array.isArray(input.offsetsMs)||input.offsetsMs.length!==input.slots.length||input.offsetsMs.some(v=>!Number.isFinite(v)||Math.abs(v)>5000)))throw fail(400,'Provide one timing correction per selected view');
   if(input.maxGaussians!==undefined&&(!Number.isSafeInteger(input.maxGaussians)||input.maxGaussians<0))throw fail(400,'Splat budget must be a nonnegative whole number');
   if(!fs.existsSync(python))throw fail(503,'Reconstruction Python environment missing. Run scripts/setup-reconstruction.ps1.');
   let rig;try{rig=JSON.parse(await f.readFile(path.join(store,'.rigs',`${input.rigId}.json`),'utf8'));}catch{throw fail(404,'Saved take not found');}
   if(rig.status!=='saved')throw fail(409,'Finish saving the take first');
   const cameras=[];
   for(const slot of input.slots){
    const camera=rig.cameras.find(c=>c.slot===slot);if(!camera||!valid(camera.sessionId))throw fail(400,'Unknown camera angle');
    const session=JSON.parse(await f.readFile(path.join(store,camera.sessionId,'session.json'),'utf8'));
    if(session.status!=='saved'||session.duration<1)throw fail(409,'All selected camera videos must be saved with at least one second of footage');
    if(input.mode==='sequence'&&session.duration>120)throw fail(400,'Sequence reconstruction currently supports takes up to 120 seconds. Use a single moment for longer takes.');
    cameras.push({slot,sessionId:camera.sessionId,file:path.join(store,camera.sessionId,'recording.webm'),duration:session.duration,startRequestedMs:camera.startRequestedMs||0,recorderStartedMs:camera.recorderStartedMs,requested:camera.requested});
   }
   const id=randomUUID(),dir=path.join(base,id),spec={...input,id,created:new Date().toISOString(),cameras};
   await f.mkdir(dir,{recursive:true});await f.writeFile(path.join(dir,'spec.json'),JSON.stringify(spec));
   await saveState(dir,{state:'running',stage:'Starting reconstruction worker',progress:0});
   const log=fs.createWriteStream(path.join(dir,'worker.log'));
   const child=spawn(python,['-u',path.join(root,'scripts/reconstruct.py'),path.join(dir,'spec.json'),dir],{cwd:root,windowsHide:true,env:{...process.env,OMP_NUM_THREADS:'4'}});
   const job={child,cancelled:false,kind:'build'};jobs.set(id,job);child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
   const timer=setTimeout(()=>{job.cancelled=true;child.kill();},2*60*60*1000);timer.unref();
   child.on('error',async e=>{clearTimeout(timer);jobs.delete(id);log.end();await saveState(dir,{state:'failed',stage:'Could not launch worker',error:e.message,progress:0});});
   child.on('close',async code=>{clearTimeout(timer);log.end();let status;try{status=JSON.parse(await f.readFile(path.join(dir,'status.json'),'utf8'));}catch{}
    if(job.cancelled)await saveState(dir,{state:'cancelled',stage:'Reconstruction cancelled; source videos are preserved',progress:status?.progress||0});
    else if(status?.state!=='failed'&&status?.state!=='complete')await saveState(dir,{state:'failed',stage:'Worker stopped unexpectedly',error:`Worker exited (${code}); inspect worker.log`,progress:status?.progress||0});
    if(!job.cancelled&&status?.state==='complete'&&library){try{await library.buildComplete(id);await saveState(dir,{...status,archiveState:'archived'});}catch(error){await saveState(dir,{...status,archiveState:'needs-retry',archiveError:error.message});}}
    jobs.delete(id);
   });
   json(res,await read(id),202);return true;
   }finally{launching=false;}
  }
  const match=/^\/([a-f0-9-]{36})(?:\/(cancel|evaluate|evaluation-status\.json|evaluation\.json|comparison-\d{5}-\d+\.jpg|manifest\.json|calibration\.json|camera-\d+\.jpg|rectified\.jpg|frame-\d{5}\.splat|mesh-\d{5}\.glb|seeds-\d{5}\.ply|pretraining\.blend|geometry-blender-preview\.png|blender-geometry\.json))?$/.exec(suffix);
  if(!match)throw fail(404,'Unknown reconstruction route');
  const [,id,action]=match;const info=await read(id);
  if(!action&&req.method==='GET'){json(res,info);return true;}
  if(action==='evaluation-status.json'&&req.method==='GET'){
   let state=await f.readFile(path.join(base,id,action),'utf8').then(JSON.parse).catch(()=>({state:info.sourceFidelity?'complete':'idle'}));
   if(state.state==='running'&&!jobs.has(id))state={state:'interrupted',error:'Service restarted; run the comparison again'};
   if(state.state==='complete'&&jobs.get(id)?.kind==='evaluation')state={state:'running',stage:'Archiving comparison results',progress:.99};
   json(res,state);return true;
  }
  if(action==='evaluate'&&req.method==='POST'){
   if(info.state!=='complete')throw fail(409,'Finish the reconstruction before comparing it');
   if(jobs.size||launching||isPreviewBusy())throw fail(409,'The GPU is busy. Stop the live draft or wait for the current build or comparison.');
   if(!fs.existsSync(python))throw fail(503,'Reconstruction Python environment missing');
   launching=true;
   try{
    const dir=path.join(base,id),stateFile=path.join(dir,'evaluation-status.json');
    const state=value=>f.writeFile(stateFile,JSON.stringify(value));
    await state({state:'running',stage:'Starting full source comparison',progress:0});
    const child=spawn(python,['-u',path.join(root,'scripts/evaluate_reconstruction.py'),dir],{cwd:root,windowsHide:true,env:{...process.env,OMP_NUM_THREADS:'4'}}),job={child,cancelled:false,kind:'evaluation'};jobs.set(id,job);
    const log=fs.createWriteStream(path.join(dir,'evaluation.log'));child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
    const timer=setTimeout(()=>{job.cancelled=true;child.kill();},30*60*1000);timer.unref();
    child.on('error',error=>{state({state:'failed',error:error.message}).catch(()=>{});});
    child.on('close',async code=>{clearTimeout(timer);log.end();try{
     if(job.cancelled)await state({state:'cancelled',error:'Comparison cancelled'});
     else if(code!==0){const last=await f.readFile(stateFile,'utf8').then(JSON.parse).catch(()=>null);if(last?.state!=='failed')await state({state:'failed',error:`Comparison worker exited (${code})`});}
     else if(library)await library.buildComplete(id);
    }catch(error){await state({state:code===0?'complete':'failed',archiveError:error.message}).catch(()=>{});}finally{jobs.delete(id);}});
    json(res,{state:'running'},202);return true;
   }finally{launching=false;}
  }
  if(action==='cancel'&&req.method==='POST'){const job=jobs.get(id);if(job){job.cancelled=true;job.child.kill();}json(res,{cancelled:!!job});return true;}
  if(req.method==='GET'&&action&&action!=='cancel'){
   if(info.state!=='complete')throw fail(409,'Reconstruction is not complete');
   await fileResponse(req,res,path.join(base,id,action));return true;
  }
  throw fail(405,'Unsupported reconstruction operation');
 };
 routes.busy=()=>!!jobs.size||launching;return routes;
}
