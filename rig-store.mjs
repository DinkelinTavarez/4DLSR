import path from 'node:path';
import {promises as fs} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {auditRig} from './rig-quality.mjs';
import {validCaptureMode} from './src/capture-policy.js';

// Recording groups retain independent, recoverable camera streams. No calibration
// or hardware synchronization is implied by a common browser clock.
export function rigRoutes({store,body,json,fail,session,save,sessions,serialized,library,lab}) {
  const root=path.join(store,'.rigs');
  const audits=new Map();
  const validId=id=>/^[a-f0-9-]{36}$/.test(id);
  const finite=(n,min,max)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
  async function write(rig){await fs.mkdir(root,{recursive:true});const file=path.join(root,`${rig.id}.json`);await fs.writeFile(file+'.tmp',JSON.stringify(rig,null,2));await fs.rename(file+'.tmp',file);}
  async function read(id){if(!validId(id))throw fail(400,'Invalid capture group');try{return JSON.parse(await fs.readFile(path.join(root,`${id}.json`),'utf8'));}catch{throw fail(404,'Capture group not found');}}
  async function expanded(rig){const cameras=await Promise.all(rig.cameras.map(async c=>({...c,recording:await session(c.sessionId)})));return {...rig,status:cameras.every(c=>c.recording.status==='saved')?(rig.status==='saved'?'saved':'needs-finalization'):cameras.some(c=>c.recording.status==='recording')?'recording':'interrupted',cameras};}
  return async(req,res,url)=>{
    const p=url.pathname;
    if(p==='/api/rigs'&&req.method==='GET'){
      const names=await fs.readdir(root).catch(()=>[]),items=[];
      for(const name of names.filter(n=>/^[a-f0-9-]{36}\.json$/.test(n))){try{items.push(await expanded(await read(name.slice(0,-5))));}catch{}}
      json(res,items.sort((a,b)=>b.created.localeCompare(a.created)));return true;
    }
    if(p==='/api/rigs'&&req.method==='POST'){
      const input=JSON.parse((await body(req,1024*1024)).toString());
      if(!input||!Array.isArray(input.cameras)||input.cameras.length<1)throw fail(400,'Choose at least one camera');
      const slots=new Set(),devices=new Set();
      for(const c of input.cameras){if(!c||!Number.isSafeInteger(c.slot)||c.slot<0||slots.has(c.slot)||typeof c.deviceId!=='string'||!c.deviceId||c.deviceId.length>512||devices.has(c.deviceId)||!validCaptureMode(c))throw fail(400,'Each camera needs a unique slot and device with valid capture settings');if(c.requested&&!validCaptureMode(c.requested))throw fail(400,'Invalid requested capture settings');slots.add(c.slot);devices.add(c.deviceId);}
      if(!finite(input.clockOriginUnixMs,0,1e15))throw fail(400,'Capture clock missing');
      const context=await lab.captureContext(input.context);
      const rig={id:randomUUID(),name:String(input.name||'Multi-camera take').slice(0,100),created:new Date().toISOString(),status:'recording',simulated:input.simulated===true,timebase:{kind:'browser-monotonic',originUnixMs:input.clockOriginUnixMs,exposureSynchronized:false},calibration:null,reconstruction:null,cameras:[],markers:[]};
      rig.context=context;
      for(const c of input.cameras){
        const s={id:randomUUID(),rigId:rig.id,cameraSlot:c.slot,name:`${rig.name} · ${String(c.label||`Camera ${c.slot+1}`).slice(0,50)}`,created:rig.created,status:'recording',chunks:0,bytes:0,duration:0,depthFrames:0,width:c.width,height:c.height,frameRate:c.frameRate,mime:'video/webm'};
        await fs.mkdir(path.join(store,s.id,'depth'),{recursive:true});await fs.writeFile(path.join(store,s.id,'capture.webm'),Buffer.alloc(0));sessions.set(s.id,s);await save(s);
        rig.cameras.push({slot:c.slot,label:String(c.label||`Camera ${c.slot+1}`).slice(0,50),deviceLabel:String(c.deviceLabel||'Camera').slice(0,200),deviceId:c.deviceId,sessionId:s.id,settings:{width:c.width,height:c.height,frameRate:c.frameRate},requested:c.requested||null,timingChunks:0,timingSamples:0});
        await write(rig);
      }
      json(res,rig,201);return true;
    }
    const route=/^\/api\/rigs\/([a-f0-9-]{36})(?:\/(timing|finish|manifest|quality))?$/.exec(p);
    if(!route)return false;
    const id=route[1];
    if(req.method==='GET'&&!route[2]){json(res,await expanded(await read(id)));return true;}
    if(req.method==='GET'&&route[2]==='manifest'){res.setHeader('Content-Disposition',`attachment; filename="capture-${id}.json"`);json(res,await expanded(await read(id)));return true;}
    if(req.method==='GET'&&route[2]==='quality'){
      const rig=await expanded(await read(id));
      if(rig.status!=='saved')throw fail(409,'Save or recover every camera before assessment');
      if(!audits.has(id)){const work=auditRig(rig,store);audits.set(id,work);work.finally(()=>audits.delete(id)).catch(()=>{});}
      const result=await audits.get(id);json(res,result);return true;
    }
    if(req.method!=='POST')throw fail(405,'POST required');
    const input=JSON.parse((await body(req,1024*1024)).toString());
    const result=await serialized(`rig:${id}`,async()=>{
      const rig=await read(id);
      if(route[2]==='timing'){
        const c=rig.cameras.find(c=>c.slot===input.slot);
        if(!c||!Number.isSafeInteger(input.seq)||input.seq<0)throw fail(400,'Invalid timing sequence');
        if(input.seq<c.timingChunks)return {ok:true,duplicate:true};
        if(input.seq!==c.timingChunks)throw fail(409,'Out of order timing data');
        if(rig.status==='saved')throw fail(409,'Capture group is closed');
        if(!Array.isArray(input.samples)||input.samples.length>10000||input.samples.some(s=>!Array.isArray(s)||s.length!==3||!s.every(v=>finite(v,0,1e12))))throw fail(400,'Invalid observed frame timestamps');
        // One atomic file per batch makes retries safe even after a process crash.
        const dir=path.join(store,c.sessionId,'timing');await fs.mkdir(dir,{recursive:true});
        const file=path.join(dir,`${input.seq}.json`);await fs.writeFile(file+'.tmp',JSON.stringify(input.samples));await fs.rename(file+'.tmp',file);
        c.timingChunks++;c.timingSamples+=input.samples.length;await write(rig);return {ok:true};
      }
      if(route[2]==='finish'){
        if(rig.status==='saved'){await archive(rig);return await expanded(rig);}
        const recordings=await Promise.all(rig.cameras.map(c=>session(c.sessionId)));
        if(recordings.some(s=>s.status!=='saved'))throw fail(409,'Save or recover every camera stream first');
        if(!Array.isArray(input.cameras)||input.cameras.length!==rig.cameras.length||new Set(input.cameras.map(c=>c.slot)).size!==rig.cameras.length)throw fail(400,'Camera timing summary missing');
        for(const summary of input.cameras){const c=rig.cameras.find(c=>c.slot===summary.slot);if(!c||!finite(summary.startRequestedMs,0,1e9)||!finite(summary.stopRequestedMs,summary.startRequestedMs,1e9))throw fail(400,'Invalid camera start/stop timing');c.startRequestedMs=summary.startRequestedMs;c.stopRequestedMs=summary.stopRequestedMs;c.recorderStartedMs=finite(summary.recorderStartedMs,0,1e9)?summary.recorderStartedMs:null;c.observedFrames=Number.isSafeInteger(summary.observedFrames)&&summary.observedFrames>=0?summary.observedFrames:0;c.timingRecovered=summary.timingRecovered===true;}
        if(!Array.isArray(input.markers)||input.markers.length>1000||input.markers.some(m=>!finite(m.ms,0,1e9)))throw fail(400,'Invalid sync markers');
        rig.markers=input.markers.map(m=>({ms:m.ms,label:String(m.label||'Visual sync cue').slice(0,80)}));rig.status='saved';rig.ended=new Date().toISOString();await write(rig);await archive(rig);return await expanded(rig);
      }
      throw fail(404,'Capture operation not found');
    });json(res,result);return true;
  };
  async function archive(rig){if(!library)return;try{const entry=await library.archive(rig);rig.library={state:'archived',path:entry.path};}catch(error){rig.library={state:'needs-retry',error:error.message};}await write(rig);}
}
