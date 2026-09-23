import test from 'node:test';
import assert from 'node:assert/strict';
import {assignCameraDevices} from '../src/camera-inventory.js';
const devices=['a','b','c','d'].map((deviceId,i)=>({deviceId,label:'Identical webcam',occurrence:i+1}));
test('a missing early camera never steals a later live identity',()=>{
  assert.deepEqual(assignCameraDevices([{deviceId:'gone'},{deviceId:'b',active:true},{deviceId:'c',active:true}],devices),['a','b','c']);
});
test('a hot unplug preserves remaining selected identities before filling gaps',()=>{
  assert.deepEqual(assignCameraDevices([{deviceId:'gone'},{deviceId:'a'},{deviceId:'b'}],devices),['c','a','b']);
});
test('device reordering does not reorder assigned cameras',()=>{
  assert.deepEqual(assignCameraDevices([{deviceId:'a'},{deviceId:'b'},{deviceId:'c'},{deviceId:'d'}],devices.toReversed()),['a','b','c','d']);
});
test('an explicitly unassigned slot remains empty',()=>{
  assert.deepEqual(assignCameraDevices([{userUnassigned:true},{deviceId:'b'}],devices),['','b']);
});
test('a stale catalog does not silently replace a streaming device',()=>{
  assert.deepEqual(assignCameraDevices([{deviceId:'a',active:true},{deviceId:'b'}],devices.slice(1)),['a','b']);
});
test('duplicate saved selections are repaired to distinct cameras',()=>{
  const result=assignCameraDevices([{deviceId:'b'},{deviceId:'b',active:true},{deviceId:'b'}],devices);
  assert.equal(result[1],'b');assert.equal(new Set(result).size,3);
});
