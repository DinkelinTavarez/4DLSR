import {SplatViewer as Previous} from '../tests/fixtures/splats-v1.js';
import {SplatViewer as Current} from './splats.js';
import {imageMetrics} from './image-metrics.js';
const $=id=>document.getElementById(id),video=$('video'),q=new URLSearchParams(location.search),id=q.get('recording');
const next=()=>new Promise(r=>requestAnimationFrame(r));
function once(element,event){return new Promise((resolve,reject)=>{
 const done=()=>{clearTimeout(timer);element.removeEventListener(event,success);element.removeEventListener('error',error);};
 const success=()=>{done();resolve();},error=()=>{done();reject(new Error('Video decode failed'));};
 const timer=setTimeout(()=>{done();reject(new Error('Video loading timed out'));},15000);
 element.addEventListener(event,success,{once:true});element.addEventListener('error',error,{once:true});
});}
async function json(url){const r=await fetch(url);if(!r.ok)throw new Error(`Request failed (${r.status})`);return r.json();}
try{
 if(!id)throw new Error('Open a saved take in the multi-camera lab and choose Source-view diagnostic.');
 const loaded=once(video,'loadeddata');video.src=`/recordings/${id}/recording.webm`;await loaded;
 let quality=q.get('quality')==='preview'?'preview':'hq',list=await json(`/api/sessions/${id}/depth-index?quality=${quality}`);
 if(!list.length&&quality==='hq'){quality='preview';list=await json(`/api/sessions/${id}/depth-index`);}
 if(!list.length)throw new Error('No prepared depth exists for this angle. Open it in the single-view 3D viewer and choose Prepare full recording in 4D, then return here.');
 const explicit=q.has('t'),time=explicit?Number(q.get('t')):Math.min(video.duration-.01,list.at(-1)/1000);
 if(!Number.isFinite(time)||time<0||time>=video.duration)throw new Error('Requested time is outside this recording.');
 const available=list.filter(t=>t/1000<video.duration);
 if(!available.length)throw new Error('Prepared depth timestamps do not overlap this video.');
 const count=Math.min(8,available.length);
 const times=explicit?[time]:[...new Set(Array.from({length:count},(_,i)=>available[Math.round(i*(available.length-1)/Math.max(1,count-1))]/1000))];
 const old=new Previous($('before')),updated=new Current($('after')),side=new Current($('side'));
 const render=(viewer,depth,w,h,angle=0)=>{viewer.renderer.setPixelRatio(1);viewer.source(video);viewer.texture.needsUpdate=true;viewer.material.uniforms.aspect.value=video.videoWidth/video.videoHeight;viewer.setDepth(depth,w,h,true);viewer.reset();if(angle){const radius=-viewer.controls.target.z;viewer.camera.position.set(radius*Math.sin(angle),0,-radius+radius*Math.cos(angle));viewer.controls.update();}viewer.frame(0);viewer.renderer.setSize(640,360,false);viewer.camera.aspect=640/360;viewer.camera.updateProjectionMatrix();viewer.material.uniforms.viewportSize?.value.set(640,360);viewer.renderer.render(viewer.scene,viewer.camera);};
 const refCtx=$('reference').getContext('2d',{willReadFrequently:true});
 const copy=document.createElement('canvas');copy.width=640;copy.height=360;const ctx=copy.getContext('2d',{willReadFrequently:true}),samples=[];
 for(const t of times){
  $('result').textContent=`Checking source-view sample ${samples.length+1} / ${times.length}…`;
  if(Math.abs(video.currentTime-t)>.0001){const seeked=once(video,'seeked');video.currentTime=t;await seeked;}await next();
  const stamp=available.reduce((a,b)=>Math.abs(a-t*1000)<Math.abs(b-t*1000)?a:b);
  const response=await fetch(`/recordings/${id}/${quality==='hq'?'depth-hq':'depth'}/${stamp}.bin`);if(!response.ok)throw new Error('Prepared depth file is unavailable');
  const raw=await response.arrayBuffer(),header=new DataView(raw),w=header.getUint32(0,true),h=header.getUint32(4,true);
  if(!w||!h||raw.byteLength!==8+w*h*2)throw new Error('Prepared depth file is invalid');
  const depth=Float32Array.from(new Uint16Array(raw,8),v=>v/65535);
  refCtx.drawImage(video,0,0,640,360);const ref=refCtx.getImageData(0,0,640,360).data;
  render(old,depth,w,h);ctx.drawImage($('before'),0,0,640,360);const before=imageMetrics(ref,ctx.getImageData(0,0,640,360).data,640,360);
  render(updated,depth,w,h);ctx.drawImage($('after'),0,0,640,360);const after=imageMetrics(ref,ctx.getImageData(0,0,640,360).data,640,360);
  render(side,depth,w,h,Math.PI/4);
  samples.push({time:t,depthTimestamp:stamp,depthOffsetMs:Math.abs(stamp-t*1000),before,after});
 }
 const last=samples.at(-1),pass=samples.every(s=>(s.after.exactPixelMatch||s.after.psnr>=40)&&s.after.ssim>=.99&&s.depthOffsetMs<=33);
 const psnrValues=samples.map(s=>s.after.psnr).filter(v=>v!==null);
 const result={scope:'SOURCE VIEW ONLY. RGB is reused from the reference video. No novel-view ground truth; no claim of geometric accuracy or realism percentage.',comparisonResolution:[640,360],depthQuality:quality,
  sampledFrames:samples.length,sourceFidelityGate:pass?'PASS AT SAMPLED SOURCE FRAMES':'FAIL',thresholds:{psnrDb:40,blockSsim:.99,maxDepthOffsetMs:33},
  targetVerdict:'3D REALISM UNVERIFIED',time:last.time,before:last.before,after:last.after,
  worstSample:{psnr:psnrValues.length?Math.min(...psnrValues):null,ssim:Math.min(...samples.map(s=>s.after.ssim)),mae:Math.max(...samples.map(s=>s.after.mae))},samples};
 $('result').textContent=JSON.stringify(result,null,2);$('result').dataset.status=pass?'pass':'fail';
 $('grade').textContent=`${result.sourceFidelityGate} · ${samples.length} sampled frame(s) · 3D realism remains unverified.`;
 const link=$('download');link.href=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));link.download=`source-fidelity-${id}.json`;link.hidden=false;
}catch(error){$('grade').textContent='UNVERIFIED · no grade issued';$('result').textContent=error.message;$('result').dataset.status='error';}
