import {chromium} from '@playwright/test';
const visible=process.argv.includes('--visible');
const browser=await chromium.launch({executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:!visible,args:['--use-fake-ui-for-media-stream']});
try {
 const context=await browser.newContext({permissions:['camera']});
 const page=await context.newPage();
 page.on('pageerror',e=>console.log('PAGE ERROR',e.message));
 await page.goto('http://127.0.0.1:8794/rig.html');
 await page.waitForFunction(()=>!document.getElementById('connect-rig').disabled);
 await page.locator('#scan-cameras').click();
 await page.waitForFunction(()=>!document.getElementById('scan-cameras').disabled);
 for(let attempt=1;attempt<=2;attempt++){
  await page.locator('#connect-rig').click();
  await page.waitForFunction(()=>!document.getElementById('connect-rig').disabled,null,{timeout:65000});
  const result=await page.locator('#camera-grid video').evaluateAll(async vs=>{
   const before=vs.map(v=>v.getVideoPlaybackQuality().totalVideoFrames);
   await new Promise(r=>setTimeout(r,2000));
   return vs.map((v,i)=>({frames:v.getVideoPlaybackQuality().totalVideoFrames-before[i],settings:v.srcObject?.getVideoTracks()[0]?.getSettings()}));
  });
  console.log(JSON.stringify({attempt,status:await page.locator('#device-status').innerText(),result}));
  if(result.length>=2&&result.every(v=>v.frames>0))break;
 }
 if(visible){
  console.log('Camera window ready. Preview only; recording starts only when Record is clicked. Close the window to exit.');
  await new Promise(resolve=>browser.once('disconnected',resolve));
 }else await page.locator('#disconnect-rig').click();
}finally{await browser.close();}
