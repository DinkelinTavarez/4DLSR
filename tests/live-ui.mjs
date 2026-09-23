import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

// Four rendered fixture images feed canvas video streams in an isolated browser.
// The real live-scene backend runs; no physical camera or private footage is used.
const store=path.resolve('.test-recordings','live-ui-'+randomUUID()),base='http://127.0.0.1:8799';await fs.mkdir(store,{recursive:true});
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'8799',RECORDINGS_DIR:store},windowsHide:true,stdio:['ignore','pipe','pipe']});let browser;
try{
 await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',c=>reject(new Error(`Test service exited ${c}`)));});
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/fixture-*.jpg',async route=>{const i=/fixture-(\d)\.jpg/.exec(route.request().url())[1];await route.fulfill({contentType:'image/jpeg',body:await fs.readFile(`artifacts/four-view-verification/camera-${i}.jpg`)});});
 await page.goto(base+'/rig.html?demo=1');await page.locator('#connect-rig').waitFor();
 await page.locator('#add-camera').click();await page.locator('#add-camera').click();await page.locator('#connect-rig').click();
 await page.waitForFunction(()=>[...document.querySelectorAll('#camera-grid video')].every(v=>v.readyState>=2));
 await page.evaluate(async()=>{window.fixtureTimers=[];await Promise.all([...document.querySelectorAll('#camera-grid video')].map(async(v,i)=>{const image=new Image();image.src=`/fixture-${i}.jpg`;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');const draw=()=>ctx.drawImage(image,0,0);draw();window.fixtureTimers.push(setInterval(draw,100));v.srcObject=canvas.captureStream(10);await v.play();}));});
 await page.locator('#live-scene-start').click();
 await page.waitForFunction(()=>document.getElementById('live-scene-state').textContent.includes('4 views'),null,{timeout:60000});
 assert.equal(await page.locator('#live-scene-canvas').isVisible(),true);const first=await page.locator('#live-scene-state').textContent();
 await page.locator('#live-scene-canvas').screenshot({path:'artifacts/live-four-view-draft.png'});
 await page.locator('#live-scene-stop').click();await page.waitForFunction(()=>document.getElementById('live-scene-state').textContent.startsWith('Stopped.'));
 assert.equal((await(await fetch(base+'/api/rigs')).json()).length,0);assert.deepEqual(await fs.readdir(store),[]);
 assert.equal(await page.locator('#live-scene-start').isEnabled(),true);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,scope:'Four synthetic fixture streams through real browser capture and GPU inference',state:first,noRecording:true,pageErrors:errors}));
}finally{await browser?.close();server.kill();}
