import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:8794',rig='4713b169-a46d-4ce0-9ff6-e4d9053449e7',job='829bdc8f-01bc-4b45-bdc2-53e5d5bfea4e';
const archive=await(await fetch(`${base}/api/experiments/${rig}`)).json();
assert.equal(archive.originals.length,2);const build=archive.reconstructions.find(b=>b.id===job);assert.ok(build.files.includes('frame-00075.splat'));assert.ok(build.files.includes('mesh-00075.glb'));assert.ok(build.files.includes('evaluation.json'));
const report=await(await fetch(`${base}/api/experiments/${rig}/files/reconstructions/${job}/evaluation.json`)).json();assert.equal(report.summary.viewsCompared,152);assert.equal(report.summary.realismScore,null);
const original=await fetch(`${base}/api/experiments/${rig}/files/${archive.originals[0].file}`,{headers:{Range:'bytes=0-31'}});assert.equal(original.status,206);assert.equal((await original.arrayBuffer()).byteLength,32);
assert.equal((await fetch(`${base}/api/experiments/${rig}/files/reconstructions/${job}/worker.log`)).status,400);
const browser=await chromium.launch({executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>localStorage.setItem('spatial-auto-connect','false'));await page.goto(base+'/rig.html');await page.locator('[data-lab-tab="library"]').click();
 await page.getByRole('heading',{name:'Experiment library',exact:true}).waitFor();const row=page.locator(`[data-take-id="${rig}"]`);await row.waitFor();
 await page.getByRole('searchbox',{name:'Search experiments'}).fill('not-an-experiment');assert.equal(await row.isVisible(),false);await page.getByRole('searchbox',{name:'Search experiments'}).fill('');
 await row.locator('summary').click();await row.getByRole('combobox',{name:'Saved 3D build'}).selectOption(job);assert.equal(await row.getByRole('link',{name:'Score report',exact:true}).isVisible(),true);
 await row.getByRole('button',{name:'Open saved 3D',exact:true}).click();await page.waitForFunction(()=>document.getElementById('reconstruction-score').textContent.includes('152 source-view comparisons'));
 assert.match(await page.locator('#reconstruction-score').textContent(),/12.1 \/ 100/);
 assert.ok(await page.locator('.reconstruction-comparison').evaluate(img=>img.complete&&img.naturalWidth>0));
 await page.locator('#reconstruction-score select').selectOption('comparison-00075-1.jpg');await page.waitForFunction(()=>document.querySelector('.reconstruction-comparison').src.endsWith('comparison-00075-1.jpg')&&document.querySelector('.reconstruction-comparison').complete);
 await page.locator('#reconstruction-score').screenshot({path:'artifacts/source-score-report.png'});
 await page.getByRole('button',{name:'Expand viewer',exact:true}).click();await page.getByRole('button',{name:'Score / compare',exact:true}).click();assert.equal(await page.locator('#combined-stage.expanded').count(),0);
 await page.reload();await page.locator('[data-lab-tab="library"]').click();await page.locator(`[data-take-id="${rig}"]`).waitFor();assert.equal(await page.locator(`[data-take-id="${rig}"]`).getByRole('button',{name:'Open latest 3D',exact:true}).isVisible(),true);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({rig,archive:archive.path,builds:archive.reconstructions.length,sourceScore:report.summary.sourceViewScore,passed:['saved originals and all 76 model/GSP samples','independent versioned archives','source report with 152 comparisons','range video playback','file allowlist','library search','open a saved build','comparison images','expanded viewer to scoring','reload persistence','no page errors']},null,2));
}finally{await browser.close();}
