import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';

// Ephemeral processing only: camera snapshots and scene drafts stay in memory.
export function liveSceneRoutes({root,body,json,fail,isGpuBusy}){
 let current=null;
 function stop(){if(!current)return;const c=current;current=null;c.pending?.reject(fail(409,'Live draft stopped'));c.child.kill();}
 const reaper=setInterval(()=>{if(current&&Date.now()-current.touched>45000&&!current.pending)stop();},10000);reaper.unref();
 const routes=async(req,res,url)=>{
  if(!url.pathname.startsWith('/api/live-scene/'))return false;
  if(req.method!=='POST')throw fail(405,'POST required');
  const input=JSON.parse((await body(req,12*1024*1024)).toString());
  if(url.pathname==='/api/live-scene/start'){
   if(current||isGpuBusy())throw fail(409,'The GPU is busy. Stop the live draft or wait for the build to finish.');
   const python=process.env.RECONSTRUCTION_PYTHON||path.join(root,'.reconstruction-env',process.platform==='win32'?'Scripts/python.exe':'bin/python');
   const child=spawn(python,['-u',path.join(root,'scripts/live_scene.py')],{cwd:root,windowsHide:true,env:{...process.env,OMP_NUM_THREADS:'4'},stdio:['pipe','pipe','pipe']});
   const c={id:randomUUID(),child,pending:null,touched:Date.now(),output:'',error:''};current=c;
   child.stderr.on('data',d=>{c.error=(c.error+d.toString()).slice(-4000);});
   child.stdout.on('data',d=>{c.output+=d.toString();let end;while((end=c.output.indexOf('\n'))>=0){const line=c.output.slice(0,end);c.output=c.output.slice(end+1);if(!c.pending)continue;try{const result=JSON.parse(line);const p=c.pending;c.pending=null;c.touched=Date.now();result.error?p.reject(fail(422,result.error)):p.resolve(result);}catch{c.pending?.reject(fail(500,'Invalid live geometry worker response'));c.pending=null;}}});
   const failed=error=>{c.pending?.reject(fail(503,error));c.pending=null;if(current===c)current=null;};
   child.on('error',e=>failed(e.message));child.on('close',code=>failed(`Live geometry worker stopped (${code}). ${c.error.slice(-600)}`));
   json(res,{id:c.id});return true;
  }
  if(url.pathname==='/api/live-scene/stop'){if(current?.id===input.id)stop();json(res,{stopped:true});return true;}
  if(!current||input.id!==current.id)throw fail(404,'Live draft expired. Start it again.');
  if(url.pathname==='/api/live-scene/heartbeat'){current.touched=Date.now();json(res,{alive:true});return true;}
  if(url.pathname!=='/api/live-scene/update')throw fail(404,'Unknown live scene action');
  if(current.pending)throw fail(409,'A live snapshot is still processing');
  if(!Array.isArray(input.frames)||input.frames.length<2||input.frames.length>8||input.frames.some(f=>!f||!Number.isSafeInteger(f.slot)||typeof f.image!=='string'||f.image.length>1500000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(f.image))||new Set(input.frames.map(f=>f.slot)).size!==input.frames.length)throw fail(400,'Provide 2–8 distinct JPEG camera snapshots');
  if(input.maxGaussians!==undefined&&(!Number.isSafeInteger(input.maxGaussians)||input.maxGaussians<0))throw fail(400,'Invalid splat budget');
  const c=current;c.touched=Date.now();const start=Date.now();
  const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{stop();reject(fail(504,'Live draft timed out. Try fewer views or a lower resolution.'));},120000);c.pending={resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}};c.child.stdin.write(JSON.stringify({frames:input.frames,maxGaussians:input.maxGaussians||0})+'\n',error=>{if(error){c.pending?.reject(error);c.pending=null;}});});
  json(res,{...result,processingSeconds:(Date.now()-start)/1000,cameraSlots:input.frames.map(f=>f.slot)});return true;
 };
 routes.busy=()=>!!current;return routes;
}
