import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gradeRig,summarizeFrames} from '../rig-quality.mjs';
import {imageMetrics} from '../src/image-metrics.js';

const times=Array.from({length:601},(_,i)=>i/30);
const rig={id:'unit-test',cameras:[{},{}]};
const cameras=Array.from({length:2},(_,slot)=>({slot,saved:true,targetFps:30,encoded:summarizeFrames(times,30),observed:summarizeFrames(times,30)}));
test('perfect capture cannot receive a realism grade without reconstruction evidence',()=>{
 const r=gradeRig(rig,cameras);assert.equal(r.verifiedGates,2);assert.equal(r.realismScore,null);assert.equal(r.verdict,'TARGET NOT MET');
 assert.equal(r.gates.find(g=>g.id==='geometry').status,'fail');assert.equal(r.gates.find(g=>g.id==='holdout').status,'unverified');
 assert.equal(gradeRig({...rig,simulated:true},cameras).verdict,'SOFTWARE TEST ONLY');
});
test('one stalled camera, recovered timing or missing observations fails temporal gate',()=>{
 const badTimes=[...times.slice(0,100),...times.slice(104)];
 for(const replacement of [{encoded:summarizeFrames(badTimes,30)},{encoded:summarizeFrames([0,...times],30)},{observed:null},{timingRecovered:true},{observed:summarizeFrames(times.slice(0,100),30)}]){
  const report=gradeRig(rig,[cameras[0],{...cameras[1],...replacement}]);assert.equal(report.gates.find(g=>g.id==='cadence').status,'fail');
 }
 assert.equal(summarizeFrames([0,0,1],30).nonIncreasingIntervals,1);assert.equal(summarizeFrames([0,NaN],30),null);
});
test('image diagnostic penalizes distortion and requires identical dimensions',()=>{
 const original=new Uint8ClampedArray(16*16*4);for(let i=0;i<original.length;i+=4){original[i]=i%256;original[i+1]=100;original[i+2]=200;original[i+3]=255;}
 const identical=imageMetrics(original,original,16,16);assert.equal(identical.mae,0);assert.equal(identical.ssim,1);assert.equal(identical.exactPixelMatch,true);
 const black=new Uint8ClampedArray(original.length),bad=imageMetrics(original,black,16,16);assert.ok(bad.mae>50);assert.ok(bad.psnr<15);assert.ok(bad.ssim<.5);
 assert.throws(()=>imageMetrics(original,black,15,16),/dimensions/);
});
