import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

// Isolated app test: generated scene images enter browser video streams, then
// the real GPU worker estimates poses. No user camera or recording is used.
const store=path.resolve('.test-recordings','rig-setup-'+randomUUID()),base='http://127.0.0.1:8801';await fs.mkdir(store,{recursive:true});
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'8801',RECORDINGS_DIR:store},windowsHide:true,stdio:['ignore','pipe','pipe']});let browser;
try{
 await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',c=>reject(new Error(`Test service exited ${c}`)));});
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/fixture-*.jpg',async route=>{const i=/fixture-(\d)\.jpg/.exec(route.request().url())[1];await route.fulfill({contentType:'image/jpeg',body:await fs.readFile(`artifacts/four-view-verification/camera-${i}.jpg`)});});
 await page.goto(base+'/rig.html?demo=1');await page.locator('#connect-rig').waitFor();await page.locator('#add-camera').click();await page.locator('#add-camera').click();await page.locator('#connect-rig').click();
 await page.waitForFunction(()=>[...document.querySelectorAll('#camera-grid video')].every(v=>v.readyState>=2));
 await page.evaluate(async()=>{window.fixtureTimers=[];await Promise.all([...document.querySelectorAll('#camera-grid video')].map(async(v,i)=>{const image=new Image();image.src=`/fixture-${i}.jpg`;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');const draw=()=>ctx.drawImage(image,0,0);draw();window.fixtureTimers.push(setInterval(draw,100));v.srcObject=canvas.captureStream(10);await v.play();}));});
 await page.locator('[data-lab-tab="setup"]').click();await page.locator('#rig-locate').click();
 await page.waitForFunction(()=>document.getElementById('rig-setup-state').textContent.startsWith('Estimated 4 camera positions'),null,{timeout:90000});
 assert.equal(await page.locator('#rig-positions tr').count(),4);assert.equal(await page.locator('#rig-source-images img').count(),4);assert.match(await page.locator('#rig-floor-state').textContent(),/unknown/);
 assert.equal((await(await fetch(base+'/api/rigs')).json()).length,0);assert.deepEqual(await fs.readdir(store),[]);
 await page.locator('#rig-baseline').fill('2.4');await page.locator('#rig-apply-scale').click();assert.match(await page.locator('#rig-scale-state').textContent(),/2.4 m/);assert.match(await page.locator('#rig-floor-state').textContent(),/unknown/);
 await page.locator('#rig-reference-level').check();await page.locator('#rig-reference-height').fill('1.5');await page.locator('#rig-apply-floor').click();assert.match(await page.locator('#rig-positions tr').first().textContent(),/1.50 m/);
 await page.locator('#rig-layout-canvas').evaluate(el=>window.scrollTo(0,el.getBoundingClientRect().top+window.scrollY-120));await page.locator('#rig-layout-canvas').screenshot({path:'artifacts/rig-setup-four-view.png'});
 const downloading=page.waitForEvent('download');await page.locator('#rig-export').click();const download=await downloading;const downloadPath=await download.path(),record=JSON.parse(await fs.readFile(downloadPath,'utf8'));
 assert.equal(record.simulated,true);assert.equal(record.calibration.views.length,4);assert.equal(record.layout.units,'m');assert.equal(record.layout.floorKnown,true);assert.equal(record.layout.cameras.length,4);assert.equal(record.cameras.some(c=>c.image||c.deviceId),false);assert.equal(record.exposureSynchronization.startsWith('unverified'),true);
 await page.locator('#rig-top').click();await page.locator('#rig-source-images button').nth(2).click();assert.equal(await page.locator('#rig-show-images').isChecked(),false);await page.locator('#rig-overview').click();
 await page.locator('#rig-moved').click();assert.equal(await page.locator('#rig-export').isEnabled(),false);assert.match(await page.locator('#rig-setup-state').textContent(),/camera moved/);
 // Re-estimation uses a fresh worker and restores valid export state.
 await page.locator('#rig-locate').click();await page.waitForFunction(()=>document.getElementById('rig-setup-state').textContent.startsWith('Estimated 4 camera positions'),null,{timeout:90000});assert.equal(await page.locator('#rig-export').isEnabled(),true);assert.match(await page.locator('#rig-scale-state').textContent(),/No measured scale/);
 await page.locator('[data-lab-tab="capture"]').click();await page.locator('#disconnect-rig').click();await page.locator('[data-lab-tab="setup"]').click();await page.waitForFunction(()=>document.getElementById('rig-export').disabled);
 assert.match(await page.locator('#rig-setup-state').textContent(),/connections or image sizes changed/);
 await page.locator('#rig-locate').click();assert.match(await page.locator('#rig-setup-state').textContent(),/Every assigned camera needs an advancing preview/);
 // The one-shot request must release its GPU lease, including after failure.
 const token=(await(await fetch(base+'/api/config')).json()).token;
 const post=(route,value)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-Spatial-Token':token},body:JSON.stringify(value)});
 const started=await post('/api/live-scene/start',{});assert.equal(started.status,200);const {id}=await started.json();await post('/api/live-scene/stop',{id});
 assert.deepEqual(await fs.readdir(store),[]);assert.deepEqual(errors,[]);
 // Persisted tab selection works after a normal (non-demo) reload as well.
 await page.goto(base+'/rig.html');await page.locator('#rig-locate').waitFor({state:'visible'});assert.equal(await page.locator('[data-lab-tab="setup"]').getAttribute('aria-current'),'page');
 await page.setViewportSize({width:650,height:900});await page.screenshot({path:'artifacts/rig-setup-empty-mobile.png'});
 console.log(JSON.stringify({passed:true,scope:'Four synthetic views, real GPU inference, scale/floor export, fresh re-estimation, stale/disconnected rejection, no recordings',pageErrors:errors,referenceHeight:record.layout.cameras[0].height}));
}finally{await browser?.close();server.kill();}
