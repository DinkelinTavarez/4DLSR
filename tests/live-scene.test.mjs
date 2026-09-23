import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

test('memory-only four-view drafts reuse geometry, exclude offline GPU jobs and stop cleanly',async()=>{
 const store=path.resolve('.test-recordings','live-'+randomUUID());await fs.mkdir(store,{recursive:true});
 const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'8798',RECORDINGS_DIR:store},windowsHide:true,stdio:['ignore','pipe','pipe']});let id;
 const base='http://127.0.0.1:8798';let token;
 const post=(route,value)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-Spatial-Token':token},body:JSON.stringify(value)});
 try{
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',c=>reject(new Error(`Server exited ${c}`)));});
  token=(await(await fetch(base+'/api/config')).json()).token;
  id=(await(await post('/api/live-scene/start',{})).json()).id;assert.ok(id);
  assert.equal((await post('/api/live-scene/start',{})).status,409);
  assert.equal((await post('/api/reconstructions',{})).status,409);
  assert.equal((await post('/api/live-scene/update',{id,frames:[]})).status,400);
  const frames=await Promise.all([0,1,2,3].map(async slot=>({slot,image:'data:image/jpeg;base64,'+(await fs.readFile(`artifacts/four-view-verification/camera-${slot}.jpg`)).toString('base64')})));
  const times=[];
  for(let i=0;i<2;i++){
   const r=await post('/api/live-scene/update',{id,frames});const scene=await r.json();assert.equal(r.status,200,JSON.stringify(scene));
   assert.equal(scene.calibration.views.length,4);assert.equal(scene.support.support.length,4);assert.equal(Buffer.from(scene.splat,'base64').length,scene.gaussians*32);assert.equal(scene.kind,'untrained-live-geometry-draft');times.push(scene.processingSeconds);
   assert.equal(scene.gaussianLimit,null);assert.ok(scene.gaussians>40000,`Expected all geometry above old cap, got ${scene.gaussians}`);
   console.log(JSON.stringify({views:4,gaussians:scene.gaussians,gaussianLimit:scene.gaussianLimit,processingSeconds:scene.processingSeconds}));
  }
  assert.deepEqual(await fs.readdir(store),[],'Preview must not persist recordings or frames');
  assert.equal((await post('/api/live-scene/stop',{id})).status,200);
  assert.equal((await post('/api/live-scene/heartbeat',{id})).status,404);
  console.log(JSON.stringify({scope:'Synthetic four-view live pipeline, not hardware validation',processingSeconds:times,noSavedFrames:true}));
 }finally{if(id)await post('/api/live-scene/stop',{id}).catch(()=>{});child.kill();}
});
