import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

test('mixed aspect ratios and fractional FPS survive recording, export and seekable playback',async()=>{
 const dir=path.resolve('.test-recordings','mixed-'+randomUUID());await fs.mkdir(dir,{recursive:true});
 const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'8797',RECORDINGS_DIR:dir},windowsHide:true,stdio:['ignore','pipe','pipe']});
 try{
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',code=>reject(new Error('Test server exited '+code)));});
  const base='http://127.0.0.1:8797',config=await(await fetch(base+'/api/config')).json();
  const post=(url,value)=>fetch(base+url,{method:'POST',headers:{'X-Spatial-Token':config.token},body:Buffer.isBuffer(value)?value:JSON.stringify(value)});
  const experiment=await(await post('/api/lab/experiments',{title:'Mixed camera formats',hypothesis:'Different capture sizes and cadences remain independent.',successCriteria:'Both videos retain source resolution, frame timing and bytes.',group:'Software verification'})).json();
  const context={experimentId:experiment.id,whatChanged:'Landscape 24 FPS plus portrait 29.97 FPS.',procedure:'Save two independent two-second generated clips.'};
  const cameras=[{slot:0,label:'Landscape',deviceId:'synthetic-landscape',width:384,height:216,frameRate:24},{slot:7,label:'Portrait',deviceId:'synthetic-portrait',width:240,height:320,frameRate:30000/1001}];
  const response=await post('/api/rigs',{context,simulated:true,cameras,clockOriginUnixMs:Date.now()});assert.equal(response.status,201);const rig=await response.json();
  for(const [index,camera] of cameras.entries()){
   const file=path.join(dir,`fixture-${index}.webm`),rate=index?'30000/1001':'24';
   execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i',`testsrc2=size=${camera.width}x${camera.height}:rate=${rate}`,'-t','2','-c:v','libvpx','-an',file],{windowsHide:true});
   const data=await fs.readFile(file),session=rig.cameras[index].sessionId;
   assert.equal((await post(`/api/sessions/${session}/chunk?seq=0&time=2`,data)).status,200);
   assert.equal((await post(`/api/sessions/${session}/stop`,{})).status,200);
   assert.deepEqual(await fs.readFile(path.join(dir,session,'capture.webm')),data);
   const saved=path.join(dir,session,'recording.webm');
   const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height,avg_frame_rate','-show_entries','format=duration','-of','json',saved],{windowsHide:true,encoding:'utf8'}));
   assert.equal(probe.streams[0].width,camera.width);assert.equal(probe.streams[0].height,camera.height);assert.ok(Number(probe.format.duration)>1.9);
   const [n,d]=probe.streams[0].avg_frame_rate.split('/').map(Number);assert.ok(Math.abs(n/d-camera.frameRate)<.002);
   assert.equal((await fetch(base+`/recordings/${session}/recording.webm`,{headers:{Range:'bytes=0-99'}})).status,206);
  }
  const finished=await post(`/api/rigs/${rig.id}/finish`,{cameras:cameras.map(c=>({slot:c.slot,startRequestedMs:0,stopRequestedMs:2000})),markers:[]});assert.equal(finished.status,200);
  const manifest=await(await fetch(base+`/api/rigs/${rig.id}/manifest`)).json();
  cameras.forEach((c,i)=>assert.deepEqual(manifest.cameras[i].settings,{width:c.width,height:c.height,frameRate:c.frameRate}));
  assert.equal(manifest.status,'saved');
 }finally{child.kill();}
});
