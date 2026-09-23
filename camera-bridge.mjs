import {chromium} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {exactCameraConstraints,validCaptureMode} from './src/capture-policy.js';

// Local capture engine for browsers whose USB camera implementation fails.
// No external signaling, STUN, TURN, audio, or automatic recording.
export function cameraBridge({port,body,json,fail}){
 const sessions=new Map();let engine,contextPromise,catalogPromise;
 async function getEngine(){
  if(!engine)engine=chromium.launch({channel:'chrome',headless:true,args:['--use-fake-ui-for-media-stream']}).catch(e=>{engine=null;throw e;});
  return engine;
 }
 async function context(){if(!contextPromise)contextPromise=getEngine().then(b=>b.newContext({permissions:['camera']})).catch(e=>{contextPromise=null;throw e;});return contextPromise;}
 async function catalog(){
  if(!catalogPromise)catalogPromise=(async()=>{const page=await (await context()).newPage();await page.goto(`http://127.0.0.1:${port}/camera-bridge-host`);return page;})().catch(e=>{catalogPromise=null;throw e;});
  const page=await catalogPromise;
  return page.evaluate(async()=>{const counts={};return (await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput'&&d.deviceId).map(d=>({deviceId:d.deviceId,label:d.label,occurrence:counts[d.label]=(counts[d.label]||0)+1}));});
 }
 async function close(id){const s=sessions.get(id);if(!s)return;sessions.delete(id);await s.page?.close().catch(()=>{});}
 const reap=setInterval(()=>{for(const [id,s]of sessions)if(Date.now()-s.touched>45000)close(id);},10000);reap.unref();
 return async(req,res,url)=>{
  if(url.pathname==='/camera-bridge-host'&&req.method==='GET'){
   res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});res.end('<!doctype html><title>Local camera capture engine</title>');return true;
  }
  if(!url.pathname.startsWith('/api/camera-bridge/'))return false;
  if(url.pathname==='/api/camera-bridge/devices'&&req.method==='GET'){json(res,await catalog());return true;}
  if(req.method!=='POST')throw fail(405,'POST required');
  const data=JSON.parse((await body(req,128*1024)).toString());
  if(url.pathname==='/api/camera-bridge/open'){
   if((typeof data.deviceId!=='string'&&typeof data.label!=='string')||typeof data.offer?.sdp!=='string'||data.offer.type!=='offer')throw fail(400,'Camera identity and WebRTC offer required');
   if(data.captureMode!==undefined&&!['custom','camera-default'].includes(data.captureMode))throw fail(400,'Invalid capture mode');
   if(data.captureMode!=='camera-default'&&!validCaptureMode(data))throw fail(400,'Use positive whole-number dimensions and a positive frame rate. Fractional FPS is supported.');
   if(sessions.size>=16)throw fail(409,'Local capture capacity reached');
   const devices=await catalog();const matches=devices.filter(d=>data.deviceId?d.deviceId===data.deviceId:d.label===data.label);
   if(matches.length!==1)throw fail(400,'Camera identity changed. Find cameras again.');
   data.deviceId=matches[0].deviceId;
   if([...sessions.values()].some(s=>s.deviceId===data.deviceId))throw fail(409,'This camera is open in another tab. Disconnect it there, or wait 45 seconds after closing that tab.');
   const id=randomUUID(),s={deviceId:data.deviceId,label:matches[0].label,touched:Date.now(),page:null};sessions.set(id,s);
   try{
    const page=await (await context()).newPage();s.page=page;await page.goto(`http://127.0.0.1:${port}/camera-bridge-host`);
    const capture=page.evaluate(async({data,constraints})=>{
     let stream;
     for(let attempt=0;attempt<3;attempt++){
      try{stream=await navigator.mediaDevices.getUserMedia(constraints);break;}
      catch(e){if(e.name!=='NotReadableError'||attempt===2)throw e;await new Promise(r=>setTimeout(r,750));}
     }
     const pc=new RTCPeerConnection({iceServers:[]});
     for(const track of stream.getTracks())pc.addTrack(track,stream);
     window.capture={pc,stream};
     await pc.setRemoteDescription(data.offer);await pc.setLocalDescription(await pc.createAnswer());
     await new Promise((resolve,reject)=>{if(pc.iceGatheringState==='complete')return resolve();const timer=setTimeout(()=>reject(new Error('Local ICE gathering timed out')),10000);pc.addEventListener('icegatheringstatechange',()=>{if(pc.iceGatheringState==='complete'){clearTimeout(timer);resolve();}});});
     const sender=pc.getSenders().find(s=>s.track?.kind==='video');
     const sourceMode=stream.getVideoTracks()[0].getSettings();
     const params=sender.getParameters();if(params.encodings?.length){params.degradationPreference='maintain-resolution';params.encodings[0].maxBitrate=Math.min(0xffffffff,Math.max(1500000,Math.round(sourceMode.width*sourceMode.height*(sourceMode.frameRate||30)*.16)));params.encodings[0].scaleResolutionDownBy=1;await sender.setParameters(params).catch(()=>{});}
     const track=stream.getVideoTracks()[0],settings=track.getSettings(),caps=track.getCapabilities?.()||{};
     return {answer:pc.localDescription.toJSON(),settings:{width:settings.width,height:settings.height,frameRate:settings.frameRate},capabilities:{width:caps.width,height:caps.height,frameRate:caps.frameRate}};
    },{data,constraints:exactCameraConstraints(data)});
    let timeout;
    const result=await Promise.race([capture,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Camera did not start within 10 seconds')),10000);})]).finally(()=>clearTimeout(timeout));
    s.touched=Date.now();json(res,{id,...result});
   }catch(e){await close(id);if(/OverconstrainedError/i.test(e.name+' '+e.message))throw fail(422,`Requested mode ${data.width} × ${data.height} at ${data.frameRate} FPS is not available from this camera. No lower mode was substituted.`);throw fail(503,`Local camera capture failed: ${e.message}`);}
   return true;
  }
  if(typeof data.id!=='string')throw fail(400,'Connection ID required');
  if(url.pathname==='/api/camera-bridge/inspect'){
   const s=sessions.get(data.id);if(!s?.page)throw fail(404,'Camera connection expired');
   // Inspect the existing USB stream before WebRTC encoding. No new camera
   // connection, recording, file, or external transfer is created.
   const result=await s.page.evaluate(async()=>{
    const {pc,stream}=window.capture,track=stream.getVideoTracks()[0];
    const video=document.createElement('video');video.muted=true;video.playsInline=true;video.srcObject=stream;document.body.append(video);
    let timer;
    try{
     await Promise.race([video.play(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Source preview timed out')),3000);})]);clearTimeout(timer);
     if(!video.videoWidth)throw new Error('No source image available');
     const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;canvas.getContext('2d').drawImage(video,0,0);
     const stats=await pc.getStats(),outbound=[...stats.values()].find(r=>r.type==='outbound-rtp'&&r.kind==='video'),source=[...stats.values()].find(r=>r.type==='media-source'&&r.kind==='video');
     const settings=track.getSettings();
     return {image:canvas.toDataURL('image/jpeg',.92),at:new Date().toISOString(),source:{width:settings.width,height:settings.height,frameRate:settings.frameRate,framesPerSecond:source?.framesPerSecond,readyState:track.readyState,muted:track.muted},transport:{codec:stats.get(outbound?.codecId)?.mimeType,encoder:outbound?.encoderImplementation,framesPerSecond:outbound?.framesPerSecond,framesEncoded:outbound?.framesEncoded,qualityLimitationReason:outbound?.qualityLimitationReason}};
    }finally{clearTimeout(timer);video.pause();video.srcObject=null;video.remove();}
   });json(res,result);return true;
  }
  if(url.pathname==='/api/camera-bridge/close'){await close(data.id);json(res,{closed:true});return true;}
  if(url.pathname==='/api/camera-bridge/heartbeat'){
   const s=sessions.get(data.id);if(!s)throw fail(404,'Camera connection expired');s.touched=Date.now();json(res,{alive:true});return true;
  }
  throw fail(404,'Unknown camera bridge action');
 };
}
