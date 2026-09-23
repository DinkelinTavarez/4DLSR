import './style.css';
import { SplatViewer } from './splats.js';
import { DemoScene } from './demo.js';

const $=id=>document.getElementById(id);
const live=$('live-video'),video=$('playback-video'),demoCanvas=$('demo-canvas');
let config,stream,recorder,recording,selected,recordStart=0,recordDuration=0,seq=0;
let source='idle',spatial=false,demoPlaying=false,demoTime=0,generation=0,depthReady=false,depthLoading=false,depthBusy=false,backend='',requestId=0,lastInference=0,lastDepthKey='',lastDemo=0;
let uploadQueue=[],uploading=null,saveError=null,stopping=false,baking=false,cancelPreparation=false,depthWrites=Promise.resolve();
let enginePromise,engineResolve,engineReject,worker;
let scrubbing=false;
let pending=new Map(),depthCache=new Map(),depthIndex=[],depthFetching=new Map(),recordDepthAt=-1,recordings=[],depthQuality='preview',decodedFrameTime=null;
if(video.requestVideoFrameCallback){const decoded=(_,meta)=>{decodedFrameTime=meta.mediaTime;video.requestVideoFrameCallback(decoded);};video.requestVideoFrameCallback(decoded);}
const grab=document.createElement('canvas'),grabCtx=grab.getContext('2d',{willReadFrequently:true});
const processingVideo=document.createElement('video');processingVideo.muted=true;processingVideo.preload='auto';
let viewer,demo;
function toast(message,duration=7000){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,duration);}
function error(err){console.error(err);toast(err.message||String(err),12000);}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const time=t=>{t=Math.max(0,Number(t)||0);return `${Math.floor(t/60).toString().padStart(2,'0')}:${Math.floor(t%60).toString().padStart(2,'0')}`;};
const fullTime=t=>`${Math.floor(t/3600).toString().padStart(2,'0')}:${time(t%3600)}`;
async function api(url,options={}){
 const response=await fetch(url,{...options,headers:{'X-Spatial-Token':config?.token,...options.headers}});
 const result=await response.json();if(!response.ok)throw new Error(result.error||`Request failed (${response.status})`);return result;
}
const post=(url,value={})=>api(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
function sourceElement(){return source==='demo'?demoCanvas:source==='replay'?video:live;}
function sourceTime(){return source==='demo'?demoTime:source==='live'?(recording?(performance.now()-recordStart)/1000:performance.now()/1000):video.currentTime;}
function setSource(next){
 source=next;generation++;lastDepthKey='';lastInference=0;
 if(next!=='replay')video.pause();
 $('welcome').hidden=next!=='idle';
 $('source-title').textContent=next==='idle'?'Camera preview':next==='demo'?'Spatial preview':next==='live'?'Webcam · live':selected?.name||'Recording';
 $('source-tag').textContent=next==='idle'?'NOT RECORDING':next==='demo'?'SAMPLE':next==='live'?'CAM 01':'REPLAY';
 $('view-badge').innerHTML=`<i></i> ${next==='idle'?'CAMERA OFFLINE':next==='demo'?'SYNTHETIC SAMPLE':next==='live'?(recording?'RECORDING':'LIVE PREVIEW · NOT SAVING'):spatial?'ESTIMATED 3D · RECORDED VIDEO':'RECORDED VIDEO'}`;
 $('go-live').disabled=next==='live';$('mode-spatial').disabled=next==='idle';$('camera-preview-card').hidden=!stream;$('camera-preview-label').textContent=recording?'Live camera · recording':'Live camera · not recording';$('refresh-replay').disabled=!recording||next!=='replay';
 $('prepare').disabled=next!=='replay'||!!recording;
 viewer?.source(sourceElement());if(viewer){const element=sourceElement();viewer.material.uniforms.aspect.value=(element.videoWidth||element.width||16)/(element.videoHeight||element.height||9);}visibility();
}
function visibility(){
 live.style.display=!spatial&&source==='live'?'block':'none';video.style.display=!spatial&&source==='replay'?'block':'none';demoCanvas.style.display=!spatial&&source==='demo'?'block':'none';
 $('spatial-canvas').style.display=spatial?'block':'none';document.querySelector('.spatial-controls').hidden=!spatial;
 $('mode-video').classList.toggle('selected',!spatial);$('mode-spatial').classList.toggle('selected',spatial);
 $('view-hint').textContent=spatial?'DRAG TO ORBIT · SCROLL TO ZOOM · WASD TO MOVE':source==='idle'?'CONNECT CAMERA FOR LIVE PREVIEW':source==='demo'?'SAMPLE SCENE · NO CAMERA CONNECTED':source==='live'?'ORIGINAL CAMERA VIEW · MICROPHONE OFF':'ORIGINAL RECORDED VIDEO';
}
async function setSpatial(enabled){
 if(enabled&&!viewer)throw new Error('This browser cannot initialize WebGL. Use current Chrome or Edge with hardware acceleration.');
 spatial=enabled;$('welcome').hidden=source!=='idle';visibility();viewer?.source(sourceElement());
 if(!enabled){$('depth-overlay').hidden=true;return;}
 if(source==='demo'){viewer.setDepth(demo.frame(demoTime),256,144,true);return;}
 $('depth-overlay').hidden=false;$('depth-overlay-text').textContent=depthReady?'Estimating the visible surfaces…':'Loading the local depth engine…';
 try{await initDepth();await inferCurrent(true);}catch(e){$('depth-overlay').hidden=true;spatial=false;visibility();throw e;}
}
async function connect(){
 if(recording)throw new Error('Finish the current recording before changing cameras.');
 $('connect').disabled=true;
 try{
  const next=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30},...($('camera-select').value?{deviceId:{exact:$('camera-select').value}}:{})},audio:false});
  stream?.getTracks().forEach(t=>t.stop());stream=next;live.srcObject=stream;$('camera-preview').srcObject=stream;await live.play();await $('camera-preview').play();
  stream.getVideoTracks()[0].addEventListener('ended',()=>{if(recording)stopRecording().catch(error);toast('Camera disconnected. The saved recording is kept.');});
  const devices=await navigator.mediaDevices.enumerateDevices();$('camera-select').replaceChildren(...devices.filter(d=>d.kind==='videoinput').map((d,i)=>new Option(d.label||`Camera ${i+1}`,d.deviceId)));$('camera-select').value=stream.getVideoTracks()[0].getSettings().deviceId;
  $('record').disabled=!config.ffmpeg;$('disconnect').disabled=false;$('capture-state').innerHTML='Camera connected<small id="capture-detail">Ready to record · microphone off</small>';$('capture-dot').style.background='#b5f2d3';
  spatial=false;setSource('live');viewer?.reset();
 }catch(e){if(e.name==='NotAllowedError')throw new Error('Camera access was denied. Allow the camera in the browser address bar, then reconnect.');if(e.name==='NotFoundError')throw new Error('No webcam was found. Connect a camera and try again.');throw e;}
 finally{$('connect').disabled=false;}
}
function disconnect(){if(recording||baking)return;stream?.getTracks().forEach(t=>t.stop());stream=null;live.srcObject=null;$('camera-preview').srcObject=null;$('record').disabled=true;$('disconnect').disabled=true;$('capture-state').innerHTML='Camera offline<small id="capture-detail">Your footage stays on this computer</small>';$('capture-dot').style.background='#74847a';spatial=false;setSource('idle');}
async function drain(){
 if(uploading)return uploading;
 uploading=(async()=>{
  while(uploadQueue.length){
   const item=uploadQueue[0];let last;
   for(let attempt=0;attempt<8;attempt++){
    try{await api(`/api/sessions/${item.id}/chunk?seq=${item.seq}&time=${item.time}`,{method:'POST',body:item.blob});last=null;break;}
    catch(e){last=e;$('save-progress').textContent=`Saving interrupted. Retrying (${attempt+1}/8)…`;await wait(Math.min(3000,500*(attempt+1)));}
   }
   if(last){saveError=last;throw last;}
   uploadQueue.shift();if(recording?.id===item.id)recording.bytes+=item.blob.size;
   $('save-progress').textContent=`${((recording?.bytes||0)/1048576).toFixed(1)} MB saved · ${uploadQueue.length} chunks pending`;
  }
 })();try{await uploading;}finally{uploading=null;}
}
async function startRecording(){
 if(baking||recording||stopping)return;
 if(!stream)await connect();if(!config.ffmpeg)throw new Error('FFmpeg is required for seekable playback.');
 const format=['video/webm;codecs=vp8','video/webm;codecs=vp9','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));if(!format)throw new Error('This browser cannot record WebM. Use Chrome or Edge.');
 const settings=stream.getVideoTracks()[0].getSettings();
 const nextRecorder=new MediaRecorder(stream,{mimeType:format,videoBitsPerSecond:5000000});
 recording=await post('/api/sessions',{name:`Webcam · ${new Date().toLocaleString()}`,width:settings.width,height:settings.height});
 recorder=nextRecorder;seq=0;recordStart=performance.now();recordDuration=0;recordDepthAt=-1;saveError=null;
 recorder.ondataavailable=e=>{if(!e.data.size)return;uploadQueue.push({id:recording.id,seq:seq++,blob:e.data,time:recordDuration||(performance.now()-recordStart)/1000});drain().catch(e=>{error(new Error('Disk saving failed. Keep this tab open and click Retry saving. '+e.message));if(recorder.state==='recording')stopRecording().catch(()=>{});});
  if(uploadQueue.reduce((n,i)=>n+i.blob.size,0)>32*1048576&&recorder.state==='recording'){toast('Recording paused to protect unsaved video while the disk catches up.');stopRecording().catch(error);}
 };
 recorder.onerror=e=>{error(e.error||new Error('Camera recorder failed'));stopRecording().catch(error);};
 recorder.start(1000);initDepth().catch(error);$('record').classList.add('recording');$('record').innerHTML='<span class="record-dot"></span> Stop & save';$('connect').disabled=true;$('disconnect').disabled=true;$('camera-select').disabled=true;
 $('capture-state').innerHTML='Recording to Desktop<small id="capture-detail">Capture continues while you rewind</small>';$('capture-dot').style.background='#ee987a';setSource('live');toast('Recording started. Video is being saved continuously.');
 await refreshLibrary();
}
async function flushCapture(){
 if(recorder?.state==='recording')await new Promise(resolve=>{recorder.addEventListener('dataavailable',resolve,{once:true});recorder.requestData();});
 await drain();
}
async function stopRecording(){
 if(!recording||stopping)return;stopping=true;$('record').disabled=true;
 try{
  if(recorder.state==='recording'){recordDuration=(performance.now()-recordStart)/1000;await new Promise(resolve=>{recorder.addEventListener('stop',resolve,{once:true});recorder.stop();});}
  $('record').textContent='Finishing recording…';await drain();await depthWrites;
  const saved=await post(`/api/sessions/${recording.id}/stop`);recording=null;saveError=null;
  $('record').classList.remove('recording');$('record').innerHTML='<span class="record-dot"></span> Start recording';$('connect').disabled=false;$('disconnect').disabled=!stream;$('camera-select').disabled=false;
  $('capture-state').innerHTML='Recording saved<small id="capture-detail">Original video + estimated depth on Desktop</small>';$('capture-dot').style.background='#b5f2d3';
  await refreshLibrary();spatial=false;setSource(stream?'live':'idle');toast('Recording saved. Preview continues without saving. Open Recordings to play or render it.');
 }catch(e){$('record').textContent='Retry saving';throw e;}finally{stopping=false;$('record').disabled=!stream&&!recording;}
}
function mediaEvent(element,event,timeout=15000){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>finish(new Error(`Video ${event} timed out`)),timeout);const ok=()=>finish(),bad=()=>finish(new Error(element.error?.message||'Video could not be decoded'));function finish(e){clearTimeout(timer);element.removeEventListener(event,ok);element.removeEventListener('error',bad);e?reject(e):resolve();}element.addEventListener(event,ok,{once:true});element.addEventListener('error',bad,{once:true});});}
async function loadVideo(element,url){const ready=mediaEvent(element,'loadeddata');element.src=url;element.load();await ready;}
async function seek(element,value){value=Math.max(0,Math.min(Math.max(0,element.duration-.03),value));if(Math.abs(element.currentTime-value)<.02)return;const done=mediaEvent(element,'seeked');element.currentTime=value;await done;}
async function openRecording(item,url){
 if(baking)throw new Error('Cancel preparation before opening another recording.');
 const keepTime=selected?.id===item.id&&source==='replay'?video.currentTime:0;selected=item;generation++;depthCache.clear();depthFetching.clear();
 if(!url){toast('Preparing a seekable timeline…');url=(await post(`/api/sessions/${item.id}/snapshot`)).url;}
 decodedFrameTime=null;await loadVideo(video,url);await seek(video,keepTime);
 depthIndex=await api(`/api/sessions/${item.id}/depth-index?quality=hq`);depthQuality=depthIndex.length?'hq':'preview';if(!depthIndex.length)depthIndex=await api(`/api/sessions/${item.id}/depth-index`);
 setSource('replay');$('library').close();if(spatial){await initDepth();await inferCurrent(true);}
}
async function replayAt(value){
 if(recording && (source!=='replay'||selected?.id!==recording.id)){await flushCapture();await openRecording(recording);}
 if(source==='demo'){demoTime=Math.max(0,Math.min(30,value));lastDemo=0;return;}
 if(source!=='replay')return;await seek(video,value);lastInference=0;if(spatial)inferCurrent(true).catch(error);
}
async function rewind(){if(recording && source==='live'){const elapsed=(performance.now()-recordStart)/1000;await replayAt(Math.max(0,elapsed-10));}else await replayAt(sourceTime()-10);}
async function togglePlay(){if(baking)return;if(source==='demo')demoPlaying=!demoPlaying;else if(source==='replay'){if(video.paused)await video.play();else video.pause();}else if(recording)await rewind();else toast('Start recording to use playback controls.');}
async function refreshLibrary(){recordings=await api('/api/sessions');$('library-count').textContent=recordings.length;$('library-list').replaceChildren();if(!recordings.length){const p=document.createElement('p');p.textContent='Your first recording starts here. Connect your webcam, then press Start recording.';p.className='card-copy';$('library-list').append(p);}for(const item of recordings){const row=document.createElement('div');row.className='recording-row';const text=document.createElement('div'),title=document.createElement('strong'),meta=document.createElement('small'),button=document.createElement('button');title.textContent=item.name;meta.textContent=`${time(item.duration)} · ${(item.bytes/1048576).toFixed(1)} MB · ${item.status} · ${item.depthFrames||0} depth frames`;text.append(title,meta);button.className='secondary';button.textContent=item.status==='interrupted'?'Recover & open':'Open replay';button.onclick=()=>openRecording(item).catch(error);row.append(text,button);$('library-list').append(row);}}

