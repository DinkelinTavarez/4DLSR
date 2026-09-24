// Capture requests must not silently negotiate a lower mode or resize a frame.
export function validCaptureMode(mode){
 // Dimensions use the browser's unsigned-long domain, not a camera whitelist.
 return !!mode&&[mode.width,mode.height].every(v=>Number.isInteger(v)&&v>0&&v<=0xffffffff)&&Number.isFinite(mode.frameRate)&&mode.frameRate>0;
}

export function captureBitrate(mode){
 return Math.min(0xffffffff,Math.max(1500000,Math.round(mode.width*mode.height*mode.frameRate*.16)));
}

export function exactCameraConstraints({deviceId,width,height,frameRate,captureMode='custom'}){
 const video={deviceId:{exact:deviceId},resizeMode:{exact:'none'}};
 if(captureMode!=='camera-default')Object.assign(video,{width:{exact:width},height:{exact:height},frameRate:{exact:frameRate}});
 return {audio:false,video};
}

export function captureModeMatches(requested,source,delivered=source){
 return !!requested&&!!source&&!!delivered&&source.width===requested.width&&source.height===requested.height&&Math.abs(source.frameRate-requested.frameRate)<=Math.max(.0001,requested.frameRate*.0011)&&delivered.width===requested.width&&delivered.height===requested.height;
}

export function captureRequestMatches(selected,applied){
 return !!applied&&(selected.captureMode||'custom')===(applied.captureMode||'custom')&&(selected.captureMode==='camera-default'||captureModeMatches(selected,applied));
}

export function captureStallMs(fps){return Math.max(3500,Number.isFinite(fps)&&fps>0?3000/fps:3500);}
export function liveCaptureCameras(cameras,now){
 return cameras.filter(c=>c.stream&&Number.isFinite(c.lastFrame)&&now-c.lastFrame<captureStallMs(c.requested?.frameRate)&&c.stream.getVideoTracks().some(track=>track.readyState==='live'));
}
export function deliveryWindowMs(fps){return Math.max(5000,Number.isFinite(fps)&&fps>0?5000/fps:5000);}

export function deliveryGrade(targetFps,measuredFps,windowMs){
 if(!Number.isFinite(targetFps)||targetFps<=0||!Number.isFinite(measuredFps)||!Number.isFinite(windowMs)||windowMs<deliveryWindowMs(targetFps)*.9)return 'measuring';
 return measuredFps>=targetFps*.95?'on-target':'below-target';
}
