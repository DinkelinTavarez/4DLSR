import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {experimentLibrary} from '../experiment-library.mjs';

test('Experiment archives keep independent originals, versioned exports and scores across reloads',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'spatial-library-')),store=path.join(root,'recordings');
 const rig={id:randomUUID(),name:'Experiment',created:new Date().toISOString(),status:'saved',cameras:[{slot:0,label:'Camera 1',sessionId:randomUUID()},{slot:3,label:'Camera 4',sessionId:randomUUID()}]};
 const json=async(file,data)=>{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(data));};
 await json(path.join(store,'.rigs',rig.id+'.json'),rig);
 for(const camera of rig.cameras){await json(path.join(store,camera.sessionId,'session.json'),{status:'saved'});await fs.writeFile(path.join(store,camera.sessionId,'recording.webm'),Buffer.from('original '+camera.slot));}
 const build=randomUUID(),source=path.join(root,'.reconstructions',build);
 await json(path.join(source,'spec.json'),{rigId:rig.id,profile:'quick',mode:'sequence',created:rig.created,cameras:rig.cameras.map(c=>({...c,file:'old-absolute-path'}))});
 await json(path.join(source,'status.json'),{state:'complete'});await json(path.join(source,'manifest.json'),{frames:[{time:0,file:'frame-00000.splat'}]});await fs.writeFile(path.join(source,'frame-00000.splat'),Buffer.alloc(32,9));
 await json(path.join(source,'evaluation.json'),{summary:{sourceViewScore:12,realismScore:null}});
 const options={root,store,serialized:async(_,fn)=>fn()},library=experimentLibrary(options),entry=await library.archive(rig);
 assert.equal(entry.originals.length,2);assert.equal(entry.reconstructions.length,1);assert.equal(entry.reconstructions[0].score.sourceViewScore,12);
 const exported=path.join(entry.path,'reconstructions',build,'frame-00000.splat');assert.deepEqual(await fs.readFile(exported),await fs.readFile(path.join(source,'frame-00000.splat')));
 await fs.writeFile(exported,Buffer.alloc(32,1));assert.deepEqual(await fs.readFile(path.join(source,'frame-00000.splat')),Buffer.alloc(32,9),'Editing an archive copy must not change source assets');
 const spec=JSON.parse(await fs.readFile(path.join(entry.path,'reconstructions',build,'spec.json')));assert.ok(spec.cameras.every(c=>c.file.startsWith('../../originals/')));
 await json(path.join(source,'evaluation.json'),{summary:{sourceViewScore:20,realismScore:null}});
 const reload=experimentLibrary(options),result=await reload.sync();assert.equal(result.errors.length,0);assert.equal(result.entries.length,1);assert.equal(result.entries[0].reconstructions[0].score.sourceViewScore,20);
 const other={...rig,id:randomUUID(),created:new Date().toISOString()};await json(path.join(store,'.rigs',other.id+'.json'),other);await library.archive(other);
 assert.equal((await library.sync()).entries.length,2,'Each take must have its own persistent experiment folder');
});