async function initDepth(){
 if(depthReady)return;if(enginePromise)return enginePromise;
 depthLoading=true;$('load-model').disabled=true;$('engine-state').textContent='Loading local model…';
 enginePromise=new Promise((resolve,reject)=>{engineResolve=resolve;engineReject=reject;});
 worker=new Worker(new URL('./depth.worker.js',import.meta.url),{type:'module'});
 worker.onmessage=({data})=>{
  if(data.type==='progress'){$('engine-progress').firstElementChild.style.width=`${Math.max(8,data.progress)}%`;return;}
  if(data.type==='ready'){depthReady=true;depthLoading=false;backend=data.backend;$('engine-dot').classList.add('ready');$('engine-state').textContent=`Ready · ${backend==='webgpu'?'WebGPU':'CPU / WebAssembly'}`;$('engine-copy').textContent='Depth Anything V2 · processed on this computer';$('load-model').textContent='Depth engine online';$('engine-progress').firstElementChild.style.width='100%';engineResolve();return;}
  if(data.type==='error'){
   if(!depthReady){depthLoading=false;$('load-model').disabled=false;$('engine-state').textContent='Could not load model';engineReject(new Error(data.error));enginePromise=null;worker.terminate();}
   const task=pending.get(data.id);if(task){pending.delete(data.id);task.reject(new Error(data.error));}return;
  }
  if(data.type==='depth'){const task=pending.get(data.id);if(task){pending.delete(data.id);task.resolve({...data,depth:new Float32Array(data.depth)});}}
 };
 worker.onerror=e=>{engineReject(new Error(e.message));for(const task of pending.values())task.reject(new Error(e.message));pending.clear();enginePromise=null;depthBusy=false;depthLoading=false;depthReady=false;$('load-model').disabled=false;};
 worker.postMessage({type:'init'});return enginePromise;
}
async function estimate(element,t,quality='preview',key=selected?.id||recording?.id||source){
 while(depthBusy)await wait(50);depthBusy=true;
 try{
  const w=element.videoWidth||element.width,h=element.videoHeight||element.height;if(!w||!h)throw new Error('No video frame is ready yet.');
  const max=quality==='hq'?640:384,scale=Math.min(max/w,max/h);grab.width=Math.max(14,Math.round(w*scale));grab.height=Math.max(14,Math.round(h*scale));grabCtx.drawImage(element,0,0,grab.width,grab.height);const image=grabCtx.getImageData(0,0,grab.width,grab.height);const id=++requestId;
  const output=new Promise((resolve,reject)=>pending.set(id,{resolve,reject}));worker.postMessage({type:'estimate',id,time:t,quality,key,width:grab.width,height:grab.height,rgba:image.data.buffer},[image.data.buffer]);return await output;
 }finally{depthBusy=false;}
}
function cachePut(ms,data){depthCache.set(ms,data);while(depthCache.size>120)depthCache.delete(depthCache.keys().next().value);}
function saveDepth(id,t,data,quality='preview'){
 const ms=Math.max(0,Math.round(t*1000)),buf=new ArrayBuffer(8+data.depth.length*2),head=new DataView(buf);head.setUint32(0,data.width,true);head.setUint32(4,data.height,true);const values=new Uint16Array(buf,8);for(let i=0;i<values.length;i++)values[i]=Math.round(data.depth[i]*65535);
 const write=depthWrites.then(()=>api(`/api/sessions/${id}/depth?ms=${ms}&quality=${quality}`,{method:'POST',body:buf}));depthWrites=write.catch(e=>{$('save-progress').textContent='Video saved; a depth frame could not be saved.';console.error(e);});return write;
}
async function fetchDepth(ms){
 if(depthCache.has(ms)||!selected)return;if(depthFetching.has(ms))return depthFetching.get(ms);
 const id=selected.id,quality=depthQuality,task=(async()=>{try{const r=await fetch(`/recordings/${id}/${quality==='hq'?'depth-hq':'depth'}/${ms}.bin`);if(!r.ok)throw new Error('Cached depth unavailable');const b=await r.arrayBuffer(),v=new DataView(b),w=v.getUint32(0,true),h=v.getUint32(4,true),values=new Uint16Array(b,8),depth=new Float32Array(values.length);for(let i=0;i<values.length;i++)depth[i]=values[i]/65535;if(selected?.id===id&&depthQuality===quality)cachePut(ms,{depth,width:w,height:h});}catch(e){console.warn(e.message);}finally{depthFetching.delete(ms);}})();
 depthFetching.set(ms,task);return task;
}
function depthPair(t){
 if(!depthIndex.length)return null;const ms=t*1000;let lo=0,hi=depthIndex.length;while(lo<hi){const m=(lo+hi)>>1;if(depthIndex[m]<ms)lo=m+1;else hi=m;}
 const indices=depthIndex.slice(Math.max(0,lo-1),Math.min(depthIndex.length,lo+8));for(const stamp of indices)fetchDepth(stamp);
 const ta=depthIndex[Math.max(0,lo-1)],tb=depthIndex[Math.min(depthIndex.length-1,lo)],a=depthCache.get(ta),b=depthCache.get(tb);
 if(a&&b&&Math.min(Math.abs(ta-ms),Math.abs(tb-ms))<750)return {a,b,ta,tb,blend:tb===ta?0:Math.max(0,Math.min(1,(ms-ta)/(tb-ta)))};
 const closest=indices.reduce((best,n)=>Math.abs(n-ms)<Math.abs(best-ms)?n:best,indices[0]),data=depthCache.get(closest);return data&&Math.abs(closest-ms)<750?{a:data,b:data,ta:closest,tb:closest,blend:0}:null;
}
async function inferCurrent(force=false){
 if(source==='idle'||source==='demo'||!depthReady||baking)return;
 const playTime=sourceTime(),stamp=source==='replay'&&decodedFrameTime!==null&&Math.abs(decodedFrameTime-playTime)<.15?decodedFrameTime:playTime,thisGen=generation,element=sourceElement(),id=source==='live'?recording?.id:selected?.id;
 if(source==='replay'){
  let cached=depthPair(stamp);if(!cached&&depthIndex.length){const nearest=depthIndex.reduce((a,b)=>Math.abs(a-stamp*1000)<Math.abs(b-stamp*1000)?a:b);if(Math.abs(nearest-stamp*1000)<750){if(force)await fetchDepth(nearest);else if(depthFetching.has(nearest))return;cached=depthPair(stamp);}}
  if(cached){viewer.setDepthPair(cached.a,cached.b,cached.blend);$('depth-overlay').hidden=true;return;}
 }
 if(depthBusy&&!force)return;
 if(!force&&performance.now()-lastInference<350)return;lastInference=performance.now();
 const quality=source==='replay'?depthQuality:'preview',frame=await estimate(element,stamp,quality);$('stat-depth').textContent=`${(frame.latency/1000).toFixed(1)}s`;
 if(source==='live'&&id&&recording?.id===id&&stamp-recordDepthAt>=.35){saveDepth(id,stamp,frame);recordDepthAt=stamp;}
 if(thisGen===generation){viewer.material.uniforms.aspect.value=(element.videoWidth||16)/(element.videoHeight||9);viewer.setDepth(frame.depth,frame.width,frame.height,force);$('depth-overlay').hidden=true;if(source==='replay'&&id){const ms=Math.round(stamp*1000);cachePut(ms,frame);if(!depthIndex.includes(ms))depthIndex.push(ms);depthIndex.sort((a,b)=>a-b);saveDepth(id,stamp,frame,quality);}}
}
async function prepare(){
 if(baking){cancelPreparation=true;return;}if(source!=='replay'||!selected||recording)return;video.pause();baking=true;cancelPreparation=false;$('prepare').textContent='Cancel preparation';const id=selected.id,url=video.src;
 for(const id of ['record','new-recording','connect','disconnect','camera-select','library-toggle','sample','go-live'])$(id).disabled=true;
 const profile=$('prepare-quality').value,quality=profile==='quick'?'preview':'hq',start=performance.now();$('prepare-quality').disabled=true;
 try{await initDepth();await loadVideo(processingVideo,url);const duration=processingVideo.duration,times=profile==='frame'?await api(`/api/sessions/${id}/frame-times`):Array.from({length:Math.ceil(duration*(profile==='quick'?2:6))},(_,i)=>i/(profile==='quick'?2:6));
 if(!times.length)throw new Error('No decodable video frames were found.');
 depthQuality=quality;depthCache.clear();depthFetching.clear();depthIndex=await api(`/api/sessions/${id}/depth-index?quality=${quality}`);const finished=new Set(depthIndex);
 let count=0;for(const t of times){if(cancelPreparation)break;const ms=Math.round(t*1000);if(!finished.has(ms)){
  await seek(processingVideo,Math.min(duration-.005,t+.001));const result=await estimate(processingVideo,t,quality,id);await saveDepth(id,t,result,quality);
  if(selected?.id===id){cachePut(ms,result);depthIndex.push(ms);}finished.add(ms);
 }
 count++;const seconds=(performance.now()-start)/1000,remaining=count>2?Math.round(seconds/count*(times.length-count)):null;
 $('prepare').textContent=`Preparing ${Math.round(count/times.length*100)}% · Cancel`;$('prepare-status').textContent=`${count} / ${times.length} frames${remaining!==null?' · about '+time(remaining)+' remaining':''} · keep this tab open`;
 }
 await depthWrites;depthIndex=[...new Set(depthIndex)].sort((a,b)=>a-b);toast(!cancelPreparation?'4D preparation complete. Depth is now saved with your recording.':'Preparation stopped. Completed frames were saved.');$('prepare-status').textContent=!cancelPreparation?`${times.length} frames prepared · ${quality==='hq'?'high detail':'preview'}`:'Stopped · completed frames kept';
 }finally{baking=false;$('prepare').textContent='Prepare full recording in 4D';$('prepare-quality').disabled=false;for(const id of ['new-recording','connect','camera-select','library-toggle','sample'])$(id).disabled=false;$('record').disabled=!stream||!config.ffmpeg;$('disconnect').disabled=!stream;$('go-live').disabled=source==='live';processingVideo.removeAttribute('src');processingVideo.load();await refreshLibrary();if(spatial)await inferCurrent(true);}
}

