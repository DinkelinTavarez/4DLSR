import test from 'node:test';
import assert from 'node:assert/strict';
import {exactCameraConstraints,captureModeMatches,captureRequestMatches,deliveryGrade,validCaptureMode,captureBitrate,captureStallMs} from '../src/capture-policy.js';

test('capture never accepts an ideal-only request or a resized source',()=>{
 const mode={deviceId:'one-camera',width:1920,height:1080,frameRate:30},c=exactCameraConstraints(mode);
 assert.equal(c.video.frameRate.exact,30);assert.equal(c.video.width.exact,1920);assert.equal(c.video.height.exact,1080);assert.equal(c.video.resizeMode.exact,'none');
 assert.equal(captureModeMatches(mode,{width:1280,height:720,frameRate:30},mode),false);
 assert.equal(captureModeMatches(mode,mode,{width:1280,height:720}),false);
 assert.equal(captureModeMatches({...mode,frameRate:60},mode),false);
 assert.equal(captureModeMatches(mode,mode),true);
});

test('native requests support unusual sizes, portrait, fractional and high FPS without a preset whitelist',()=>{
 for(const mode of [{width:800,height:600,frameRate:25},{width:1080,height:1920,frameRate:29.97},{width:4096,height:2160,frameRate:59.94},{width:7680,height:4320,frameRate:120},{width:10240,height:4320,frameRate:300},{width:320,height:240,frameRate:.5}]){
  assert.equal(validCaptureMode(mode),true);const c=exactCameraConstraints({deviceId:'device',...mode});
  assert.equal(c.video.width.exact,mode.width);assert.equal(c.video.height.exact,mode.height);assert.equal(c.video.frameRate.exact,mode.frameRate);
 }
 for(const change of [{width:0},{width:800.5},{height:-1},{frameRate:0},{frameRate:Infinity},{width:NaN},{width:2**32}])assert.equal(validCaptureMode({width:800,height:600,frameRate:25,...change}),false);
 assert.ok(captureBitrate({width:3840,height:2160,frameRate:60})>20000000);
});

test('device-chosen mode is explicit and custom quality remains exact',()=>{
 const native=exactCameraConstraints({deviceId:'camera',captureMode:'camera-default'});
 assert.deepEqual(native,{audio:false,video:{deviceId:{exact:'camera'},resizeMode:{exact:'none'}}});
 const resolved={width:800,height:600,frameRate:25,captureMode:'camera-default'};
 assert.equal(captureRequestMatches({captureMode:'camera-default'},resolved),true);
 assert.equal(captureRequestMatches({...resolved,captureMode:'custom'},resolved),false);
 assert.equal(captureModeMatches({width:800,height:600,frameRate:30},{width:800,height:600,frameRate:29.97}),true);
 assert.equal(captureModeMatches({width:800,height:600,frameRate:.5},{width:800,height:600,frameRate:.45}),false);
 assert.equal(captureStallMs(.5),6000);assert.equal(deliveryGrade(.5,.5,5000),'measuring');assert.equal(deliveryGrade(.5,.5,10000),'on-target');
});

test('nominal 30 FPS cannot hide 15 FPS delivery and startup cannot pass',()=>{
 assert.equal(deliveryGrade(30,15,5000),'below-target');
 assert.equal(deliveryGrade(30,30,1000),'measuring');
 assert.equal(deliveryGrade(30,undefined,5000),'measuring');
 assert.equal(deliveryGrade(30,29.8,5000),'on-target');
 assert.equal(deliveryGrade(60,30,5000),'below-target');
});
