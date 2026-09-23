import './style.css';
import './rig.css';
import './lab.css';
import './rig-setup.css';
import './session-workspace.css';
import {browserNotebook,mountHostedWorkspace} from './hosted-workspace.js';
import {sessionWorkspace,compactCamera} from './session-workspace.js';
import {mountLab,labUI,showLabTab} from './lab-ui.js';
import {liveSceneUI} from './live-scene-ui.js';
import {rigSetupUI} from './rig-setup-ui.js';
mountLab();
import {openLocalCamera,releasePreviousCameras} from './camera-bridge.js';
import {assignCameraDevices} from './camera-inventory.js';
import {cameraDiagnostics} from './camera-diagnostics.js';
import {cameraDelivery} from './camera-delivery.js';
import {cameraFormat} from './camera-format.js';
import {exactCameraConstraints,captureModeMatches,captureRequestMatches,validCaptureMode,captureBitrate,captureStallMs} from './capture-policy.js';
import {reconstructionUI} from './reconstruction-ui.js';
import {experimentLibraryUI} from './experiment-library-ui.js';

const $=id=>document.getElementById(id);
const hosted=import.meta.env.VITE_HOSTED_PREVIEW===true;
const hostedApi=hosted?browserNotebook(localStorage):null;
const simulated=new URLSearchParams(location.search).get('demo')==='1';
const profiles={'compatibility':[640,480,15,1500000],'720-15':[1280,720,15,2000000],'720':[1280,720,30,4000000],'720-60':[1280,720,60,8000000],'1080':[1920,1080,30,8000000],'1080-60':[1920,1080,60,12000000],'4k':[3840,2160,30,20000000]};
const profileKey=simulated?'spatial-rig-demo-profile':'spatial-rig-profile';
try{const savedProfile=localStorage.getItem(profileKey);if(profiles[savedProfile])$('rig-profile').value=savedProfile;}catch{}
const slots=[];
let nextSlot=0,reviewItem=null,assessmentVersion=0,sessionFlow,recordingOptions;
const layoutKey=simulated?'spatial-rig-demo-layout-v1':'spatial-rig-layout-v1';
let inventoryReady=false,inventorySignature='';
let config,devices=[],take=null,origin=0,stopping=false,connecting=false,scanning=false,markers=[],review=[],reviewPlaying=false,reviewOrigin=0,reviewPosition=0;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,9000);}
function report(error){console.error(error);toast(error.message||String(error));}
function cameraFailure(error){
  if(error.name==='NotAllowedError')return 'Camera permission denied. Allow camera access for this page in the browser.';
  if(error.name==='OverconstrainedError')return 'Requested mode is not supported. No lower capture mode was substituted.';
  if(error.name==='NotFoundError')return 'Selected camera is unavailable. Find cameras and select its current device entry.';
  if(error.name==='NotReadableError'||/timeout|timed out/i.test(error.message||''))return 'Detected, but this browser could not start its video stream. Try this page in standalone Chrome; another camera app, the driver or USB settings can also prevent startup.';
  return error.message||error.name||'The camera failed without an error description.';
}
async function api(url,options={}){if(hosted)return hostedApi(url,options);const r=await fetch(url,{...options,headers:{'X-Spatial-Token':config?.token,...options.headers}});const out=await r.json();if(!r.ok)throw new Error(out.error||`Request failed (${r.status})`);return out;}
const post=(url,value)=>api(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
const elapsed=()=>Math.max(0,performance.now()-origin);
const reconstruction=reconstructionUI({api,post,report,beforeBuild:()=>liveScene.stop(),onSourcePlayback:async item=>{if(take)throw new Error('Stop and save the current take before reviewing a recording.');await openReview(item);await playReview();},onScenePlayback:()=>{reviewPlaying=false;for(const r of review)r.video.pause();$('review-play').textContent='Play all angles';}});
const library=experimentLibraryUI({api,post,report,refresh:listTakes,openBuild:reconstruction.openSaved});
const lab=labUI({api,post,report,onContext:()=>updateControls(),onReview:openReview,onBuild:(item,id)=>id?reconstruction.openSaved(item,id):reconstruction.select(item)});
const liveScene=liveSceneUI({post,report,cameras:()=>slots});
rigSetupUI({post,report,cameras:()=>slots,liveScene,isRecording:()=>!!take,simulated});
sessionFlow=sessionWorkspace({lab,reconstruction,liveScene,isBusy:()=>!!take||stopping||connecting,report});
function requested(c){const mode=c.format.selection();if(mode.captureMode!=='camera-default'&&!validCaptureMode(mode))throw new Error(`${c.label}: enter positive whole-number width and height, and positive FPS (decimals are allowed).`);return {...mode,bitrate:validCaptureMode(mode)?captureBitrate(mode):undefined};}
function rememberLayout(){try{localStorage.setItem(layoutKey,JSON.stringify(slots.map(c=>({slot:c.slot,deviceId:$(`camera-${c.slot}`).value,assignedOnce:c.assignedOnce,userUnassigned:c.userUnassigned,label:devices.find(d=>d.deviceId===$(`camera-${c.slot}`).value)?.label||c.savedLabel,occurrence:devices.find(d=>d.deviceId===$(`camera-${c.slot}`).value)?.occurrence||c.savedOccurrence,...requested(c)}))));}catch{}}
function renumber(){slots.forEach((c,index)=>{c.label=`Camera ${index+1}`;c.tile.querySelector('.camera-number').textContent=c.label;for(const [id,prefix]of[[`camera-${c.slot}`,`${c.label} device`],[`remove-${c.slot}`,`Remove ${c.label}`],[`earlier-${c.slot}`,`Move ${c.label} earlier`],[`later-${c.slot}`,`Move ${c.label} later`]])$(id).setAttribute('aria-label',prefix);$(`earlier-${c.slot}`).disabled=index===0||!!take||connecting;$(`later-${c.slot}`).disabled=index===slots.length-1||!!take||connecting;});}
function populateDevices(){
  if(simulated)devices=slots.map(c=>({deviceId:`simulated-${c.slot}`,label:`Simulated ${c.label}`}));
  const assignments=assignCameraDevices(slots.map(c=>({deviceId:c.stream?c.deviceId:($(`camera-${c.slot}`).value||c.savedDevice||''),active:!!c.stream,userUnassigned:c.userUnassigned,label:c.savedLabel,occurrence:c.savedOccurrence})),devices);
  for(const [index,c] of slots.entries()){const select=$(`camera-${c.slot}`),current=assignments[index];
    select.replaceChildren(new Option('Not assigned',''),...devices.map((d,i)=>new Option(`${i+1} · ${d.label||'Video device'}`,d.deviceId)));
    if(current&&!devices.some(d=>d.deviceId===current))select.add(new Option('Previously selected camera · unavailable',current));
    select.value=current;if(current)c.assignedOnce=true;c.savedDevice=current;
  }
}
function addSlot(saved={}){
  if(take||stopping||connecting)return;
  const slot=Number.isSafeInteger(saved.slot)&&saved.slot>=0?saved.slot:nextSlot;
  nextSlot=Math.max(nextSlot,slot+1);
  const c={slot,label:'Camera',stream:null,recorder:null,queue:[],samples:[],seq:0,timingSeq:0,observedFrames:0,upload:null,clock:null,observedFPS:0,savedDevice:saved.deviceId||'',savedLabel:saved.label||'',savedOccurrence:saved.occurrence||1,userUnassigned:saved.userUnassigned===true,assignedOnce:saved.assignedOnce??!!saved.deviceId,retryAt:0,retryCount:0,closing:false};
  const tile=document.createElement('article');tile.className='camera-tile';tile.dataset.slot=slot;
  tile.innerHTML=`<div class="camera-heading"><label class="camera-number" for="camera-${slot}">Camera</label><select id="camera-${slot}" aria-label="Camera device"><option value="">Not assigned</option></select><div class="camera-order"><button class="quiet" id="earlier-${slot}" title="Move earlier">←</button><button class="quiet" id="later-${slot}" title="Move later">→</button></div><button class="quiet remove-camera" id="remove-${slot}">Remove</button></div><div class="camera-profile"></div><div class="camera-preview"><video id="preview-${slot}" muted playsinline></video><span class="empty" id="empty-${slot}">No camera connected</span></div><div class="camera-footer"><strong id="settings-${slot}">Waiting for a camera</strong><span id="fps-${slot}">—</span></div><div class="camera-settings"><button class="quiet" id="lock-${slot}" disabled>Lock focus & exposure</button><span id="lock-state-${slot}"></span></div>`;
  $('camera-grid').append(tile);slots.push(c);c.tile=tile;c.video=$(`preview-${slot}`);
  c.diagnostics=cameraDiagnostics(c,report);c.delivery=cameraDelivery(c);
  const defaults=profiles[$('rig-profile').value]||profiles['1080'];
  c.format=cameraFormat(c,{saved,defaults,onApply:()=>reconfigure(c).catch(report),onChange:rememberLayout});
  $(`lock-${slot}`).onclick=()=>lockSettings(c).catch(report);
  $(`camera-${slot}`).onchange=()=>{c.savedDevice=$(`camera-${slot}`).value;c.userUnassigned=!c.savedDevice;c.assignedOnce=true;rememberLayout();updateControls();};
  const move=delta=>{if(take||stopping||connecting)return;const from=slots.indexOf(c),to=from+delta;if(to<0||to>=slots.length)return;slots.splice(from,1);slots.splice(to,0,c);$('camera-grid').insertBefore(c.tile,slots[to+1]?.tile||null);renumber();rememberLayout();updateControls();};
  $(`earlier-${slot}`).onclick=()=>move(-1);$(`later-${slot}`).onclick=()=>move(1);
  $(`remove-${slot}`).onclick=()=>{if(take||stopping||connecting)return;release(c);slots.splice(slots.indexOf(c),1);tile.remove();renumber();rememberLayout();updateControls();};
  compactCamera(c);renumber();populateDevices();updateControls();return c;
}
function updateControls(){
 const connected=slots.filter(c=>c.stream).length,busy=!!take||stopping||scanning,connectionBusy=busy||connecting;
 $('require-capture-quality').disabled=connectionBusy;
 $('ready-count').textContent=`${connected} / ${slots.length} camera slots connected · ${devices.length} detected by capture service`;$('rig-state').textContent=take?stopping?'Saving every angle…':`Recording ${connected} cameras`:`${connected} streaming · ${devices.length} detected`;
 $('record-rig').disabled=connecting||scanning||stopping||(!take&&(!connected||!config?.ffmpeg||!lab.ready()));$('record-rig').textContent=take?'Stop & save all cameras':lab.ready()?'Record connected cameras':'Add session context to record';lab.setRecording(!!take||stopping);$('record-rig').classList.toggle('recording',!!take);
 $('connect-rig').disabled=connectionBusy;$('scan-cameras').disabled=connectionBusy;$('add-camera').disabled=connectionBusy;$('disconnect-rig').disabled=connectionBusy||!connected;$('rig-profile').disabled=connectionBusy;$('apply-profile').disabled=connectionBusy;$('sync-cue').disabled=!take||stopping;
 for(const c of slots){const cameraBusy=connectionBusy||c.connecting;c.diagnostics?.refresh(cameraBusy);$(`camera-${c.slot}`).disabled=cameraBusy||!!c.stream;$(`remove-${c.slot}`).disabled=cameraBusy;$(`lock-${c.slot}`).disabled=cameraBusy||!c.stream||simulated;c.format?.setBusy(cameraBusy);}
 $('camera-grid').classList.toggle('empty-grid',!slots.length);renumber();for(const b of document.querySelectorAll('.take-row button'))b.disabled=busy;$('assess-take').disabled=busy||!reviewItem;
 sessionFlow?.update({recording:!!take,saving:stopping,connected});
 if(hosted){$('record-rig').disabled=true;$('record-rig').textContent='Desktop required';$('session-record-hint').textContent='Recording and 3D processing need the desktop engine.';}
}
async function scan(requestPermission=true,quiet=false){
  if(take||scanning||connecting)return;
  scanning=true;
  if(!quiet){updateControls();$('device-status').textContent='Scanning for cameras…';}
  try{
  if(simulated)devices=slots.map(c=>({deviceId:`simulated-${c.slot}`,label:`Simulated ${c.label}`}));
  else if($('capture-path').value==='local')devices=await api('/api/camera-bridge/devices');
  else{const visible=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');if(requestPermission&&!slots.some(c=>c.stream)&&!visible.some(d=>d.deviceId&&d.label)){const permission=await openDevice({video:true,audio:false});permission.getTracks().forEach(t=>t.stop());}devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput'&&d.deviceId);}
  const previous=inventorySignature;inventorySignature=devices.map(d=>d.deviceId).sort().join('|');inventoryReady=true;while(slots.length<devices.length)addSlot();
  if(!quiet||previous!==inventorySignature){populateDevices();rememberLayout();$('device-status').textContent=`Capture service detects ${devices.length} video device${devices.length===1?'':'s'}. ${slots.filter(c=>c.stream).length} ${slots.filter(c=>c.stream).length===1?'is':'are'} streaming. Requested and received modes are verified on each preview.`;}
  return previous!==inventorySignature;
  }catch(e){if(!quiet)$('device-status').textContent=`Camera scan failed: ${e.message}`;throw e;}finally{scanning=false;updateControls();}
}
function synthetic(c,mode){const canvas=document.createElement('canvas');canvas.width=mode.width;canvas.height=mode.height;const ctx=canvas.getContext('2d');let frame=0;c.demoTimer=setInterval(()=>{ctx.fillStyle=['#193a2c','#293751','#583531','#493a58'][c.slot%4];ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#e3f3e8';ctx.font='48px Segoe UI';ctx.fillText(`SIMULATED ${c.label}`,60,90);ctx.font='32px Consolas';ctx.fillText(`frame ${frame++} · ${performance.now().toFixed(0)} ms`,60,145);ctx.beginPath();ctx.arc(canvas.width/2+Math.sin(performance.now()/600+c.slot)*Math.min(260,canvas.width/4),canvas.height*.58,100,0,Math.PI*2);ctx.fill();},1000/mode.frameRate);return canvas.captureStream(mode.frameRate);}
function observe(c){let baseline=null;const callback=(now,meta)=>{if(!c.stream)return;c.lastFrame=performance.now();const count=meta.presentedFrames??0;if(baseline&&now-baseline.now>=1000){c.observedFPS=(count-baseline.count)*1000/(now-baseline.now);$(`fps-${c.slot}`).textContent=`${c.observedFPS.toFixed(1)} observed FPS`;baseline={now,count};}if(!baseline)baseline={now,count};if(take&&!stopping){c.observedFrames++;c.samples.push([elapsed(),meta.mediaTime*1000,count]);if(c.samples.length>=150)queueTiming(c);}c.clock=c.video.requestVideoFrameCallback(callback);};if(c.video.requestVideoFrameCallback)c.clock=c.video.requestVideoFrameCallback(callback);else $(`fps-${c.slot}`).textContent='Frame timestamps unavailable';}
async function openDeviceWithRetry(c,constraints){
  for(let attempt=0;attempt<2;attempt++){
    try{return await openDevice(constraints);}catch(error){
      // Retry a rejected driver startup once; never overlap timed-out requests.
      if(attempt||error.name!=='NotReadableError')throw error;
      $(`settings-${c.slot}`).textContent='Camera startup failed; retrying once…';
      await wait(750);
    }
  }
}
function settingText(c){const source=c.sourceSettings,want=c.requested;if(!source||!want)return;const width=c.video.videoWidth,height=c.video.videoHeight;if(width&&height){c.settings.width=width;c.settings.height=height;}const got=c.settings,match=captureModeMatches(want,source,got);c.modeMatched=match;$(`settings-${c.slot}`).textContent=`${want.captureMode==='camera-default'?'Camera default':'Requested'} ${want.width} × ${want.height} @ ${want.frameRate} · camera ${source.width} × ${source.height} @ ${Number(source.frameRate.toFixed(3))} · delivered ${got.width} × ${got.height} ${match?'· mode matched':'⚠ MODE MISMATCH'}`;c.tile.classList.toggle('mode-fallback',!match);}
async function connectOne(c){
    let mode;c.connecting=true;
    try{mode=requested(c);await c.releasing;c.deviceId=$(`camera-${c.slot}`).value;c.deviceLabel=devices.find(d=>d.deviceId===c.deviceId)?.label||c.label;$(`settings-${c.slot}`).textContent=mode.captureMode==='camera-default'?'Requesting the camera’s default native mode…':`Requesting ${mode.width} × ${mode.height} @ ${mode.frameRate}…`;
      if(!simulated&&$('capture-path').value==='local'){c.bridge=await openLocalCamera({deviceId:c.deviceId,label:c.deviceLabel,...mode,post});c.stream=c.bridge.stream;}
      else c.stream=simulated?synthetic(c,mode):await openDeviceWithRetry(c,exactCameraConstraints({deviceId:c.deviceId,...mode}));
      c.video.srcObject=c.stream;let timer;try{await Promise.race([c.video.play(),new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error('Camera produced no playable frames within 12 seconds')),12000))]);}finally{clearTimeout(timer);}
      c.sourceSettings=c.bridge?.settings||c.stream.getVideoTracks()[0].getSettings();if(!validCaptureMode(c.sourceSettings))throw new Error('The camera did not report its resolution and FPS. Use documented custom settings or a compatible camera driver.');if(mode.captureMode==='camera-default'){mode={...c.sourceSettings,captureMode:mode.captureMode,bitrate:captureBitrate(c.sourceSettings)};c.format.set(mode);}c.format.capabilities(c.bridge?.capabilities||c.stream.getVideoTracks()[0].getCapabilities?.());c.settings={...c.sourceSettings,width:c.video.videoWidth||c.sourceSettings.width,height:c.video.videoHeight||c.sourceSettings.height};c.settings.frameRate||=mode.frameRate;c.requested={...mode,sourceCapture:{width:c.sourceSettings.width,height:c.sourceSettings.height,frameRate:c.sourceSettings.frameRate},captureTransport:c.bridge?'local-webrtc':'direct',timingBasis:c.bridge?'receiver-presentation':'browser-presentation'};settingText(c);$(`empty-${c.slot}`).hidden=true;c.lastFrame=performance.now();c.lastMediaTime=c.video.currentTime;c.lastAdvanceAt=performance.now();c.retryCount=0;observe(c);c.delivery.start();
      c.stream.getVideoTracks()[0].addEventListener('ended',()=>{if(c.closing)return;handleFailure(c,'Camera disconnected');});return null;
    }catch(e){release(c,false);$(`empty-${c.slot}`).textContent='No live frames';$(`settings-${c.slot}`).textContent=cameraFailure(e);c.retryCount++;c.retryAt=/OverconstrainedError|Requested mode/i.test(e.name+' '+e.message)?Infinity:performance.now()+Math.min(10000,1000*2**Math.min(c.retryCount,3));return `${c.label}: ${e.name||'Error'} — ${e.message||cameraFailure(e)}`;}finally{c.connecting=false;}
}
async function connect(targets){
  while(scanning)await wait(25);
  if(take||connecting)return;
  const selected=(targets||slots).filter(c=>!c.stream&&$(`camera-${c.slot}`).value),all=slots.filter(c=>$(`camera-${c.slot}`).value),ids=all.map(c=>$(`camera-${c.slot}`).value);
  if(!ids.length)throw new Error('Find cameras and assign at least one device first.');if(new Set(ids).size!==ids.length)throw new Error('Each angle must use a different physical camera.');
  if(!selected.length)return;connecting=true;updateControls();const errors=(await Promise.all(selected.map(connectOne))).filter(Boolean);
  try{
    const n=slots.filter(c=>c.stream).length;
    $('device-status').textContent=`Capture service detects ${devices.length}; ${n} independent streams are live. ${errors.length?errors.join(' · '):'Requested and received modes are shown per camera.'}`;
    if(errors.length)toast('Some cameras could not connect. See the connection status above.');rememberLayout();
  }finally{connecting=false;updateControls();}
}
async function openDevice(constraints){let expired=false,timer;const request=navigator.mediaDevices.getUserMedia(constraints).then(stream=>{if(expired){stream.getTracks().forEach(t=>t.stop());throw new Error('Camera request expired');}return stream;});try{return await Promise.race([request,new Promise((_,reject)=>timer=setTimeout(()=>{expired=true;reject(new Error('Camera connection timed out'));},15000))]);}finally{clearTimeout(timer);}}
function release(c,reset=true){c.delivery?.stop();c.diagnostics?.clear();c.closing=true;c.releasing=c.bridge?.close()||c.releasing;c.bridge=null;if(c.clock!==null&&c.video.cancelVideoFrameCallback)c.video.cancelVideoFrameCallback(c.clock);c.clock=null;c.stream?.getTracks().forEach(t=>t.stop());c.stream=null;c.video.pause();c.video.srcObject=null;c.observedFPS=0;clearInterval(c.demoTimer);c.tile.classList.remove('mode-fallback','camera-frozen');$(`empty-${c.slot}`).hidden=false;if(reset){$(`empty-${c.slot}`).textContent='No camera connected';$(`fps-${c.slot}`).textContent='—';$(`settings-${c.slot}`).textContent='Waiting for a camera';}$(`lock-state-${c.slot}`).textContent='';queueMicrotask(()=>c.closing=false);}
async function reconfigure(c){if(take)throw new Error('Stop recording before changing camera quality.');requested(c);rememberLayout();release(c);if($(`camera-${c.slot}`).value)await connect([c]);}
async function applyProfile(){const [width,height,frameRate]=profiles[$('rig-profile').value];try{localStorage.setItem(profileKey,$('rig-profile').value);}catch{}for(const c of slots)c.format.set({width,height,frameRate,captureMode:'custom'});rememberLayout();const active=slots.filter(c=>c.stream);for(const c of active)release(c);if(active.length)await connect(active);}
function handleFailure(c,reason){if(!c.stream)return;const auto=$('auto-connect').checked;toast(`${c.label}: ${reason}. ${take?'Saving available footage.':auto?'Reconnecting automatically.':'Choose Connect selected cameras to retry.'}`);if(take){stop().then(()=>release(c)).catch(report);return;}release(c,false);c.retryCount++;c.retryAt=performance.now()+Math.min(10000,1000*2**Math.min(c.retryCount,3));$(`empty-${c.slot}`).textContent=auto?'Feed lost · reconnecting':'Feed lost · reconnect manually';$(`settings-${c.slot}`).textContent=reason;$('device-status').textContent=`${slots.filter(s=>s.stream).length} streams remain live. ${c.label}: ${reason}.`;updateControls();}
function disconnect(){if(take)return;$('auto-connect').checked=false;localStorage.setItem('spatial-auto-connect','false');for(const c of slots)release(c);$('device-status').textContent=`Cameras disconnected. ${devices.length} detected; automatic connection is off.`;updateControls();}
async function lockSettings(c){const track=c.stream?.getVideoTracks()[0];if(!track)return;const caps=track.getCapabilities(),settings=track.getSettings(),fixed={};for(const [mode,value]of[['focusMode','focusDistance'],['exposureMode','exposureTime'],['whiteBalanceMode','colorTemperature']])if(caps[mode]?.includes('manual')&&Number.isFinite(settings[value])){fixed[mode]='manual';fixed[value]=settings[value];}if(!Object.keys(fixed).length){$(`lock-state-${c.slot}`).textContent='Use camera vendor controls';return;}await track.applyConstraints({advanced:[fixed]});$(`lock-state-${c.slot}`).textContent='Supported settings locked';}
function queueTiming(c){if(!c.samples.length||!take)return;const samples=c.samples.splice(0);c.queue.push({kind:'timing',seq:c.timingSeq++,samples,takeId:take.id});drain(c).catch(failedSave);}
async function drain(c){if(c.upload)return c.upload;c.upload=(async()=>{while(c.queue.length){const item=c.queue[0];let error;for(let attempt=0;attempt<6;attempt++){try{if(item.kind==='timing')await post(`/api/rigs/${item.takeId}/timing`,{slot:c.slot,seq:item.seq,samples:item.samples});else await api(`/api/sessions/${c.sessionId}/chunk?seq=${item.seq}&time=${item.time}`,{method:'POST',body:item.blob});error=null;break;}catch(e){error=e;$('rig-save-status').textContent=`${c.label}: saving interrupted, retry ${attempt+1}/6. Keep this tab open.`;await wait(Math.min(2500,350*(attempt+1)));}}if(error)throw error;c.queue.shift();if(item.blob)c.bytes+=item.blob.size;}$('rig-save-status').textContent=`${(slots.reduce((n,c)=>n+(c.bytes||0),0)/1048576).toFixed(1)} MB saved across the cameras · original video + frame timing`;})();try{await c.upload;}finally{c.upload=null;}}
function failedSave(e){report(e);if(take&&!stopping)stop().catch(report);}
async function start(){
  recordingOptions=sessionFlow.processingOptions();
  if(take||connecting)return;const context=lab.captureContext();const active=slots.filter(c=>c.stream&&performance.now()-(c.lastFrame||0)<captureStallMs(c.requested?.frameRate));if(!active.length)throw new Error('Connect cameras first.');
  if(slots.some(c=>$(`camera-${c.slot}`).value&&!active.includes(c)))throw new Error('An assigned camera is missing or has no recent frames. Reconnect it or unassign its slot before recording.');
  if(active.some(c=>!captureRequestMatches(requested(c),c.requested)))throw new Error('Apply the changed camera settings before recording.');
  if($('require-capture-quality').checked&&!simulated){
    const failures=[];
    for(const c of active){
      settingText(c);const health=c.deliveryHealth;
      if(!c.modeMatched)failures.push(`${c.label}: requested resolution or source mode was not delivered`);
      else if(!health||health.grade==='measuring'||performance.now()-health.at>3000)failures.push(`${c.label}: wait for a full five-second delivery measurement`);
      else if(health.grade!=='on-target')failures.push(`${c.label}: ${health.fps.toFixed(1)} / ${c.requested.frameRate} FPS delivered`);
    }
    if(failures.length)throw new Error('Capture target not met. '+failures.join(' · ')+'. Fix the shortfall, or explicitly turn off the quality requirement for a diagnostic recording.');
  }
  for(const c of active)c.requested.preflight={requireTarget:$('require-capture-quality').checked,deliveredFps:c.deliveryHealth?.fps??null,measurementWindowMs:c.deliveryHealth?.windowMs??null,grade:c.deliveryHealth?.grade||'unmeasured'};
  const format=['video/webm;codecs=vp8','video/webm;codecs=vp9','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));if(!format)throw new Error('Use a browser that supports WebM recording.');
  for(const c of active)c.recorder=new MediaRecorder(c.stream,{mimeType:format,videoBitsPerSecond:c.requested?.bitrate||requested(c).bitrate});
  connecting=true;updateControls();origin=performance.now();markers=[];
  try{take=await post('/api/rigs',{name:context.label||`${simulated?'SIMULATED · ':''}${active.length}-camera session · ${new Date().toLocaleString()}`,context,simulated,clockOriginUnixMs:performance.timeOrigin+origin,cameras:active.map(c=>({slot:c.slot,label:c.label,deviceId:c.deviceId,deviceLabel:c.deviceLabel,width:c.settings.width,height:c.settings.height,frameRate:c.settings.frameRate,requested:c.requested}))});
    for(const c of active){c.sessionId=take.cameras.find(v=>v.slot===c.slot).sessionId;c.seq=0;c.timingSeq=0;c.queue=[];c.samples=[];c.bytes=0;c.observedFrames=0;c.recorderStartedMs=null;c.stopRequestedMs=0;c.recorder.onstart=()=>c.recorderStartedMs=elapsed();c.recorder.ondataavailable=e=>{if(!e.data.size)return;c.queue.push({kind:'video',seq:c.seq++,blob:e.data,time:Math.max(0,((c.stopRequestedMs||elapsed())-c.startRequestedMs)/1000)});drain(c).catch(failedSave);if(c.queue.reduce((n,x)=>n+(x.blob?.size||0),0)>32*1048576)failedSave(new Error('Saving is falling behind. Capture is stopping to preserve pending video.'));};c.recorder.onerror=e=>failedSave(e.error||new Error(`${c.label} recorder failed`));c.startRequestedMs=elapsed();c.recorder.start(1000);}
    $('cue-count').textContent='0 cues marked';toast(`Recording ${active.length} cameras. Show a visible sync cue now.`);
  }catch(e){if(take)await stop().catch(report);throw e;}finally{connecting=false;updateControls();}
}
async function stop(){
  if(!take||stopping)return;stopping=true;updateControls();const active=slots.filter(c=>c.sessionId&&take.cameras.some(v=>v.sessionId===c.sessionId));
  try{await Promise.all(active.map(async c=>{if(c.recorder.state!=='inactive'){c.stopRequestedMs=elapsed();await new Promise(resolve=>{c.recorder.addEventListener('stop',resolve,{once:true});c.recorder.stop();});}else c.stopRequestedMs||=elapsed();queueTiming(c);}));
    await Promise.all(active.map(c=>drain(c)));await Promise.all(active.map(c=>post(`/api/sessions/${c.sessionId}/stop`,{})));
    const saved=await post(`/api/rigs/${take.id}/finish`,{cameras:active.map(c=>({slot:c.slot,startRequestedMs:c.startRequestedMs,stopRequestedMs:c.stopRequestedMs,recorderStartedMs:c.recorderStartedMs,observedFrames:c.observedFrames})),markers});take=null;await lab.afterSave();$('rig-save-status').textContent=saved.library?.state==='archived'?`Experiment saved: ${saved.library.path}. Build the combined scene below; exports and scores will be added to this folder automatically.`:`Original camera videos saved. Experiment archive needs repair: ${saved.library?.error||'not yet archived'}. Use Refresh / repair archive.`;await listTakes();toast('Every camera angle is saved. Preparing the replay…');await sessionFlow.saved(saved,recordingOptions).catch(error=>{ $('reconstruction-status').textContent='Original recordings saved. Processing could not start: '+error.message;report(error); });
  }catch(e){$('rig-save-status').textContent='Save incomplete. Keep this tab open and choose Retry saving.';throw e;}finally{stopping=false;updateControls();if(take)$('record-rig').textContent='Retry saving';}
}
async function recover(rig){if(take)throw new Error('Finish the current take first.');for(const c of rig.cameras)if(c.recording.status!=='saved')await post(`/api/sessions/${c.sessionId}/stop`,{});await post(`/api/rigs/${rig.id}/finish`,{cameras:rig.cameras.map(c=>({slot:c.slot,startRequestedMs:c.startRequestedMs||0,stopRequestedMs:Math.max(c.startRequestedMs||0,(c.recording.duration||0)*1000),observedFrames:c.observedFrames||0,timingRecovered:true})),markers:rig.markers||[]});toast('Recovered surviving camera streams. Verify visual sync before reconstruction.');await listTakes();}
async function listTakes(){
 const [takes,entries]=await Promise.all([api('/api/rigs'),library.entries()]);$('takes-list').replaceChildren();
 for(const item of takes){
  const row=document.createElement('div');row.className='take-row';const title=document.createElement('span');title.textContent=item.name;const small=document.createElement('small');small.textContent=`${item.cameras.length} angles · ${item.status} · ${item.simulated?'simulated':'camera footage'} · ${item.context?.title||'legacy session · context not recorded'}`;title.append(small);
  const button=document.createElement('button');button.className='secondary';button.textContent=item.status==='saved'?'Review angles':'Recover take';button.onclick=()=>Promise.resolve(item.status==='saved'?openReview(item):recover(item)).catch(report);
  const link=document.createElement('a');link.href=`/api/rigs/${item.id}/manifest`;link.textContent='Capture manifest';row.append(title,button);
  if(item.status==='saved'&&item.cameras.length>=2){const build=document.createElement('button');build.textContent='Reconstruct combined 3D';build.onclick=()=>reconstruction.select(item).catch(report);row.append(build);}
  row.append(link);library.decorate(row,item,entries.get(item.id));$('takes-list').append(row);
 }
 library.filter();lab.takes(takes);updateControls();
}
async function openReview(item){if(take)return;showLabTab('library');reviewItem=item;assessmentVersion++;$('quality-report').hidden=true;updateControls();reviewPlaying=false;$('review-play').textContent='Play all angles';for(const r of review){r.video.pause();r.video.removeAttribute('src');r.video.load();}review=[];$('review-grid').replaceChildren();$('review').hidden=false;$('review-title').textContent=item.name;let duration=0;for(const c of item.cameras){const article=document.createElement('article');article.className='camera-tile';const heading=document.createElement('div');heading.className='camera-heading';heading.textContent=c.label;const wrap=document.createElement('div');wrap.className='camera-preview';const video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='metadata';video.src=`/recordings/${c.sessionId}/recording.webm`;wrap.append(video);const footer=document.createElement('div');footer.className='camera-footer';const a=document.createElement('a');a.href=`/?recording=${c.sessionId}&view=4d`;a.textContent='Open this angle in the single-view 3D viewer';const quality=document.createElement('a');quality.href=`/quality.html?recording=${c.sessionId}`;quality.textContent='Source-view diagnostic (requires prepared depth)';footer.append(a,quality);article.append(heading,wrap,footer);$('review-grid').append(article);review.push({video,offset:(c.startRequestedMs||0)/1000});duration=Math.max(duration,c.recording.duration+(c.startRequestedMs||0)/1000);}reviewPosition=0;$('review-time').max=String(duration);$('review-time').value='0';$('review').scrollIntoView({behavior:'smooth',block:'start'});}

const node=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;};
async function assessTake(){
  if(!reviewItem||take)return;
  const version=++assessmentVersion,id=reviewItem.id,panel=$('quality-report');
  panel.hidden=false;panel.replaceChildren(node('p','Inspecting saved video frames and timing evidence…'));$('assess-take').disabled=true;
  try{const result=await api(`/api/rigs/${id}/quality`);if(version!==assessmentVersion)return;
    panel.replaceChildren(node('h2',result.verdict,'verdict-fail'),node('p',`${result.verifiedGates} / ${result.totalGates} engineering gates verified · realism score: not established`),node('p',result.scope,'quality-note'));
    const table=node('table'),head=node('tr');for(const title of ['Camera','Recorded size','Encoded FPS / target','Largest frame gap','Frames / observations'])head.append(node('th',title));const thead=node('thead');thead.append(head);table.append(thead);const tbody=node('tbody');
    for(const c of result.cameras){const row=node('tr');for(const value of [c.label,`${c.settings.width} × ${c.settings.height}`,c.encoded?`${c.encoded.effectiveFps.toFixed(1)} / ${c.targetFps}`:'Unavailable',c.encoded?`${c.encoded.maxGapMs.toFixed(1)} ms`:'Unavailable',`${c.encoded?.frames??'—'} / ${c.observed?.frames??'—'}`])row.append(node('td',value));tbody.append(row);if(c.error){const errorRow=node('tr'),cell=node('td',c.error,'verdict-fail');cell.colSpan=5;errorRow.append(cell);tbody.append(errorRow);}}
    table.append(tbody);const wrap=node('div',undefined,'quality-table');wrap.append(table);panel.append(wrap);
    const gates=node('div',undefined,'quality-gates');for(const g of result.gates){const card=node('article',undefined,'quality-gate');card.dataset.status=g.status;card.append(node('span',g.status.toUpperCase(),`gate-status ${g.status}`),node('h3',g.name),node('p',g.evidence),node('p',g.next,'quality-note'));gates.append(card);}panel.append(gates,node('p',result.nextExperiment));
    const download=node('a','Download assessment JSON');if(assessTake.blob)URL.revokeObjectURL(assessTake.blob);assessTake.blob=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));download.href=assessTake.blob;download.download=`assessment-${id}.json`;panel.append(download);
  }catch(e){if(version===assessmentVersion)panel.replaceChildren(node('p',`Assessment unavailable: ${e.message}. No passing grade was issued.`));throw e;}
  finally{if(version===assessmentVersion)updateControls();}
}
function seekReview(t){reviewPosition=t;for(const r of review)if(r.video.readyState>=1)r.video.currentTime=Math.max(0,Math.min(r.video.duration||0,t-r.offset));if(reviewPlaying)reviewOrigin=performance.now()-t*1000;}
async function playReview(){if(!review.length)return;reviewPlaying=!reviewPlaying;if(reviewPlaying){if(reviewPosition>=Number($('review-time').max)-.1)seekReview(0);reviewOrigin=performance.now()-reviewPosition*1000;await Promise.all(review.map(r=>r.video.play()));}else for(const r of review)r.video.pause();$('review-play').textContent=reviewPlaying?'Pause all angles':'Play all angles';}
function tick(){if(reviewPlaying){const t=(performance.now()-reviewOrigin)/1000;reviewPosition=t;$('review-time').value=String(t);for(const r of review){const target=Math.max(0,t-r.offset);if(r.video.readyState>=2&&target<r.video.duration&&Math.abs(r.video.currentTime-target)>.12)r.video.currentTime=target;}if(t>=Number($('review-time').max))playReview().catch(report);}requestAnimationFrame(tick);}
for(const [id,fn]of[['apply-profile',applyProfile],['scan-cameras',()=>scan()],['add-camera',()=>{addSlot();rememberLayout();}],['connect-rig',()=>connect()],['disconnect-rig',disconnect],['record-rig',()=>take?stop():start()],['review-play',playReview],['assess-take',assessTake]])$(id).onclick=()=>Promise.resolve().then(fn).catch(report);
$('sync-cue').onclick=()=>{if(!take)return;markers.push({ms:elapsed(),label:'Operator marked a visible sync cue'});$('cue-count').textContent=`${markers.length} cues marked`;toast('Cue time marked. The physical flash or gesture must be visible in every camera.');};
$('review-time').oninput=()=>seekReview(Number($('review-time').value));
window.addEventListener('beforeunload',e=>{if(take||slots.some(c=>c.queue.length)){e.preventDefault();e.returnValue='Capture or saving is still active.';}});
async function autoRefresh(){if(simulated||!inventoryReady||take||stopping||connecting||scanning)return;await scan(false,true);if(!$('auto-connect').checked)return;const due=slots.filter(c=>!c.stream&&!c.connecting&&performance.now()>c.retryAt&&devices.some(d=>d.deviceId===$(`camera-${c.slot}`).value));if(due.length)await connect(due);}
navigator.mediaDevices?.addEventListener('devicechange',()=>autoRefresh().catch(report));
window.addEventListener('focus',()=>autoRefresh().catch(report));
$('auto-connect').checked=localStorage.getItem('spatial-auto-connect')!=='false';$('auto-connect').onchange=()=>{localStorage.setItem('spatial-auto-connect',String($('auto-connect').checked));if($('auto-connect').checked)autoRefresh().catch(report);};
$('capture-path').onchange=()=>{if(slots.some(c=>c.stream)){toast('Disconnect cameras before changing capture service.');$('capture-path').value=slots.some(c=>c.bridge)?'local':'direct';return;}for(const c of slots){c.savedDevice='';c.assignedOnce=false;$(`camera-${c.slot}`).value='';}scan(true).then(()=>{if($('auto-connect').checked)return connect();}).catch(report);};
setInterval(()=>{const now=performance.now();for(const c of slots){if(!c.stream)continue;settingText(c);const mediaTime=c.video.currentTime;if(mediaTime>c.lastMediaTime+.001){c.lastMediaTime=mediaTime;c.lastAdvanceAt=now;}else if(now-(c.lastAdvanceAt||now)>captureStallMs(c.requested?.frameRate)&&!c.connecting){c.tile.classList.add('camera-frozen');$(`fps-${c.slot}`).textContent='Feed stalled';handleFailure(c,'No new video frames within the expected interval');}}const alive=slots.filter(c=>c.stream&&now-(c.lastAdvanceAt||0)<captureStallMs(c.requested?.frameRate));lab.cameraStatus(alive.length,devices.length,alive.reduce((n,c)=>n+c.observedFPS,0)/(alive.length||1));},750);
setInterval(()=>autoRefresh().catch(report),1000);
async function boot(){let layout;try{layout=JSON.parse(localStorage.getItem(layoutKey));}catch{}if(Array.isArray(layout)&&layout.every(c=>c&&Number.isSafeInteger(c.slot)&&c.slot>=0&&typeof c.deviceId==='string')&&new Set(layout.map(c=>c.slot)).size===layout.length){for(const c of layout)addSlot(c);}else{addSlot(hosted?{captureMode:'camera-default'}:{});if(!hosted)addSlot();}config=await api('/api/config');if(hosted)mountHostedWorkspace(api,report);$('rig-save-path').textContent=config.recordingsDir;$('simulated-banner').hidden=!simulated;await releasePreviousCameras(post);await lab.refresh();await scan(false);await listTakes();updateControls();requestAnimationFrame(tick);if(!hosted&&!simulated&&devices.length&&$('auto-connect').checked)await connect();}
boot().catch(report);
