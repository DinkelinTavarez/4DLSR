import {deliveryGrade,deliveryWindowMs} from './capture-policy.js';

export function cameraDelivery(c){
 const label=document.createElement('span');label.className='camera-delivery';label.textContent='Delivery not measured';c.tile.querySelector('.camera-footer').append(label);
 let timer,generation=0;
 const stop=()=>{generation++;clearTimeout(timer);c.deliveryHealth=null;label.textContent='Delivery not measured';c.tile.classList.remove('delivery-shortfall');};
 const start=()=>{
  stop();const run=generation,stream=c.stream,points=[];
  label.textContent='Measuring delivered FPS…';
  const poll=async()=>{
   try{
    const sample=c.bridge?await c.bridge.delivery():{at:performance.now(),frames:c.video.getVideoPlaybackQuality?.().totalVideoFrames};
    if(run!==generation||stream!==c.stream)return;
    if(sample&&Number.isFinite(sample.frames)){
     const targetWindow=deliveryWindowMs(c.requested.frameRate);
     points.push(sample);while(points.length>2&&points[1].at<=sample.at-targetWindow)points.shift();
     const first=points[0],windowMs=sample.at-first.at,fps=windowMs>0?(sample.frames-first.frames)*1000/windowMs:null;
     const grade=deliveryGrade(c.requested.frameRate,fps,windowMs);c.deliveryHealth={grade,fps,windowMs,at:performance.now()};
     label.textContent=grade==='measuring'?'Measuring delivered FPS…':`${fps.toFixed(2)} / ${Number(c.requested.frameRate.toFixed(3))} delivered FPS · ${grade==='on-target'?'on target':'BELOW TARGET'} (${Math.round(targetWindow/1000)}-second window)`;
     c.tile.classList.toggle('delivery-shortfall',grade==='below-target');
    }
   }catch{if(run===generation){c.deliveryHealth=null;label.textContent='Delivery measurement unavailable';}}
   if(run===generation)timer=setTimeout(poll,1000);
  };poll();
 };
 return {start,stop};
}
