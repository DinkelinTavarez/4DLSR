import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera,Vector3} from 'three';
import {FlyControls,dampMotion} from '../src/fly-controls.js';
import {sortSplats} from '../src/splat-sort.js';

test('flight distance is independent of frame rate, including acceleration and release',()=>{
 const fly=fps=>{const p=new Vector3(),v=new Vector3();for(let i=0;i<fps*2;i++)dampMotion(p,v,new Vector3(i<fps?3:0,0,0),1/fps);return p.x;};
 assert.ok(Math.abs(fly(30)-fly(144))<1e-10);assert.ok(Math.abs(fly(60)-3)<.0001);
});

test('free flight supports vertical travel and boost, normalizes diagonals, and releases focus safely',()=>{
 globalThis.window=new EventTarget();globalThis.document=new EventTarget();
 const canvas=new EventTarget();canvas.setAttribute=()=>{};canvas.focus=()=>document.activeElement=canvas;
 const camera=new PerspectiveCamera(),fly=new FlyControls(camera,canvas);fly.setEnabled(true);fly.speed=2;
 const key=(code,type='keydown')=>{const event=new Event(type,{cancelable:true});Object.defineProperty(event,'code',{value:code});window.dispatchEvent(event);return event;};
 assert.equal(key('KeyW').defaultPrevented,false);fly.update(.02);assert.equal(camera.position.length(),0);
 canvas.focus();assert.equal(key('KeyW').defaultPrevented,true);key('KeyD');for(let i=0;i<60;i++)fly.update(1/60);
 assert.ok(Math.abs(fly.velocity.length()-2)<.00001);assert.ok(camera.position.x>1&&camera.position.z< -1);
 fly.stop();camera.position.set(0,0,0);key('KeyE');key('ShiftLeft');for(let i=0;i<60;i++)fly.update(1/60);
 assert.ok(camera.position.y>7);assert.ok(Math.abs(fly.velocity.y-8)<.0001);
 window.dispatchEvent(new Event('blur'));assert.equal(fly.velocity.length(),0);assert.equal(fly.keys.size,0);
 key('KeyQ');for(let i=0;i<10;i++)fly.update(1/60);assert.ok(fly.velocity.y<0);
 key('KeyX');assert.equal(fly.velocity.length(),0);
 document.activeElement={tagName:'INPUT'};assert.equal(key('Space').defaultPrevented,false);
 fly.dispose();delete globalThis.window;delete globalThis.document;
});

test('Gaussian depth sorting is stable, back to front, and preserves every attribute',()=>{
 const records=new Float32Array(14*5),depths=[-2,-10,-2,4,-8];
 for(let i=0;i<5;i++){records[i*14+2]=depths[i];for(let j=3;j<14;j++)records[i*14+j]=i*100+j;}
 const sorted=sortSplats(records,[0,0,1]);
 const order=[1,4,0,2,3];for(let i=0;i<5;i++)assert.deepEqual(sorted.slice(i*14,(i+1)*14),records.slice(order[i]*14,(order[i]+1)*14));
 const reverse=sortSplats(records,[0,0,-1]);assert.deepEqual(Array.from({length:5},(_,i)=>reverse[i*14+2]),[4,-2,-2,-8,-10]);
 assert.equal(sortSplats(new Float32Array(),[0,0,1]).length,0);
});

test('large-scene sorting retains every record beyond previous reconstruction caps',()=>{
 const count=300001,records=new Float32Array(count*14);
 for(let i=0;i<count;i++){records[i*14+2]=count-i;records[i*14+10]=i;records[i*14+13]=1;}
 const sorted=sortSplats(records,[0,0,1]);
 assert.equal(sorted.length,records.length);
 const seen=new Uint8Array(count);
 for(let i=0;i<count;i++){const id=sorted[i*14+10];assert.equal(seen[id],0);seen[id]=1;assert.equal(sorted[i*14+2],count-id);assert.equal(sorted[i*14+13],1);}
 assert.equal(seen.reduce((n,value)=>n+value,0),count);
});
