import {chromium} from '@playwright/test';

// Physical preview diagnostic only: no MediaRecorder, files, images, or audio.
const settings=process.argv.includes('--720')?{width:1280,height:720,frameRate:30}:{width:640,height:480,frameRate:15};
const browser=await chromium.launch({executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true,args:['--use-fake-ui-for-media-stream']});
try {
 for(const mode of ['first','second','both']){
  const context=await browser.newContext({permissions:['camera']}),page=await context.newPage();
  await page.goto('http://127.0.0.1:8794/rig.html');
  const result=await page.evaluate(async({mode,settings})=>{
   const devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');
   const selected=mode==='both'?devices:devices.slice(mode==='first'?0:1,mode==='first'?1:2);
   const results=[],streams=[],videos=[];
   for(const d of selected){
    let timer;const started=performance.now();
    try{
     const stream=await Promise.race([navigator.mediaDevices.getUserMedia({video:{deviceId:{exact:d.deviceId},width:{ideal:settings.width},height:{ideal:settings.height},frameRate:{ideal:settings.frameRate}},audio:false}),new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error('Diagnostic timeout')),12000))]);
     clearTimeout(timer);streams.push(stream);const v=document.createElement('video');v.muted=true;v.srcObject=stream;document.body.append(v);await v.play();
     const before=v.getVideoPlaybackQuality().totalVideoFrames;await new Promise(r=>setTimeout(r,1500));
     videos.push(v);const s=stream.getVideoTracks()[0].getSettings();results.push({label:d.label,width:s.width,height:s.height,frameRate:s.frameRate,framesDelivered:v.getVideoPlaybackQuality().totalVideoFrames-before,openMs:Math.round(performance.now()-started)});
    }catch(e){clearTimeout(timer);results.push({label:d.label,error:e.name,message:e.message});}
   }
   const initial=videos.map(v=>v.getVideoPlaybackQuality().totalVideoFrames);await new Promise(r=>setTimeout(r,1500));
   const simultaneousFrames=videos.map((v,i)=>v.getVideoPlaybackQuality().totalVideoFrames-initial[i]);
   streams.forEach(s=>s.getTracks().forEach(t=>t.stop()));
   return {mode,settings,detected:devices.map(d=>d.label),results,simultaneousFrames};
  },{mode,settings});
  console.log(JSON.stringify(result));await context.close();
 }
}finally{await browser.close();}
