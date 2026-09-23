import test from 'node:test';
import assert from 'node:assert/strict';
import {cameraPose,frustumCorners,rigLayout,distance} from '../src/rig-geometry.js';
const I=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];
// A camera at world (2,-1,3), rotated 90 degrees around world Y.
const rotated=[[0,0,1,-3],[0,1,0,1],[-1,0,0,2],[0,0,0,1]];
const near=(a,b)=>a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-9,`${a} != ${b}`));
test('camera centers invert rotated extrinsics, with forward and image-up axes',()=>{
 const pose=cameraPose(rotated);near(pose.center,[2,-1,3]);near(pose.forward,[-1,0,0]);near(pose.up,[0,-1,0]);
});
test('frustum corners project back onto the exact source image corners',()=>{
 const K=[[600,7,300],[0,580,190],[0,0,1]],expected=[[0,0],[640,0],[640,400],[0,400]];
 for(const [i,p]of frustumCorners(rotated,K,640,400,.3).entries()){
  const c=rotated.slice(0,3).map(row=>row[0]*p[0]+row[1]*p[1]+row[2]*p[2]+row[3]);
  near([(K[0][0]*c[0]+K[0][1]*c[1])/c[2]+K[0][2],K[1][1]*c[1]/c[2]+K[1][2]],expected[i]);
 }
});
test('measured sloping baseline scales distances; floor heights require an explicit level reference',()=>{
 const result={cameraSlots:[2,7],calibration:{views:[I,rotated]}};
 const relative=rigLayout(result);assert.equal(relative.units,'relative units');assert.equal(relative.cameras[1].height,null);near(relative.cameras[1].position,[2,1,-3]);
 const baseline={from:2,to:7,meters:2*Math.sqrt(14)},measures={baseline,level:true,referenceHeight:1.5};const scaled=rigLayout(result,measures);
 assert.equal(scaled.units,'m');near([distance(scaled.cameras[0].position,scaled.cameras[1].position),scaled.cameras[1].height,scaled.floorY],[baseline.meters,3.5,-1.5]);
 assert.equal(rigLayout(result,{baseline,referenceHeight:1.5}).floorKnown,false);
 assert.equal(rigLayout(result,{level:true,referenceHeight:1.5}).floorKnown,false);
 assert.throws(()=>rigLayout(result,{baseline:{...baseline,to:2}}));assert.throws(()=>rigLayout(result,{baseline:{...baseline,meters:NaN}}));
 assert.throws(()=>rigLayout({...result,cameraSlots:[0]}));
 assert.equal(rigLayout({cameraSlots:[2,7],calibration:{views:[rotated,I]}},measures).floorKnown,false);
});
