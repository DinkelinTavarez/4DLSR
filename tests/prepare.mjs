import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1060}});
try{
 await page.goto('http://127.0.0.1:8795');await page.locator('#library-toggle').click();await page.locator('.recording-row').first().locator('button').click();await page.waitForFunction(()=>document.getElementById('source-tag').textContent==='REPLAY');
 await page.locator('#prepare').click();await page.waitForFunction(()=>document.getElementById('prepare').textContent.includes('Cancel'),{},{timeout:90000});
 await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('4D preparation complete'),{},{timeout:180000});
 const saved=await page.evaluate(async()=>{const s=(await(await fetch('/api/sessions')).json())[0];const index=await(await fetch(`/api/sessions/${s.id}/depth-index`)).json();return {duration:s.duration,count:index.length,last:index.at(-1)};});
 assert.ok(saved.count>=Math.floor(saved.duration*2));assert.ok(saved.last>=saved.duration*1000-1000);
 await page.locator('#mode-spatial').click();await page.waitForSelector('#depth-overlay',{state:'hidden',timeout:30000});
 await page.locator('#scrubber').evaluate(el=>{el.value='3';el.dispatchEvent(new Event('input'));el.dispatchEvent(new Event('change'));});
 await page.waitForFunction(()=>Math.abs(document.getElementById('playback-video').currentTime-3)<.2);
 await page.locator('#play').click();await page.waitForTimeout(1000);assert.ok(await page.locator('#playback-video').evaluate(v=>v.currentTime>3.5));
 console.log('PASS: full-clip preparation, persisted temporal depth coverage, cached seek, continued spatial playback.',JSON.stringify(saved));
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 console.log('PASS: mobile viewport has no horizontal overflow.');
}finally{await browser.close();}
