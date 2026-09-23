import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';

// Exercise the actual viewer and worker with an existing 120k-Gaussian scene.
// This isolated page does not connect cameras or modify the user's browser.
const fixture=process.argv[2]||'b79848a5-1e79-4533-91cb-fe906f67db91';
const folder=path.resolve('.reconstructions',fixture),manifest=JSON.parse(await fs.readFile(path.join(folder,'manifest.json'),'utf8'));
const bytes=await fs.readFile(path.join(folder,manifest.frames[0].file));
const server=await createServer({configFile:false,root:process.cwd(),server:{host:'127.0.0.1',port:8798,strictPort:true},logLevel:'error'});
let browser;
try{
 await server.listen();browser=await chromium.launch({executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/flight-test.html',route=>route.fulfill({contentType:'text/html',body:'<body style="margin:0"><canvas style="width:100%;height:650px"></canvas><input id="editor"><script type="module">import {CombinedViewer} from "/src/combined-viewer.js";window.viewer=new CombinedViewer(document.querySelector("canvas"));window.sorts=0;viewer.worker.addEventListener("message",()=>window.sorts++);</script>'}));
 await page.goto('http://127.0.0.1:8798/flight-test.html');await page.waitForFunction(()=>window.viewer?.worker);
 await page.evaluate(({manifest,encoded})=>{viewer.setCalibration(manifest);const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));viewer.load(bytes.buffer);viewer.snap(0);},{manifest,encoded:bytes.toString('base64')});
 await page.waitForFunction(()=>sorts>0&&!viewer.sortPending);await page.waitForTimeout(200);
 assert.equal(await page.evaluate(()=>viewer.renderer.info.render.triangles),bytes.length/32*2);
 const read=()=>page.evaluate(()=>({position:viewer.camera.position.toArray(),rotation:viewer.camera.quaternion.toArray(),sorts,velocity:viewer.fly.velocity.length(),mode:viewer.mode}));
 await page.locator('canvas').click();const home=await read();
 await page.keyboard.down('w');await page.waitForTimeout(500);await page.keyboard.up('w');await page.keyboard.press('x');const moved=await read();
 assert.ok(Math.hypot(...moved.position.map((v,i)=>v-home.position[i]))>.1);assert.equal(moved.sorts,home.sorts,'Translation must not trigger redundant sorting');
 await page.keyboard.down('e');await page.keyboard.down('Shift');await page.waitForTimeout(350);await page.keyboard.up('e');await page.keyboard.up('Shift');await page.keyboard.press('x');const raised=await read();assert.ok(raised.position[1]>moved.position[1]+.1);
 await page.mouse.move(400,300);await page.mouse.down();await page.mouse.move(650,380,{steps:10});await page.mouse.up();await page.waitForFunction(n=>sorts>n,raised.sorts);assert.notDeepEqual((await read()).rotation,raised.rotation);
 await page.locator('#editor').focus();const unfocused=await read();await page.keyboard.type('wasd ');await page.waitForTimeout(100);assert.deepEqual((await read()).position,unfocused.position);assert.equal(await page.locator('#editor').inputValue(),'wasd ');
 await page.evaluate(()=>viewer.snap(0));assert.ok((await read()).position.every((v,i)=>Math.abs(v-home.position[i])<1e-9));
 await page.evaluate(()=>viewer.snap(1));const camera2=await read();assert.ok(Math.hypot(...camera2.position)>.5);
 await page.evaluate(()=>{viewer.setMode('orbit');viewer.setMode('fly');});assert.ok((await read()).position.every((v,i)=>Math.abs(v-camera2.position[i])<1e-9));
 // Reloading a sample must preserve the roaming camera position and rotation.
 await page.evaluate(encoded=>viewer.load(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)).buffer),bytes.toString('base64'));
 assert.ok((await read()).position.every((v,i)=>Math.abs(v-camera2.position[i])<1e-9));await page.waitForFunction(()=>!viewer.sortPending);
 await page.evaluate(()=>viewer.snap(0));await page.waitForTimeout(200);
 await page.screenshot({path:'artifacts/surface-navigation-test.png'});
 await page.evaluate(()=>{viewer.camera.position.x+=.3;viewer.camera.position.z-=.3;});await page.waitForTimeout(200);
 await page.screenshot({path:'artifacts/surface-novel-view-test.png'});
 const timing=await page.evaluate(()=>new Promise(resolve=>{const times=[];let last=performance.now();function frame(now){times.push(now-last);last=now;if(times.length<90)requestAnimationFrame(frame);else{times.sort((a,b)=>a-b);resolve({medianFrameMs:times[45],p95FrameMs:times[85]});}}requestAnimationFrame(frame);}));
 assert.deepEqual(errors,[]);console.log(JSON.stringify({scene:fixture,gaussians:bytes.length/32,workerSorts:(await read()).sorts,...timing,passed:['GPU drawing','worker depth sorting','no redundant translation sorting','free flight','vertical boost','mouse look','input focus safety','home views','orbit switch','sample reload preserves position']},null,2));
 await page.evaluate(()=>viewer.dispose());
}finally{await browser?.close();await server.close();}