function bind(id,fn){$(id).onclick=()=>Promise.resolve().then(fn).catch(error);}
bind('new-recording',async()=>{if(baking)return;if(recording){toast('Stop & save the current recording before starting another.');return;}$('library').close();if(!stream)await connect();spatial=false;setSource('live');toast('Live preview only. Press Start recording when ready.');});
bind('connect',connect);bind('welcome-camera',connect);bind('disconnect',disconnect);bind('record',()=>recording?stopRecording():startRecording());bind('mode-video',()=>setSpatial(false));bind('mode-spatial',()=>setSpatial(true));bind('load-model',initDepth);bind('play',togglePlay);bind('rewind',rewind);bind('go-live',async()=>{if(baking)return;if(!stream)await connect();spatial=false;setSource('live');});bind('refresh-replay',async()=>{if(recording){const t=video.currentTime;await flushCapture();await openRecording(recording);await seek(video,t);}});bind('prepare',prepare);
bind('sample',()=>{if(recording){toast('The camera keeps recording while you explore the sample.');}setSource('demo');viewer.reset();setSpatial(true);viewer.controls.autoRotate=true;});
bind('reset-view',()=>viewer.reset());bind('orbit-view',()=>viewer.controls.autoRotate=!viewer.controls.autoRotate);bind('full-screen',()=>document.fullscreenElement?document.exitFullscreen():$('viewport').requestFullscreen());bind('library-toggle',async()=>{await refreshLibrary();$('library').showModal();});bind('close-library',()=>$('library').close());
$('speed').onchange=()=>video.playbackRate=Number($('speed').value);
$('scrubber').oninput=()=>{scrubbing=true;$('time-current').textContent=time($('scrubber').value);};$('scrubber').onchange=()=>{scrubbing=false;replayAt(Number($('scrubber').value)).catch(error);};
$('splat-density').onchange=()=>{const width=Number($('splat-density').value);viewer.setResolution(width,width*9/16);$('stat-splats').textContent=(width*width*9/16/1000).toFixed(1)+'k';lastInference=0;if(spatial&&source!=='demo')inferCurrent(true).catch(error);};
$('depth-strength').oninput=()=>{viewer.material.uniforms.spread.value=Number($('depth-strength').value);$('depth-value').textContent=Number($('depth-strength').value).toFixed(1)+'×';};$('splat-size').oninput=()=>{viewer.material.uniforms.softness.value=Number($('splat-size').value);$('splat-value').textContent=Number($('splat-size').value).toFixed(1)+'×';};$('depth-colors').onchange=()=>viewer.material.uniforms.showDepth.value=$('depth-colors').checked;
window.addEventListener('keydown',e=>{if(e.code==='Space'&&!['INPUT','SELECT','BUTTON'].includes(e.target.tagName)){e.preventDefault();togglePlay().catch(error);}});
window.addEventListener('beforeunload',e=>{if(recording||uploadQueue.length){e.preventDefault();e.returnValue='Recording is still active.';}});
let last=performance.now(),frameCount=0,fpsStart=last;
function tick(now){
 const dt=Math.min((now-last)/1000,.1);last=now;
 if(source==='demo'){
  if(demoPlaying)demoTime=(demoTime+dt*Number($('speed').value))%30;
  if(now-lastDemo>60){const d=demo.frame(demoTime);if(spatial)viewer.setDepth(d,256,144);lastDemo=now;}
 }else if(source!=='idle'&&depthReady&&!baking&&(spatial||(source==='live'&&recording)))inferCurrent().catch(e=>{lastInference=performance.now()+4000;error(e);});
 if(spatial){viewer.frame(dt);frameCount++;$('view-hint').textContent=viewer.viewCoverage()>25?'OUTSIDE CAPTURED COVERAGE · ADDITIONAL CAMERA VIEWS REQUIRED':'FULL-RESOLUTION TEXTURE · DRAG TO ORBIT · WASD TO MOVE';}
 if(now-fpsStart>1000){$('stat-fps').textContent=spatial?Math.round(frameCount*1000/(now-fpsStart)):'—';frameCount=0;fpsStart=now;}
 const duration=source==='demo'?30:source==='replay'?(Number.isFinite(video.duration)?video.duration:0):recording?(performance.now()-recordStart)/1000:0;
 const position=source==='idle'?0:source==='live'?duration:sourceTime();for(const id of ['play','rewind','scrubber','speed'])$(id).disabled=baking||!(source==='replay'||source==='demo'||recording);$('time-current').textContent=time(position);$('time-total').textContent=time(duration);$('view-clock').textContent=fullTime(position);
 if(!scrubbing){$('scrubber').max=String(Math.max(1,duration));$('scrubber').value=String(position);}
 $('timeline-mid').textContent=time(duration/2);$('timeline-end').textContent=source==='live'?'NOW':time(duration);$('timeline-status').textContent=recording?'● CAPTURE CONTINUES':source==='demo'?'30 SEC · SYNTHETIC SAMPLE':source==='replay'?`${depthIndex.length} ${depthQuality==='hq'?'HQ ':''}DEPTH FRAMES`:'Ready when you are';
 $('play').textContent=(source==='demo'?demoPlaying:source==='replay'?!video.paused:false)?'Ⅱ':'▶';
 requestAnimationFrame(tick);
}
async function boot(){
 config=await api('/api/config');$('save-path').textContent=config.recordingsDir;
 if(!config.ffmpeg)toast('FFmpeg is missing. Recording is disabled until it is installed.',15000);
 try{viewer=new SplatViewer($('spatial-canvas'));viewer.setResolution(640,360);demo=new DemoScene(demoCanvas);demo.frame(0);viewer.source(demoCanvas);$('stat-splats').textContent='230.4k';setSource('idle');requestAnimationFrame(tick);}catch(e){error(e);$('mode-spatial').disabled=true;}
 await refreshLibrary();
 try{await connect();}catch(e){toast(e.message);}
 const query=new URLSearchParams(location.search),item=recordings.find(r=>r.id===query.get('recording'));if(item){await openRecording(item);if(query.has('t'))await replayAt(Number(query.get('t')));if(query.get('view')==='4d')await setSpatial(true);}
}
boot().catch(error);
