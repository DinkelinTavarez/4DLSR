import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const vertex=`
precision highp float;
attribute vec2 sourceUV;
uniform sampler2D depthA,depthB;
uniform float blend,aspect,spread,softness;
uniform vec2 grid,viewportSize;
varying vec2 uvSource,uvDetail,gaussian;
varying float depthValue,visible;
float depthToZ(float d){float invFar=1./(1.+6.*spread);return 1./mix(invFar,1.,d);}
vec3 unprojectZ(vec2 uv,float z){return vec3((uv.x-.5)*2.*aspect*.46630766*z,(.5-uv.y)*2.*.46630766*z,-z);}
vec3 unproject(vec2 uv,float d){return unprojectZ(uv,depthToZ(d));}
float depth(vec2 uv){float a=texture2D(depthA,uv).r,b=texture2D(depthB,uv).r;return abs(a-b)>.1?(blend<.5?a:b):mix(a,b,blend);}
vec2 boundFootprint(vec2 basis){float pixels=length(basis*viewportSize*.5);return basis*min(1.,12./max(pixels,.001));}
void main(){
 uvSource=sourceUV;gaussian=position.xy;float d=depth(sourceUV);depthValue=d;visible=1.;
 uvDetail=sourceUV+position.xy*softness*1.35/grid;
 vec3 p=unproject(sourceUV,d);
 vec2 dx=vec2(1./grid.x,0.),dy=vec2(0.,1./grid.y);
 float ddx=depth(sourceUV+dx),ddy=depth(sourceUV+dy);
 // Bound depth slopes in world space instead of allowing huge screen-space streaks.
 ddx=abs(ddx-d)>.06?d:ddx;ddy=abs(ddy-d)>.06?d:ddy;
 float z=-p.z,maxDx=2.*aspect*.46630766*z/grid.x*2.,maxDy=2.*.46630766*z/grid.y*2.;
 float zx=z+clamp(depthToZ(ddx)-z,-maxDx,maxDx),zy=z+clamp(depthToZ(ddy)-z,-maxDy,maxDy);
 vec4 c=projectionMatrix*modelViewMatrix*vec4(p,1.);
 vec4 px=projectionMatrix*modelViewMatrix*vec4(unprojectZ(sourceUV+dx,zx),1.);
 vec4 py=projectionMatrix*modelViewMatrix*vec4(unprojectZ(sourceUV+dy,zy),1.);
 if(c.w<.08||px.w<.06||py.w<.06){visible=0.;gl_Position=vec4(2.,2.,2.,1.);return;}
 vec2 bx=boundFootprint(px.xy/px.w-c.xy/c.w);
 vec2 by=boundFootprint(py.xy/py.w-c.xy/c.w);
 c.xy+=(bx*position.x+by*position.y)*c.w*softness*1.35;
 gl_Position=c;
}`;
const fragment=`precision highp float;
uniform sampler2D colorMap,depthA,depthB;uniform bool showDepth;uniform float blend;
varying vec2 uvSource,uvDetail,gaussian;varying float depthValue,visible;
void main(){float r=dot(gaussian,gaussian);if(visible<.5||r>4.||any(lessThan(uvDetail,vec2(0.)))||any(greaterThan(uvDetail,vec2(1.))))discard;
 float a=texture2D(depthA,uvDetail).r,b=texture2D(depthB,uvDetail).r;
 float localDepth=abs(a-b)>.1?(blend<.5?a:b):mix(a,b,blend);
 if(abs(localDepth-depthValue)>.075)discard;
 float alpha=.995*exp(-1.8*r);if(alpha<.015)discard;
 // Sample the original video across each footprint, retaining full-resolution detail.
 vec3 color=texture2D(colorMap,vec2(uvDetail.x,1.-uvDetail.y)).rgb;
 if(showDepth){color=mix(vec3(.10,.18,.32),vec3(.57,.96,.75),depthValue);}
 gl_FragColor=vec4(color,alpha);
}`;

