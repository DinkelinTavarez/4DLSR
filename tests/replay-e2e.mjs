import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';

// Playback-only verification against a completed local build. This creates no
// recordings, connects no cameras, and does not touch the user's browser tab.
const base='http://127.0.0.1:8794',job=process.argv[2]||'41fff2d4-274a-45ee-93f5-c17ad1275488';
const info=await(await fetch(`${base}/api/reconstructions/${job}`)).json();assert.equal(info.state,'complete');
const manifest=await(await fetch(`${base}/api/reconstructions/${job}/manifest.json`)).json();
const browser=await chromium.launch({executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[],loaded=new Set();
 page.on('pageerror',error=>errors.push(error.message));page.on('response',response=>{if(response.url().includes(`/api/reconstructions/${job}/frame-`)&&response.status()===200)loaded.add(response.url());});
 await page.addInitScript(()=>localStorage.setItem('spatial-auto-connect','false'));await page.goto(`${base}/rig.html`);await page.locator('[data-lab-tab="library"]').click();
 const take=page.locator('#takes-list .take-row').filter({has:page.locator(`a[href="/api/rigs/${info.rigId}/manifest"]`)});
 await take.getByRole('button',{name:'Reconstruct combined 3D',exact:true}).click();
 assert.equal(await page.locator('#reconstruction-mode').inputValue(),'sequence');
 const sequence=page.locator(`#reconstruction-jobs [data-job-id="${job}"]`);
 await sequence.getByRole('button',{name:'Open combined 3D',exact:true}).click();
 await page.waitForFunction(()=>document.getElementById('combined-frame').textContent.includes('Gaussians'));
 assert.match(await page.locator('#combined-manifest').getAttribute('href'),new RegExp(job));
 assert.equal(await page.locator('#combined-play').isEnabled(),true);assert.equal(await page.locator('#combined-build-replay').isVisible(),false);
 await page.getByRole('button',{name:'Expand viewer',exact:true}).click();
 for(const id of ['combined-play','combined-restart','combined-time','combined-source'])assert.equal(await page.locator(`#combined-stage.expanded #${id}`).isVisible(),true);
 const initial=await page.locator('#combined-canvas').screenshot();
 await page.getByRole('button',{name:'Play 3D replay',exact:true}).click();
 await page.waitForFunction(()=>Number(document.getElementById('combined-time').value)>=4);
 await page.getByRole('button',{name:'Pause 3D replay',exact:true}).click();
 await page.waitForTimeout(150);const paused=await page.locator('#combined-time').inputValue();
 const later=await page.locator('#combined-canvas').screenshot();assert.notDeepEqual(later,initial,'Reconstructed imagery must change with time');
 await page.waitForTimeout(700);assert.equal(await page.locator('#combined-time').inputValue(),paused);
 await page.locator('#combined-canvas').click();await page.keyboard.down('w');await page.waitForTimeout(300);await page.keyboard.up('w');await page.keyboard.press('x');
 const roamed=await page.locator('#combined-canvas').screenshot();assert.notDeepEqual(roamed,later,'Camera must move independently while time is paused');
 await page.getByRole('button',{name:'Play 3D replay',exact:true}).click();await page.locator('#combined-canvas').click();
 await page.keyboard.down('e');await page.waitForTimeout(700);await page.keyboard.up('e');await page.keyboard.press('x');await page.getByRole('button',{name:'Pause 3D replay',exact:true}).click();
 assert.ok(Number(await page.locator('#combined-time').inputValue())>Number(paused));
 // Seek near the end, verify playback stops, then verify replay from the end.
 const nearEnd=manifest.frames.length-2;
 await page.locator('#combined-time').evaluate((el,value)=>{el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));},nearEnd);
 await page.waitForFunction(t=>document.getElementById('combined-frame').textContent.startsWith(t),manifest.frames[nearEnd].time.toFixed(2));
 await page.getByRole('button',{name:'Play 3D replay',exact:true}).click();
 await page.waitForFunction(n=>Number(document.getElementById('combined-time').value)===n&&document.getElementById('combined-play').textContent==='Play 3D replay',manifest.frames.length-1);
 await page.getByRole('button',{name:'Play 3D replay',exact:true}).click();await page.waitForFunction(()=>Number(document.getElementById('combined-time').value)<3);
 await page.getByRole('button',{name:'Restart',exact:true}).click();await page.waitForFunction(()=>document.getElementById('combined-time').value==='0');
 assert.equal(await page.locator('#combined-play').textContent(),'Play 3D replay');
 await page.getByRole('button',{name:'Play original videos',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('#review-grid video').length===2&&Array.from(document.querySelectorAll('#review-grid video')).every(v=>!v.paused&&v.currentTime>.4));
 assert.equal(await page.locator('#combined-stage.expanded').count(),0);await page.getByRole('button',{name:'Pause all angles',exact:true}).click();
 await page.locator('#review-time').evaluate(el=>{el.value='10';el.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('#review-grid video')).every(v=>Math.abs(v.currentTime-10)<.15));
 // A still build must explain why 3D playback is unavailable; originals work.
 await page.locator('[data-lab-tab="reconstruct"]').click();await page.locator('#reconstruction-jobs .take-row').filter({hasText:'maximum · surface-guided · moment · complete'}).first().getByRole('button',{name:'Open combined 3D',exact:true}).click();
 await page.waitForFunction(()=>document.getElementById('combined-playback-status').textContent.startsWith('Still frame'));
 assert.equal(await page.locator('#combined-play').isDisabled(),true);assert.equal(await page.locator('#combined-build-replay').isVisible(),true);
 await page.getByRole('button',{name:'Play original videos',exact:true}).click();await page.waitForFunction(()=>Array.from(document.querySelectorAll('#review-grid video')).every(v=>!v.paused&&v.currentTime>.2));
 await page.getByRole('button',{name:'Pause all angles',exact:true}).click();
 assert.deepEqual(errors,[]);assert.ok(loaded.size>=6);
 console.log(JSON.stringify({job,samples:manifest.frames.length,duration:manifest.frames.at(-1).time,passed:['play/pause','changing 3D imagery','fly while playing','seek','stop at end','replay from end','restart','expanded playback controls','original two-camera video playback and seeking','still-frame explanation'],loadedGaussianFrames:loaded.size},null,2));
}finally{await browser.close();}
