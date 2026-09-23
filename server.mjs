import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { promises as f } from 'node:fs';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {rigRoutes} from './rig-store.mjs';
import {cameraBridge} from './camera-bridge.mjs';
import {reconstructionRoutes} from './reconstruction-store.mjs';
import {experimentLibrary} from './experiment-library.mjs';
import {labStore} from './lab-store.mjs';
import {liveSceneRoutes} from './live-scene.mjs';
import {remoteControl} from './remote-control.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8794);
const token = randomBytes(24).toString('hex');
let desktop = path.join(os.homedir(), 'Desktop');
if (!process.env.RECORDINGS_DIR && process.platform === 'win32') {
  try { desktop = execFileSync('powershell.exe', ['-NoProfile', '-Command', "[Environment]::GetFolderPath('Desktop')"], {windowsHide:true, encoding:'utf8'}).trim() || desktop; } catch {}
}
const STORE = path.resolve(process.env.RECORDINGS_DIR || path.join(desktop, 'Spatial Replay Recordings'));
const sessions = new Map();
const locks = new Map();
const snapshots = new Map();
const frameTimesCache = new Map();
const mime = {'.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.json':'application/json', '.wasm':'application/wasm', '.onnx':'application/octet-stream', '.webm':'video/webm', '.png':'image/png', '.jpg':'image/jpeg', '.glb':'model/gltf-binary', '.txt':'text/plain', '.svg':'image/svg+xml', '.bin':'application/octet-stream'};
let ffmpeg = process.env.FFMPEG || 'ffmpeg';
try { execFileSync(ffmpeg, ['-version'], {windowsHide:true, stdio:'ignore'}); } catch { ffmpeg = null; }
const json = (res, data, status=200) => { res.writeHead(status, {'Content-Type':'application/json', 'Cache-Control':'no-store'}); res.end(JSON.stringify(data)); };
const fail = (status, message) => Object.assign(new Error(message), {status});
async function body(req, max=32*1024*1024) {
  const chunks=[]; let size=0;
  for await (const chunk of req) { size+=chunk.length; if(size>max) throw fail(413,'Upload is too large'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function save(s) {
  const file=path.join(STORE,s.id,'session.json');
  await f.writeFile(file+'.tmp',JSON.stringify(s,null,2)); await f.rename(file+'.tmp',file);
}
async function session(id) {
  if(!/^[a-f0-9-]{36}$/.test(id)) throw fail(400,'Invalid recording ID');
  if(sessions.has(id)) return sessions.get(id);
  try { const s=JSON.parse(await f.readFile(path.join(STORE,id,'session.json'),'utf8')); sessions.set(id,s); return s; }
  catch { throw fail(404,'Recording not found'); }
}
async function serialized(id, fn) {
  const previous=locks.get(id)||Promise.resolve();
  const task=previous.catch(()=>{}).then(fn); locks.set(id,task);
  try{return await task;} finally{if(locks.get(id)===task)locks.delete(id);}
}
async function fileResponse(req,res,file) {
  const stat=await f.stat(file); if(!stat.isFile())throw fail(404,'Not a file');
  let start=0,end=stat.size-1,status=200;
  if(req.headers.range) {
    const m=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
    if(!m || +m[1]>=stat.size) {res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});return res.end();}
    start=+m[1];end=m[2]?Math.min(+m[2],end):end;
    if(end<start)throw fail(416,'Invalid range');status=206;
  }
  const headers={'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Length':end-start+1,'Accept-Ranges':'bytes','Cache-Control':file.includes('models')?'public, max-age=86400':'no-cache'};
  if(status===206)headers['Content-Range']=`bytes ${start}-${end}/${stat.size}`;
  res.writeHead(status,headers);
  if(req.method==='HEAD')return res.end();
  const stream=fs.createReadStream(file,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
}
async function snapshot(s, final=false) {
  if(snapshots.has(s.id))return snapshots.get(s.id);
  const work=(async()=>{
    if(!ffmpeg)throw fail(503,'FFmpeg was not found. Install FFmpeg and restart the app.');
    if(s.bytes<1024)throw fail(409,'Record a few seconds first');
    const dir=path.join(STORE,s.id), name=final?'recording.webm':`replay-${s.chunks}.webm`;
    if(final && s.status==='saved' && fs.existsSync(path.join(dir,name)))return {url:`/recordings/${s.id}/${name}`,name};
    if(!final && fs.existsSync(path.join(dir,name)))return {url:`/recordings/${s.id}/${name}`,name};
    const part=path.join(dir,`${name}.partial.webm`);
    // Copy a byte-consistent prefix; do not chase a file that is still growing.
    const input=path.join(dir,'snapshot-input.webm');
    await new Promise((resolve,reject)=>{const a=fs.createReadStream(path.join(dir,'capture.webm'),{end:s.bytes-1}),b=fs.createWriteStream(input);a.on('error',reject);b.on('error',reject);b.on('finish',resolve);a.pipe(b);});
    await new Promise((resolve,reject)=>{
      const p=spawn(ffmpeg,['-hide_banner','-loglevel','error','-y','-i',input,'-map','0:v:0','-c','copy',part],{windowsHide:true});
      let stderr='';p.stderr.on('data',d=>stderr+=d.toString().slice(0,2000));
      const timer=setTimeout(()=>{p.kill();reject(fail(504,'Playback indexing timed out'));},120000);
      p.on('error',e=>{clearTimeout(timer);reject(e);});p.on('close',code=>{clearTimeout(timer);code===0?resolve():reject(fail(500,`Could not index recording: ${stderr}`));});
    });
    await f.rename(part,path.join(dir,name));await f.unlink(input).catch(()=>{});
    // Preserve the current and preceding live snapshots so an open player remains usable.
    const old=(await f.readdir(dir)).filter(n=>/^replay-\d+\.webm$/.test(n)).sort((a,b)=>Number(b.slice(7,-5))-Number(a.slice(7,-5)));
    for(const stale of old.slice(2))await f.unlink(path.join(dir,stale)).catch(()=>{});
    return {url:`/recordings/${s.id}/${name}`,name};
  })();snapshots.set(s.id,work);try{return await work;}finally{snapshots.delete(s.id);}
}

const library=experimentLibrary({root:ROOT,store:STORE,serialized,body,json,fail,fileResponse});
const lab=labStore({store:STORE,root:ROOT,body,json,fail,serialized});
const handleRig=rigRoutes({store:STORE,body,json,fail,session,save,sessions,serialized,library,lab});
const handleCameraBridge=cameraBridge({port:PORT,body,json,fail});
let handleLiveScene;
const handleReconstruction=reconstructionRoutes({root:ROOT,store:STORE,body,json,fail,fileResponse,library,isPreviewBusy:()=>handleLiveScene?.busy()});
handleLiveScene=liveSceneRoutes({root:ROOT,body,json,fail,isGpuBusy:()=>handleReconstruction.busy()});
const handleRemote=remoteControl({body,json,fail});
const server=http.createServer(async(req,res)=>{
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  const hosts=[`127.0.0.1:${PORT}`,`localhost:${PORT}`];
  try{
    if(!hosts.includes(req.headers.host))throw fail(403,'Local access only');
    if(req.headers.origin && !hosts.map(h=>'http://'+h).includes(req.headers.origin))throw fail(403,'Origin denied');
    if(req.headers['sec-fetch-site']==='cross-site')throw fail(403,'Cross-site access denied');
    const url=new URL(req.url,'http://127.0.0.1'),p=url.pathname;
    if(req.method==='POST' && req.headers['x-spatial-token']!==token)throw fail(403,'Invalid session token');
    if(p==='/api/config')return json(res,{token,recordingsDir:STORE,ffmpeg:!!ffmpeg});
    if(await handleRemote(req,res,url))return;
    if(await handleCameraBridge(req,res,url))return;
    if(await handleLiveScene(req,res,url))return;
    if(await lab.routes(req,res,url))return;
    if(await library.routes(req,res,url))return;
    if(await handleReconstruction(req,res,url))return;
    if(p.startsWith('/api/rigs')&&await handleRig(req,res,url))return;
    if(p==='/api/sessions' && req.method==='GET'){
      const items=[];
      for(const id of await f.readdir(STORE).catch(()=>[])) {
        if(!/^[a-f0-9-]{36}$/.test(id))continue;
        try{items.push(await session(id));}catch{}
      }
      return json(res,items.sort((a,b)=>b.created.localeCompare(a.created)));
    }
    if(p==='/api/sessions' && req.method==='POST'){
      const input=JSON.parse((await body(req,8192)).toString());
      const s={id:randomUUID(),name:String(input.name||'Camera recording').slice(0,80),created:new Date().toISOString(),status:'recording',chunks:0,bytes:0,duration:0,depthFrames:0,width:Number(input.width)||1280,height:Number(input.height)||720,mime:'video/webm'};
      await f.mkdir(path.join(STORE,s.id,'depth'),{recursive:true});await f.writeFile(path.join(STORE,s.id,'capture.webm'),Buffer.alloc(0));
      sessions.set(s.id,s);await save(s);return json(res,s,201);
    }
    const route=/^\/api\/sessions\/([a-f0-9-]+)\/(chunk|snapshot|stop|depth|depth-index|frame-times)$/.exec(p);
    if(route){
      const s=await session(route[1]);
      const depthFolder=url.searchParams.get('quality')==='hq'?'depth-hq':'depth';
      if(route[2]==='depth-index' && req.method==='GET')return json(res,(await f.readdir(path.join(STORE,s.id,depthFolder)).catch(()=>[])).filter(n=>/^\d+\.bin$/.test(n)).map(n=>Number(n.slice(0,-4))).sort((a,b)=>a-b));
      if(route[2]==='frame-times' && req.method==='GET'){
        if(s.status==='recording')throw fail(409,'Finish recording before preparing every frame');
        if(!frameTimesCache.has(s.id)){
          const ffprobe=process.env.FFPROBE||'ffprobe';
          const times=await new Promise((resolve,reject)=>{const child=spawn(ffprobe,['-v','error','-select_streams','v:0','-show_entries','frame=best_effort_timestamp_time','-of','csv=p=0',path.join(STORE,s.id,'recording.webm')],{windowsHide:true});let output='',err='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>err+=d);child.on('error',reject);child.on('close',code=>code===0?resolve(output.trim().split(/\r?\n/).filter(Boolean).map(Number).filter(Number.isFinite)):reject(fail(500,err||'Frame inspection failed')));});frameTimesCache.set(s.id,times);
        }
        return json(res,frameTimesCache.get(s.id));
      }
      if(req.method!=='POST')throw fail(405,'POST required');
      if(route[2]==='snapshot')return json(res,await serialized(s.id,()=>snapshot(s,s.status!=='recording')));
      if(route[2]==='chunk'){
        const data=await body(req);
        return json(res,await serialized(s.id,async()=>{
          const seq=Number(url.searchParams.get('seq'));
          if(!Number.isInteger(seq)||seq<0)throw fail(400,'Invalid chunk number');
          if(seq<s.chunks)return {ok:true,duplicate:true,chunks:s.chunks};
          if(s.status!=='recording')throw fail(409,'Recording is closed');
          if(seq!==s.chunks)throw fail(409,'Out of order chunk');
          const file=await f.open(path.join(STORE,s.id,'capture.webm'),'a');
          try{await file.writeFile(data);await file.sync();}finally{await file.close();}
          s.bytes+=data.length;s.chunks++;s.duration=Math.max(s.duration,Number(url.searchParams.get('time'))||0);await save(s);return {ok:true,chunks:s.chunks,bytes:s.bytes};
        }));
      }
      if(route[2]==='depth'){
        const ms=Number(url.searchParams.get('ms'));if(!Number.isSafeInteger(ms)||ms<0||ms>31536000000)throw fail(400,'Invalid depth timestamp');
        const data=await body(req,1024*1024);
        if(data.length<8)throw fail(400,'Depth data missing');
        const w=data.readUInt32LE(0),h=data.readUInt32LE(4);
        if(!w||!h||w>1024||h>1024||data.length!==8+w*h*2)throw fail(400,'Invalid depth dimensions');
        return json(res,await serialized(s.id,async()=>{await f.mkdir(path.join(STORE,s.id,depthFolder),{recursive:true});const dest=path.join(STORE,s.id,depthFolder,`${ms}.bin`),exists=fs.existsSync(dest);await f.writeFile(dest,data);if(!exists){if(depthFolder==='depth-hq')s.hqDepthFrames=(s.hqDepthFrames||0)+1;else s.depthFrames++;}await save(s);return {ok:true};}));
      }
      if(route[2]==='stop')return json(res,await serialized(s.id,async()=>{const playback=await snapshot(s,true);s.status='saved';s.ended=new Date().toISOString();await save(s);return {...s,...playback};}));
    }
    if(p.startsWith('/recordings/')){
      const m=/^\/recordings\/([a-f0-9-]{36})\/(recording\.webm|capture\.webm|replay-\d+\.webm|depth(?:-hq)?\/\d+\.bin)$/.exec(p);
      if(!m)throw fail(404,'Not found');return await fileResponse(req,res,path.join(STORE,m[1],m[2]));
    }
    if(req.method!=='GET'&&req.method!=='HEAD')throw fail(405,'Method not allowed');
    const target=path.resolve(ROOT,'dist','.'+decodeURIComponent(p==='/'?(url.searchParams.has('recording')?'/index.html':'/rig.html'):p));
    if(!target.startsWith(path.join(ROOT,'dist')+path.sep))throw fail(403,'Invalid path');
    await fileResponse(req,res,target);
  }catch(e){if(!res.headersSent)json(res,{error:e.code==='ENOENT'?'File not found':e.message},e.status||(e.code==='ENOENT'?404:500));else res.destroy();}
});
// A crashed browser/server leaves the original recording intact and recoverable.
for(const id of await f.readdir(STORE).catch(()=>[])){
  try{const s=await session(id);if(s.status==='recording'){s.status='interrupted';s.bytes=(await f.stat(path.join(STORE,s.id,'capture.webm'))).size;await save(s);}}catch{}
}
server.listen(PORT,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${PORT}`,recordings:STORE,ffmpeg:!!ffmpeg})));