export class SplatViewer{
 constructor(canvas){
  this.canvas=canvas;this.renderer=new T.WebGLRenderer({canvas,antialias:false,alpha:false,powerPreference:'high-performance'});
  this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));this.renderer.setClearColor(0x0b1712);
  this.scene=new T.Scene();this.camera=new T.PerspectiveCamera(50,16/9,.05,100);this.camera.position.set(0,0,0);
  this.controls=new OrbitControls(this.camera,canvas);this.controls.target.set(0,0,-3.5);this.controls.enableDamping=true;this.controls.dampingFactor=.085;
  this.controls.minDistance=.25;this.controls.maxDistance=14;this.controls.autoRotateSpeed=.6;this.controls.enablePan=true;
  this.width=384;this.height=216;this.depth=new Float32Array(this.width*this.height).fill(.5);this.resizedCache=new WeakMap();this.focusPending=true;
  this.a=this.makeDepth(this.depth);this.b=this.makeDepth(this.depth.slice());this.lastDepth=0;this.lastSort=0;this.keys=new Set();
  this.material=new T.ShaderMaterial({vertexShader:vertex,fragmentShader:fragment,transparent:true,depthWrite:false,depthTest:true,side:T.DoubleSide,uniforms:{depthA:{value:this.a},depthB:{value:this.b},blend:{value:1},aspect:{value:16/9},spread:{value:1},softness:{value:1},grid:{value:new T.Vector2(this.width,this.height)},viewportSize:{value:new T.Vector2(1280,720)},colorMap:{value:null},showDepth:{value:false}}});
  this.createGeometry();
  this.mesh=new T.Mesh(this.geometry,this.material);this.mesh.frustumCulled=false;this.scene.add(this.mesh);
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  window.addEventListener('keydown',e=>{if(['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return;if(['w','a','s','d','q','e'].includes(e.key.toLowerCase()))this.keys.add(e.key.toLowerCase());});
  window.addEventListener('keyup',e=>this.keys.delete(e.key.toLowerCase()));window.addEventListener('blur',()=>this.keys.clear());
 }
 makeDepth(data){const t=new T.DataTexture(data,this.width,this.height,T.RedFormat,T.FloatType);t.minFilter=T.LinearFilter;t.magFilter=T.LinearFilter;t.needsUpdate=true;return t;}
 setResolution(width,height){
  if(this.width===width&&this.height===height)return;
  if(![[384,216],[640,360],[960,540],[1280,720]].some(([w,h])=>w===width&&h===height))throw new Error('Unsupported Gaussian density');
  const old=this.depth,oldW=this.width,oldH=this.height;this.width=width;this.height=height;this.resizedCache=new WeakMap();
  this.depth=this.resizeDepth(old,oldW,oldH,false);this.a.dispose();this.b.dispose();this.geometry.dispose();
  this.a=this.makeDepth(this.depth.slice());this.b=this.makeDepth(this.depth.slice());this.material.uniforms.depthA.value=this.a;this.material.uniforms.depthB.value=this.b;this.material.uniforms.grid.value.set(width,height);this.material.uniforms.blend.value=1;
  this.pairMode=false;this.pairA=null;this.pairB=null;this.immediate=true;this.createGeometry();this.mesh.geometry=this.geometry;
 }
 createGeometry(){
  this.geometry=new T.InstancedBufferGeometry();this.geometry.setAttribute('position',new T.Float32BufferAttribute([-2,-2,0,2,-2,0,2,2,0,-2,2,0],3));this.geometry.setIndex([0,1,2,0,2,3]);
  this.uvs=new Float32Array(this.width*this.height*2);this.order=new Uint32Array(this.width*this.height);this.zsort=new Float32Array(this.order.length);this.sortBins=new Uint16Array(this.order.length);this.binHeads=new Uint32Array(65536);
  this.geometry.setAttribute('sourceUV',new T.InstancedBufferAttribute(this.uvs,2).setUsage(T.DynamicDrawUsage));this.geometry.instanceCount=this.order.length;this.sort();
 }
 source(source){
  if(this.sourceElement===source)return;this.sourceElement=source;this.texture?.dispose();this.focusPending=true;
  this.texture=source instanceof HTMLVideoElement?new T.VideoTexture(source):new T.CanvasTexture(source);this.texture.flipY=true;this.texture.colorSpace=T.NoColorSpace;this.texture.needsUpdate=true;this.textureTime=-1;this.material.uniforms.colorMap.value=this.texture;
 }
 resizeDepth(data,w,h,cache=true){
  if(cache&&this.resizedCache.has(data))return this.resizedCache.get(data);
  const resized=new Float32Array(this.width*this.height);
  for(let y=0;y<this.height;y++)for(let x=0;x<this.width;x++){
   const fx=Math.max(0,Math.min(w-1,(x+.5)*w/this.width-.5)),fy=Math.max(0,Math.min(h-1,(y+.5)*h/this.height-.5));
   const x0=Math.floor(fx),y0=Math.floor(fy),x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1),ax=fx-x0,ay=fy-y0;
   const a=data[y0*w+x0]*(1-ax)+data[y0*w+x1]*ax,b=data[y1*w+x0]*(1-ax)+data[y1*w+x1]*ax;
   resized[y*this.width+x]=a*(1-ay)+b*ay;
  }
  if(cache)this.resizedCache.set(data,resized);return resized;
 }
 setDepth(data,w,h,immediate=false){
  const resized=this.resizeDepth(data,w,h,false);this.pairMode=false;this.pairA=null;this.pairB=null;
  this.a.image.data.set(immediate?resized:this.b.image.data);this.b.image.data.set(resized);this.depth=resized;this.a.needsUpdate=true;this.b.needsUpdate=true;this.lastDepth=performance.now();this.material.uniforms.blend.value=immediate?1:0;this.immediate=immediate;this.focus();this.sort();
 }
 setDepthPair(a,b,blend){
  this.pairMode=true;
  let changed=false;
  if(this.pairA!==a.depth){this.a.image.data.set(this.resizeDepth(a.depth,a.width,a.height));this.a.needsUpdate=true;this.pairA=a.depth;changed=true;}
  if(this.pairB!==b.depth){this.b.image.data.set(this.resizeDepth(b.depth,b.width,b.height));this.b.needsUpdate=true;this.pairB=b.depth;changed=true;}
  this.material.uniforms.blend.value=blend;
  const next=blend<.5?this.a.image.data:this.b.image.data;if(this.depth!==next||changed){this.depth=next;this.focus();this.sortDirty=true;}
 }
 distance(d){const invFar=1/(1+6*this.material.uniforms.spread.value);return 1/(invFar+(1-invFar)*d);}
 focusDistance(){const samples=[];for(let i=0;i<this.depth.length;i+=37)samples.push(this.depth[i]);samples.sort((a,b)=>a-b);return this.distance(samples[Math.floor(samples.length*.8)]??.5);}
 focus(){if(this.focusPending){if(this.camera.position.lengthSq()<.0001)this.controls.target.set(0,0,-this.focusDistance());this.focusPending=false;}}
 viewCoverage(){const direction=new T.Vector3();this.camera.getWorldDirection(direction);return Math.acos(Math.max(-1,Math.min(1,-direction.z)))*180/Math.PI;}
 sort(){
  this.camera.updateMatrixWorld();const e=this.camera.matrixWorldInverse.elements,spread=this.material?.uniforms.spread.value||1,aspect=this.material?.uniforms.aspect.value||16/9;
  const invFar=1/(1+6*spread);
  let low=Infinity,high=-Infinity;
  for(let i=0;i<this.depth.length;i++){const u=(i%this.width+.5)/this.width,v=(Math.floor(i/this.width)+.5)/this.height,z=1/(invFar+(1-invFar)*this.depth[i]);const d=e[2]*(u-.5)*2*aspect*.46630766*z+e[6]*(.5-v)*2*.46630766*z-e[10]*z+e[14];this.zsort[i]=d;low=Math.min(low,d);high=Math.max(high,d);}
  // Linear-time depth buckets avoid sorting almost a million JS objects per frame.
  this.binHeads.fill(0);const scale=65535/Math.max(high-low,.000001);
  for(let i=0;i<this.depth.length;i++){const bin=Math.max(0,Math.min(65535,Math.floor((this.zsort[i]-low)*scale)));this.sortBins[i]=bin;this.binHeads[bin]++;}
  let offset=0;for(let b=0;b<65536;b++){const n=this.binHeads[b];this.binHeads[b]=offset;offset+=n;}
  for(let i=0;i<this.depth.length;i++)this.order[this.binHeads[this.sortBins[i]]++]=i;
  for(let n=0;n<this.order.length;n++){const i=this.order[n];this.uvs[n*2]=(i%this.width+.5)/this.width;this.uvs[n*2+1]=(Math.floor(i/this.width)+.5)/this.height;}
  this.geometry.attributes.sourceUV.needsUpdate=true;this.lastSort=performance.now();this.sortCamera=Array.from(this.camera.matrixWorldInverse.elements);this.sortSpread=spread;this.sortDirty=false;
 }
 reset(){const damping=this.controls.enableDamping;this.controls.autoRotate=false;this.controls.enableDamping=false;this.controls.update();this.controls.target.set(0,0,-this.focusDistance());this.camera.position.set(0,0,0);this.controls.update();this.controls.enableDamping=damping;}
 frame(dt){
  const width=this.canvas.clientWidth,height=this.canvas.clientHeight;if(!width||!height)return;
  if(this.oldW!==width||this.oldH!==height){this.renderer.setSize(width,height,false);this.camera.aspect=width/height;this.camera.updateProjectionMatrix();this.material.uniforms.viewportSize.value.set(width,height);this.oldW=width;this.oldH=height;}
  const move=new T.Vector3(),forward=new T.Vector3();this.camera.getWorldDirection(forward);const right=new T.Vector3().crossVectors(forward,this.camera.up).normalize();
  if(this.keys.has('w'))move.add(forward);if(this.keys.has('s'))move.sub(forward);if(this.keys.has('d'))move.add(right);if(this.keys.has('a'))move.sub(right);if(this.keys.has('e'))move.y+=1;if(this.keys.has('q'))move.y-=1;
  move.multiplyScalar(Math.min(dt,.05)*1.7);this.camera.position.add(move);this.controls.target.add(move);this.controls.update();
  this.camera.updateMatrixWorld();if(performance.now()-this.lastSort>130&&(this.sortDirty||this.sortSpread!==this.material.uniforms.spread.value||!this.sortCamera||this.camera.matrixWorldInverse.elements.some((v,i)=>Math.abs(v-this.sortCamera[i])>.00001)))this.sort();
  if(!this.pairMode)this.material.uniforms.blend.value=this.immediate?1:Math.min(1,(performance.now()-this.lastDepth)/100);
  if(this.texture && !(this.texture instanceof T.VideoTexture))this.texture.needsUpdate=true;
  if(this.texture instanceof T.VideoTexture&&this.sourceElement.readyState>=2&&this.sourceElement.paused&&this.textureTime!==this.sourceElement.currentTime){this.texture.needsUpdate=true;this.textureTime=this.sourceElement.currentTime;}
  this.renderer.render(this.scene,this.camera);
 }
}
