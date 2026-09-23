import test from 'node:test';
import assert from 'node:assert/strict';
import {fitScape} from '../src/scape-layout.js';

function room({missingWall=false,rotate=false}={}){
 const points=[];let seed=17;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
 for(let axis=0;axis<3;axis++)for(const side of [-1,1]){
  if(missingWall&&axis===0&&side===-1)continue;
  for(let i=0;i<850;i++){
   let p=[(random()*2-1)*3,(random()*2-1)*1.5,(random()*2-1)*2];p[axis]=side*[3,1.5,2][axis]+(random()-.5)*.008;
   if(rotate){const a=.47,b=.15;let [x,y,z]=p;p=[Math.cos(a)*x+Math.sin(a)*z,y,-Math.sin(a)*x+Math.cos(a)*z];[x,y,z]=p;p=[x,Math.cos(b)*y-Math.sin(b)*z,Math.sin(b)*y+Math.cos(b)*z];}
   points.push(...p);
  }
 }
 for(let i=0;i<50;i++)points.push((random()-.5)*100,(random()-.5)*100,(random()-.5)*100);
 return new Float32Array(points);
}

test('Scape fits a noisy rotated room and retains a bounded deterministic layout',()=>{
 const points=room({rotate:true}),a=fitScape(points),b=fitScape(points);assert.deepEqual(a,b);
 assert.equal(a.kind,'inferred-static-scape');assert.equal(a.surfaces.filter(p=>p.evidence==='fitted').length,6);
 assert.ok(a.surfaces.some(p=>p.role==='floor'));assert.ok(a.surfaces.some(p=>p.role==='ceiling'));
 for(const p of a.surfaces){assert.ok(p.corners.flat().every(Number.isFinite));assert.ok(p.corners.flat().every(v=>Math.abs(v)<8));assert.ok(p.rms<.02);}
 assert.ok(a.assumptions.some(s=>s.includes('assumed')));
});
test('Unobserved wall stays an explicit assumption with zero supporting points',()=>{
 const a=fitScape(room({missingWall:true})),assumptions=a.surfaces.filter(p=>p.evidence==='assumed');
 assert.equal(assumptions.length,1);assert.equal(assumptions[0].role,'wall');assert.equal(assumptions[0].support,0);assert.equal(assumptions[0].rms,null);
});
test('Scape rejects empty/degenerate points and handles a single plane without invented room depth',()=>{
 assert.throws(()=>fitScape(new Float32Array()),/80 valid/);assert.throws(()=>fitScape(new Float32Array(900)),/degenerate/);
 const positions=[];for(let i=0;i<25;i++)for(let j=0;j<25;j++)positions.push(i/10,0,j/10);
 const a=fitScape(new Float32Array(positions));assert.equal(a.surfaces.length,1);assert.equal(a.surfaces[0].evidence,'fitted');
});
