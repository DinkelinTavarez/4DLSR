const leaseKey='spatial-owned-camera-leases';
function leases(){try{return JSON.parse(sessionStorage.getItem(leaseKey)||'[]');}catch{return [];}}
function remember(id,add){try{sessionStorage.setItem(leaseKey,JSON.stringify(add?[...new Set([...leases(),id])]:leases().filter(x=>x!==id)));}catch{}}
export async function releasePreviousCameras(post){await Promise.all(leases().map(async id=>{await post('/api/camera-bridge/close',{id});remember(id,false);}));}
export async function openLocalCamera({deviceId,label,width,height,frameRate,captureMode,post}){
 const pc=new RTCPeerConnection({iceServers:[]});let id,heartbeat,timer;
 const close=()=>{clearInterval(heartbeat);clearTimeout(timer);pc.close();if(id){const closed=id;id=null;return post('/api/camera-bridge/close',{id:closed}).then(()=>remember(closed,false)).catch(()=>{});}};
 try{
  const incoming=new Promise(resolve=>pc.ontrack=e=>resolve(new MediaStream([e.track])));
  pc.addTransceiver('video',{direction:'recvonly'});
  await pc.setLocalDescription(await pc.createOffer());
  await new Promise((resolve,reject)=>{if(pc.iceGatheringState==='complete')return resolve();timer=setTimeout(()=>reject(new Error('Local video negotiation timed out')),10000);pc.onicegatheringstatechange=()=>{if(pc.iceGatheringState==='complete'){clearTimeout(timer);resolve();}};});
  const result=await Promise.race([post('/api/camera-bridge/open',{deviceId,label,width,height,frameRate,captureMode,offer:pc.localDescription.toJSON()}),new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error('Local camera service timed out after 12 seconds')),12000))]);clearTimeout(timer);id=result.id;remember(id,true);
  await pc.setRemoteDescription(result.answer);
  const stream=await Promise.race([incoming,new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error('Local camera delivered no track')),12000))]);clearTimeout(timer);
  heartbeat=setInterval(()=>post('/api/camera-bridge/heartbeat',{id}).catch(()=>{stream.getTracks().forEach(t=>{t.stop();t.dispatchEvent(new Event('ended'));});close();}),10000);
  const inspect=async()=>{
   if(!id)throw new Error('Camera is disconnected');
   const source=await post('/api/camera-bridge/inspect',{id}),stats=await pc.getStats();
   const received=[...stats.values()].find(r=>r.type==='inbound-rtp'&&r.kind==='video');
   return {...source,received:{framesPerSecond:received?.framesPerSecond,framesDecoded:received?.framesDecoded,framesDropped:received?.framesDropped,packetsLost:received?.packetsLost,freezeCount:received?.freezeCount}};
  };
  const delivery=async()=>{
   const stats=await pc.getStats(),r=[...stats.values()].find(r=>r.type==='inbound-rtp'&&r.kind==='video');
   return r?{at:r.timestamp,frames:r.framesDecoded,width:r.frameWidth,height:r.frameHeight,framesDropped:r.framesDropped,packetsLost:r.packetsLost}:null;
  };
  return {stream,settings:result.settings,capabilities:result.capabilities,close,inspect,delivery};
 }catch(e){close();throw e;}
}
