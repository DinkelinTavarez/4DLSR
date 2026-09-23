// Extrinsics use OpenCV world-to-camera coordinates: p_camera = R p_world + t.
export function cameraPose(view){
 if(!Array.isArray(view)||view.length!==4||view.some(r=>!Array.isArray(r)||r.length!==4||r.some(v=>!Number.isFinite(v))))throw new Error('Invalid camera pose');
 const rotation=view.slice(0,3).map(r=>r.slice(0,3)),translation=view.slice(0,3).map(r=>r[3]);
 const rotateBack=v=>[0,1,2].map(j=>rotation.reduce((sum,row,i)=>sum+row[j]*v[i],0));
 return {center:rotateBack(translation).map(v=>-v),forward:rotateBack([0,0,1]),up:rotateBack([0,-1,0]),rotateBack};
}
export const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
export const displayPoint=p=>[p[0],-p[1],-p[2]];
export function frustumCorners(view,K,width,height,depth){
 if(!(width>0&&height>0&&depth>0&&K?.[0]?.[0]>0&&K?.[1]?.[1]>0))throw new Error('Invalid camera image geometry');
 const pose=cameraPose(view);
 return [[0,0],[width,0],[width,height],[0,height]].map(([u,v])=>{
  const y=(v-K[1][2])/K[1][1],x=(u-K[0][2]-K[0][1]*y)/K[0][0];
  return pose.rotateBack([x*depth,y*depth,depth]).map((n,i)=>n+pose.center[i]);
 });
}
export function rigLayout(result,{baseline=null,level=false,referenceHeight=null}={}){
 const views=result.calibration?.views,slots=result.cameraSlots;
 if(!Array.isArray(views)||!Array.isArray(slots)||views.length!==slots.length||views.length<2)throw new Error('Camera poses do not match the source images');
 const poses=views.map(cameraPose);let scale=1,units='relative units';
 if(baseline){
  const a=slots.indexOf(baseline.from),b=slots.indexOf(baseline.to);
  if(a<0||b<0||a===b||!Number.isFinite(baseline.meters)||baseline.meters<=0||baseline.meters>1000)throw new Error('Choose two different cameras and a positive measured distance up to 1,000 m');
  const inferred=distance(poses[a].center,poses[b].center);
  if(inferred<1e-4)throw new Error('These camera centers are too close in the estimate to establish scale');
  scale=baseline.meters/inferred;units='m';
 }
 // The worker normalizes the world to its first camera. No gravity is inferred.
 const anchored=views[0].every((r,i)=>r.every((v,j)=>Math.abs(v-(i===j?1:0))<1e-4));
 const floorKnown=!!baseline&&level&&Number.isFinite(referenceHeight)&&referenceHeight>=0&&anchored;
 const cameras=poses.map((pose,i)=>{
  const position=displayPoint(pose.center).map(v=>v*scale);
  return {slot:slots[i],position,forward:displayPoint(pose.forward),up:displayPoint(pose.up),distanceFromReference:distance(pose.center,poses[0].center)*scale,height:floorKnown?position[1]+referenceHeight:null};
 });
 return {cameras,scale,units,floorKnown,floorY:floorKnown?-referenceHeight:null,baseline,referenceHeight:floorKnown?referenceHeight:null,level:floorKnown};
}
