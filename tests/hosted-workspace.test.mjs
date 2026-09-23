import test from 'node:test';
import assert from 'node:assert/strict';
import {browserNotebook} from '../src/hosted-workspace.js';
const memory=()=>{const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};};
const input={title:'Phone experiment',hypothesis:'Check the mobile session flow',successCriteria:'Controls fit and notes persist',status:'active'};
const post=(api,url,value)=>api(url,{method:'POST',body:JSON.stringify(value)});
test('hosted notes persist in the same browser, remain isolated, and reject stale edits',async()=>{
 const storage=memory(),api=browserNotebook(storage,()=> 'test-id');
 const e=await post(api,'/api/lab/experiments',{...input,status:'planned'});
 await post(api,`/api/lab/experiments/${e.id}/notes`,{revision:1,kind:'next-step',text:'Controls are readable on mobile'});
 await assert.rejects(post(api,`/api/lab/experiments/${e.id}`,{...input,revision:1}),/changed/);
 const restored=await browserNotebook(storage)('/api/lab/experiments/test-id');
 assert.equal(restored.notes.length,1);assert.equal(restored.revision,2);
 assert.equal(restored.status,'planned');assert.equal(restored.notes[0].kind,'next-step');
 assert.deepEqual(await browserNotebook(memory())('/api/lab/experiments'),[]);
});
test('hosted preview refuses recording and GPU work rather than claiming success',async()=>{
 const api=browserNotebook(memory());
 assert.equal((await api('/api/config')).ffmpeg,false);
 for(const route of ['/api/rigs','/api/live-scene/start','/api/reconstructions'])await assert.rejects(post(api,route,{}),/desktop engine/);
 assert.deepEqual(await api('/api/rigs'),[]);
});
test('hosted reports contain notes and never fabricate reconstruction measurements',async()=>{
 const api=browserNotebook(memory(),()=> 'test-id');
 await assert.rejects(post(api,'/api/lab/experiments',{...input,title:'x'}),/Name/);
 await post(api,'/api/lab/experiments',input);
 const report=await api('/api/lab/experiments/test-id/report.json');
 assert.equal(report.experiment.title,input.title);assert.deepEqual(report.builds,[]);assert.deepEqual(report.sessions,[]);
});
