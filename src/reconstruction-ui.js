import {CombinedViewer} from './combined-viewer.js';
import {reconstructionScoreUI} from './reconstruction-score-ui.js';

export function reconstructionUI({api,post,report,onSourcePlayback,onScenePlayback=()=>{},beforeBuild=async()=>{}}){
 const $=id=>document.getElementById(id);let take,sceneTake,active,viewer,manifest,frame=0,playing=false,loading=false,lastFrame=0,version=0,openVersion=0,frameCache=new Map();
 let starting=false,pollTimer;
 const notify=(state,extra={})=>document.dispatchEvent(new CustomEvent('reconstruction-state',{detail:{state,take,...extra}}));
 let viewMode='gaussians',scapePromise=null,scapeLayout=null,scapeURL=null;
 const panel=$('reconstruction');
 const scoreUI=reconstructionScoreUI({api,post,report});
 function setPlaying(value){playing=value;$('combined-play').textContent=value?'Pause 3D replay':'Play 3D replay';}
 function representation(){return viewMode==='model'?$('combined-representation').value:viewMode;}
 function scapeOptions(){return {assumptions:$('combined-scape-assumptions').checked,ceiling:$('combined-scape-ceiling').checked,cutaway:$('combined-scape-cutaway').checked};}
 function modeUI(){
  for(const mode of ['gaussians','model','scape'])$('combined-mode-'+mode).setAttribute('aria-pressed',String(viewMode===mode));
  $('combined-model-options').hidden=viewMode!=='model';$('combined-scape-options').hidden=viewMode!=='scape';
  if(!manifest)return;
  const still=manifest.frames.length<2,scape=viewMode==='scape';
  for(const id of ['combined-play','combined-time','combined-restart'])$(id).disabled=still||scape;
  $('combined-build-replay').hidden=!still||scape;
  const duration=manifest.frames.at(-1).time-manifest.frames[0].time,cadence=duration>0?(manifest.frames.length-1)/duration:0;
  $('combined-playback-status').textContent=scape?`Static layout from ${manifest.frames[0].time.toFixed(2)} s. Switch to Full GSP or 3D Model to resume the replay at the same time.`:!still?`Playable 3D replay · ${cadence.toFixed(0)} reconstructed samples/s · you can fly while it plays. Original camera videos play at their recorded frame rate.`:`Still frame at ${manifest.frames[0].time.toFixed(2)} s. Build a full 3D replay to animate it, or play the original videos now.`;
 }
 async function refresh(){
  const items=await api('/api/reconstructions');$('reconstruction-jobs').replaceChildren();
  for(const job of items.filter(j=>!take||j.rigId===take.id)){
   const row=document.createElement('div');row.className='take-row';row.dataset.jobId=job.id;const label=document.createElement('span');label.textContent=`${job.profile} · ${job.surfaceGuidance?'surface-guided · ':''}${job.mode} · ${job.state} · ${job.stage}${job.optimizations?' · optimized':''}${job.sourceFidelity?' · source score '+job.sourceFidelity.sourceViewScore.toFixed(1)+'/100':''}`;row.append(label);
   if(job.state==='complete'){const button=document.createElement('button');button.textContent='Open combined 3D';button.onclick=()=>open(job.id).catch(report);row.append(button);}
   if(job.state==='running'){const button=document.createElement('button');button.textContent='Show build progress';button.onclick=()=>{active=job;notify('running');clearTimeout(pollTimer);$('reconstruction-start').disabled=true;$('reconstruction-cancel').disabled=false;poll().catch(report);};row.append(button);}
   if(job.error){const message=document.createElement('p');message.textContent=job.error;row.append(message);}
   if(job.archiveError){const message=document.createElement('p');message.textContent=`3D build saved, but experiment archive needs repair: ${job.archiveError}. Use Refresh / repair archive.`;row.append(message);}
   $('reconstruction-jobs').append(row);
  }
 }
 async function select(item){if(active||starting)throw new Error('Wait for processing to finish or cancel the current build first.');setPlaying(false);take=item;$('combined-result').hidden=true;notify('selected');panel.hidden=false;document.dispatchEvent(new CustomEvent('lab-show',{detail:'reconstruct'}));$('reconstruction-title').textContent=`Combined reconstruction · ${item.name}`;
  for(const [id,index]of [['reconstruction-a',0],['reconstruction-b',1]]){$(id).replaceChildren(...item.cameras.map(c=>new Option(c.label,String(c.slot))));if(item.cameras[index])$(id).value=String(item.cameras[index].slot);}
  const selection=$('reconstruction-views');selection.replaceChildren();for(const camera of item.cameras){const row=document.createElement('div'),label=document.createElement('label'),check=document.createElement('input'),delay=document.createElement('input');check.type='checkbox';check.checked=true;check.value=String(camera.slot);check.dataset.cameraSlot=String(camera.slot);label.append(check,document.createTextNode(camera.label));delay.type='number';delay.min='-5000';delay.max='5000';delay.value='0';delay.step='10';delay.dataset.offsetSlot=String(camera.slot);delay.setAttribute('aria-label',camera.label+' timing correction in milliseconds');row.append(label,delay,document.createTextNode('ms correction'));selection.append(row);}updateBudget();
  $('reconstruction-start').disabled=item.cameras.length<2;$('reconstruction-time').max=String(Math.min(...item.cameras.map(c=>c.recording.duration)));await refresh();panel.scrollIntoView({behavior:'smooth'});
 }
 async function start(options={}){
  if(!take||active||starting)return;
  starting=true;$('reconstruction-start').disabled=true;notify('running');
  try{
   if(options.profile)$('reconstruction-profile').value=options.profile;
   if(options.mode)$('reconstruction-mode').value=options.mode;
   if(options.maxGaussians!==undefined)$('reconstruction-splat-limit').value=String(options.maxGaussians);
   const maxGaussians=Number($('reconstruction-splat-limit').value);
   if(!Number.isSafeInteger(maxGaussians)||maxGaussians<0)throw new Error('Splat budget must be a whole number; use 0 for all available.');
   await beforeBuild();
   active=await post('/api/reconstructions',{rigId:take.id,slots:selectedSlots(),offsetsMs:selectedSlots().map(slot=>Number(panel.querySelector(`[data-offset-slot="${slot}"]`).value)),profile:$('reconstruction-profile').value,mode:$('reconstruction-mode').value,method:$('reconstruction-method').value,surfaceGuidance:$('reconstruction-surfaces').checked,optimizations:$('reconstruction-optimize').checked,maxGaussians,time:Number($('reconstruction-time').value),offsetMs:Number($('reconstruction-offset').value),hfov:Number($('reconstruction-fov').value)});
   $('reconstruction-cancel').disabled=false;updateBudget();await poll();
  }catch(e){$('reconstruction-start').disabled=false;$('reconstruction-status').textContent='Processing failed: '+e.message;notify('failed',{error:e.message});throw e;}
  finally{starting=false;}
 }
 async function poll(){
  if(!active)return;const id=active.id;
  let job;try{job=await api(`/api/reconstructions/${id}`);}catch(error){$('reconstruction-status').textContent='Connection interrupted; checking processing again…';pollTimer=setTimeout(()=>poll().catch(report),3000);return;}
  if(active?.id!==id)return;
  $('reconstruction-status').textContent=`${Math.round(job.progress*100)}% · ${job.stage}${job.error?' · '+job.error:''}`;$('reconstruction-progress').value=job.progress;
  if(job.state==='running'){pollTimer=setTimeout(()=>poll().catch(report),1500);return;}
  active=null;$('reconstruction-start').disabled=false;$('reconstruction-cancel').disabled=true;await refresh();
  if(job.state==='complete'){await open(job.id);document.dispatchEvent(new Event('experiment-library-changed'));}
  else notify(job.state,{error:job.error||job.stage});
 }
 function frameBytes(index,representation){const scene=manifest,cache=frameCache,f=scene.frames[index],file=representation==='gaussians'?f.file:representation==='seeds'?f.geometry?.seedFile:f.geometry?.meshFile;if(!file)throw new Error('This build did not save geometry before Gaussian training. Make a new build to inspect it.');if(cache.has(file))return cache.get(file);const pending=fetch(`/api/reconstructions/${scene.id}/${file}`).then(response=>{if(!response.ok)throw new Error('Could not load the selected scene representation');return response.arrayBuffer();}).catch(error=>{cache.delete(file);throw error;});cache.set(file,pending);while(cache.size>4)cache.delete(cache.keys().next().value);return pending;}
 function getScape(){
  if(scapePromise)return scapePromise;
  const scene=manifest;
  const pending=frameBytes(0,'seeds').then(buffer=>new Promise((resolve,reject)=>{
   const worker=new Worker(new URL('./scape.worker.js',import.meta.url),{type:'module'});
   const finish=(error,layout)=>{clearTimeout(timeout);worker.terminate();error?reject(error):resolve({...layout,jobId:scene.id,referenceTime:scene.frames[0].time});};
   const timeout=setTimeout(()=>finish(new Error('Scape fitting timed out. Try another completed build.')),15000);
   worker.onmessage=({data})=>finish(data.error?new Error(data.error):null,data.layout);
   worker.onerror=()=>finish(new Error('Scape fitting could not run in this browser.'));
   const copy=buffer.slice(0);worker.postMessage(copy,[copy]);
  })).catch(error=>{if(scapePromise===pending)scapePromise=null;throw error;});
  scapePromise=pending;return pending;
 }
 function geometryInfo(f,representation){
  const g=f.geometry,root=`/api/reconstructions/${manifest.id}/`;
  for(const [id,file]of [['combined-mesh-download',g?.meshFile],['combined-seeds-download',g?.seedFile],['combined-blender-download',manifest.blender?.file]]){const link=$(id);link.hidden=!file||viewMode!=='model';if(file){link.href=root+file;link.download=file;}}
  $('combined-blender-download').textContent=manifest.blender?.file?`Blender model · ${manifest.blender.time.toFixed(2)} s (.blend)`:'Blender model (.blend)';
  $('combined-frame-model').disabled=representation==='gaussians';
  if(representation==='scape'&&scapeLayout){
   const fitted=scapeLayout.surfaces.filter(p=>p.evidence==='fitted').length,assumed=scapeLayout.surfaces.length-fitted;
   $('combined-geometry-status').textContent=`${fitted} fitted planes (teal) · ${assumed} assumed boundaries (amber, dashed). Flat shapes in 3D; floor/wall labels, rectangular extents and hidden areas are inferred. Relative scale, not a measured room. Grid divisions are not meters.`;
   if(!scapeURL){scapeURL=URL.createObjectURL(new Blob([JSON.stringify(scapeLayout,null,2)],{type:'application/json'}));$('combined-scape-download').href=scapeURL;$('combined-scape-download').hidden=false;}
  }else $('combined-geometry-status').textContent=!g?'This older build has no saved pre-training geometry. Create a new build to use 3D Model and Scape.':representation==='gaussians'?'Trained Gaussian appearance. Switch to 3D Model for the raw geometry or Scape for a simplified layout.':representation==='seeds'?`${g.seedPoints.toLocaleString()} exact initialization points, before Gaussian optimization. No triangles or splat opacity.`:`${g.mesh.vertices.toLocaleString()} vertices · ${g.mesh.triangles.toLocaleString()} triangles · before Gaussian optimization. Inferred depth surfaces; holes and overlapping camera layers remain. This is not a watertight room.`;
 }
 async function loadFrame(index){
  if(!manifest)return;loading=true;frame=index;const request=++version,scene=manifest,kind=representation(),canvas=$('combined-canvas');const current=()=>request===version&&scene===manifest;canvas.setAttribute('aria-busy','true');
  if(kind==='scape'&&!scapeLayout)$('combined-geometry-status').textContent='Fitting simple planes to the saved geometry…';
  try{
   if(kind==='scape'){const layout=await getScape();if(!current())return;scapeLayout=layout;viewer.loadScape(layout,scapeOptions());}
   else{const bytes=await frameBytes(index,kind);if(!current())return;if(kind==='gaussians')viewer.load(bytes,{fraction:Number($('combined-density').value)/100});else await viewer.loadSurface(bytes,kind,current);}
   if(!current())return;frame=index;$('combined-time').value=String(scene.frames[index].time);const f=manifest.frames[index];$('combined-frame').textContent=`${f.time.toFixed(2)} / ${manifest.frames.at(-1).time.toFixed(2)} s · ${kind==='gaussians'?viewer.visibleCount.toLocaleString()+' / '+f.gaussians.toLocaleString()+' splats visible':kind==='scape'?'Scape · static layout':'pre-training geometry'}`;
   geometryInfo(f,kind);canvas.dataset.representation=kind;canvas.style.visibility='';if(kind!=='scape'&&index+1<manifest.frames.length)frameBytes(index+1,kind).catch(()=>{});
  }catch(error){if(current()){canvas.style.visibility='hidden';$('combined-geometry-status').textContent=error.message;throw error;}}
  finally{if(current()){loading=false;canvas.setAttribute('aria-busy','false');}}
 }
 async function open(id){setPlaying(false);onScenePlayback();version++;const request=++openVersion,selectedTake=take;const next=await api(`/api/reconstructions/${id}/manifest.json`);if(request!==openVersion)return;manifest=next;manifest.id=id;sceneTake=selectedTake;frame=0;frameCache=new Map();scapePromise=null;scapeLayout=null;if(scapeURL)URL.revokeObjectURL(scapeURL);scapeURL=null;$('combined-scape-download').hidden=true;$('combined-result').hidden=false;viewer||=new CombinedViewer($('combined-canvas'),{onNavigation:message=>$('combined-navigation-status').textContent=message});viewer.setCalibration(manifest);$('combined-time').min=String(manifest.frames[0].time);$('combined-time').max=String(manifest.frames.at(-1).time);$('combined-time').step='0.01';let ticks=$('combined-timeline-ticks');if(!ticks){ticks=document.createElement('div');ticks.id='combined-timeline-ticks';ticks.className='timeline-ticks';$('combined-time').after(ticks);}ticks.replaceChildren(...Array.from({length:5},(_,i)=>{const span=document.createElement('span');span.textContent=(manifest.frames[0].time+(manifest.frames.at(-1).time-manifest.frames[0].time)*i/4).toFixed(1)+' s';return span;}));
  for(const option of $('combined-representation').options)option.disabled=!manifest.frames.every(f=>option.value==='seeds'?f.geometry?.seedFile:f.geometry?.meshFile);
  const available=Array.from($('combined-representation').options).find(o=>!o.disabled);
  $('combined-mode-model').disabled=!available;$('combined-mode-scape').disabled=!manifest.frames[0]?.geometry?.seedFile;
  if($('combined-representation').selectedOptions[0]?.disabled&&available)$('combined-representation').value=available.value;
  if($('combined-mode-'+viewMode).disabled)viewMode='gaussians';modeUI();
  const c=manifest.calibration;const quality=Array.from({length:manifest.cameraCount||2},(_,i)=>i).map(i=>{const scores=manifest.frames.map(f=>f.quality.trainingViews[i]);return `Camera ${(manifest.cameraSlots?.[i]??i)+1} worst: ${Math.min(...scores.map(v=>v.psnr)).toFixed(1)} dB, ${(Math.min(...scores.map(v=>v.coverage))*100).toFixed(1)}% image coverage`;}).join(' · ');
  $('combined-evidence').textContent=`QUALITY TARGET NOT MET · ${manifest.method||'stereo'} · ${manifest.training.surfaceGuidance?'surface-guided · ':''}${manifest.frames.length} time samples · ${quality}. ${c.inliers?c.inliers+' shared pose inliers. ':''}Novel-view fidelity is unverified.`;
  $('combined-limitations').textContent=manifest.limitations.join(' ');$('combined-download').href=`/api/reconstructions/${id}/frame-00000.splat`;$('combined-manifest').href=`/api/reconstructions/${id}/manifest.json`;const extras=$('combined-extra-cameras');extras.replaceChildren();for(let i=2;i<(manifest.cameraCount||2);i++){const button=document.createElement('button');button.textContent=`Camera ${(manifest.cameraSlots?.[i]??i)+1} view`;button.onclick=()=>viewer.snap(i);extras.append(button);}for(const [id,i]of [['combined-camera-a',0],['combined-camera-b',1]])$(id).textContent=`Camera ${(manifest.cameraSlots?.[i]??i)+1} view`;scoreUI.load(id);await loadFrame(0);viewer.snap(0);notify('complete');$('combined-result').scrollIntoView({behavior:'smooth'});
 }
 function selectedSlots(){return [...panel.querySelectorAll('[data-camera-slot]:checked')].map(c=>Number(c.value));}
 function updateBudget(){const count=selectedSlots().length,budgets={quick:[100,1],detailed:[400,2],maximum:[1000,4]},[steps,fps]=budgets[$('reconstruction-profile').value];$('reconstruction-budget').textContent=`${count} selected views · ${Math.round(steps*count/2).toLocaleString()} optimization steps per time sample · ${Number($('reconstruction-splat-limit')?.value)>0?'Up to '+Number($('reconstruction-splat-limit').value).toLocaleString()+' splats':'All valid geometry; no splat count cap'} · ${fps} reconstructed samples/s. Larger scenes need more memory and time. Offline build; not live video frame rate.`;}
 $('reconstruction-views').addEventListener('change',updateBudget);$('reconstruction-profile').addEventListener('change',updateBudget);
 $('reconstruction-start').onclick=()=>start().catch(report);$('reconstruction-cancel').onclick=()=>active&&post(`/api/reconstructions/${active.id}/cancel`,{}).catch(report);
 function seekTime(time){setPlaying(false);if(!manifest)return;let index=0;for(let i=1;i<manifest.frames.length;i++)if(Math.abs(manifest.frames[i].time-time)<Math.abs(manifest.frames[index].time-time))index=i;loadFrame(index).catch(report);}
 $('combined-time').oninput=()=>seekTime(Number($('combined-time').value));
 $('combined-time').addEventListener('wheel',event=>{if(!manifest)return;event.preventDefault();seekTime(manifest.frames[Math.max(0,Math.min(manifest.frames.length-1,frame+(event.deltaY>0?1:-1)))].time);},{passive:false});
 document.addEventListener('input',event=>{if(event.target.id==='combined-density'){$('combined-density-value').value=event.target.value+'%';if(manifest&&viewMode==='gaussians'){setPlaying(false);loadFrame(frame).catch(report);}}});
 $('combined-play').onclick=async()=>{if(!manifest||manifest.frames.length<2||viewMode==='scape')return;if(playing){setPlaying(false);return;}try{onScenePlayback();if(frame===manifest.frames.length-1)await loadFrame(0);lastFrame=performance.now();setPlaying(true);}catch(error){setPlaying(false);report(error);}};
 $('combined-restart').onclick=()=>{setPlaying(false);loadFrame(0).catch(report);};
 $('combined-representation').onchange=()=>{setPlaying(false);loadFrame(frame).catch(report);};
 for(const mode of ['gaussians','model','scape'])$('combined-mode-'+mode).onclick=()=>{if(viewMode===mode)return;setPlaying(false);viewMode=mode;modeUI();loadFrame(frame).catch(report);};
 for(const id of ['combined-scape-assumptions','combined-scape-ceiling','combined-scape-cutaway'])$(id).onchange=()=>viewer?.setScapeOptions(scapeOptions());
 $('combined-frame-model').onclick=()=>viewer?.frameGeometry();
 $('combined-source').onclick=()=>{setPlaying(false);expandViewer(false);if(sceneTake)Promise.resolve(onSourcePlayback(sceneTake)).catch(report);};
 $('combined-build-replay').onclick=async()=>{if(!sceneTake)return;try{expandViewer(false);await select(sceneTake);$('reconstruction-mode').value='sequence';$('reconstruction-profile').value=manifest.profile;$('reconstruction-method').value=manifest.method;$('reconstruction-surfaces').checked=!!manifest.training.surfaceGuidance;$('reconstruction-start').focus();$('reconstruction-status').textContent='Whole take selected. Choose a render level, then Build combined 3D to create playback.';}catch(error){report(error);}};
 for(const [id,index]of [['combined-camera-a',0],['combined-camera-b',1]])$(id).onclick=()=>viewer?.snap(index);
 $('combined-navigation').onchange=()=>{viewer?.setMode($('combined-navigation').value);$('combined-mouse').disabled=$('combined-navigation').value!=='fly';};
 $('combined-speed').oninput=()=>{const speed=2**Number($('combined-speed').value);viewer?.setSpeed(speed);$('combined-speed-value').value=`${Number(speed.toFixed(2))}×`;};
 $('combined-mouse').onclick=()=>viewer?.captureMouse();
 function expandViewer(expanded){$('combined-stage').classList.toggle('expanded',expanded);$('combined-fullscreen').textContent=expanded?'Exit expanded view':'Expand viewer';$('combined-fullscreen').setAttribute('aria-pressed',String(expanded));}
 $('combined-fullscreen').onclick=()=>expandViewer(!$('combined-stage').classList.contains('expanded'));
 $('combined-show-score').onclick=()=>{expandViewer(false);$('reconstruction-score').scrollIntoView({behavior:'smooth',block:'start'});};
 document.addEventListener('keydown',event=>{if(event.code==='Escape')expandViewer(false);});
 setInterval(()=>{if(!playing||loading||!manifest)return;const next=frame+1;if(next>=manifest.frames.length){setPlaying(false);return;}const delay=Math.max(.05,manifest.frames[next].time-manifest.frames[frame].time);if(performance.now()-lastFrame>delay*1000){lastFrame=performance.now();loadFrame(next).catch(error=>{setPlaying(false);report(error);});}},30);
 document.addEventListener('change',e=>{if(e.target.id==='reconstruction-splat-limit')updateBudget();});
 return {select,refresh,start,busy:()=>!!active||starting,reset(){if(active||starting)throw new Error('Processing is still running.');setPlaying(false);version++;openVersion++;take=null;manifest=null;frameCache.clear();viewer?.dispose();viewer=null;panel.hidden=true;$('combined-result').hidden=true;clearTimeout(pollTimer);},openSaved:async(item,id)=>{await select(item);await open(id);}};
}
