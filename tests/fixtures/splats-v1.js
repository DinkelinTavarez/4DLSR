import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const vertex=`
precision highp float;
attribute vec2 sourceUV;
uniform sampler2D depthA,depthB;
uniform float blend,aspect,spread,softness;
uniform vec2 grid;
varying vec2 uvSource,gaussian;
varying float depthValue;
vec3 unproject(vec2 uv,float d){float z=1.+6.*(1.-d)*spread;return vec3((uv.x-.5)*2.*aspect*.46630766*z,(.5-uv.y)*2.*.46630766*z,-z);}
float depth(vec2 uv){return mix(texture2D(depthA,uv).r,texture2D(depthB,uv).r,blend);}
void main(){
 uvSource=sourceUV;gaussian=position.xy;float d=depth(sourceUV);depthValue=d;
 vec3 p=unproject(sourceUV,d);
 vec2 dx=vec2(1./grid.x,0.),dy=vec2(0.,1./grid.y);
 float ddx=depth(sourceUV+dx),ddy=depth(sourceUV+dy);
 // Do not bridge foreground/background discontinuities with stretched splats.
 ddx=abs(ddx-d)>.06?d:ddx;ddy=abs(ddy-d)>.06?d:ddy;
 vec4 c=projectionMatrix*modelViewMatrix*vec4(p,1.);
 vec4 px=projectionMatrix*modelViewMatrix*vec4(unproject(sourceUV+dx,ddx),1.);
 vec4 py=projectionMatrix*modelViewMatrix*vec4(unproject(sourceUV+dy,ddy),1.);
 vec2 bx=clamp(px.xy/px.w-c.xy/c.w,vec2(-.055),vec2(.055));
 vec2 by=clamp(py.xy/py.w-c.xy/c.w,vec2(-.055),vec2(.055));
 c.xy+=(bx*position.x+by*position.y)*c.w*softness*1.35;
 gl_Position=c;
}`;
const fragment=`precision highp float;
uniform sampler2D colorMap;uniform bool showDepth;
varying vec2 uvSource,gaussian;varying float depthValue;
void main(){float r=dot(gaussian,gaussian);if(r>4.)discard;
 float alpha=.97*exp(-1.8*r);if(alpha<.015)discard;
 vec3 color=texture2D(colorMap,vec2(uvSource.x,1.-uvSource.y)).rgb;
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
  this.width=256;this.height=144;this.depth=new Float32Array(this.width*this.height).fill(.5);
  this.a=this.makeDepth(this.depth);this.b=this.makeDepth(this.depth.slice());this.lastDepth=0;this.lastSort=0;this.keys=new Set();
  this.material=new T.ShaderMaterial({vertexShader:vertex,fragmentShader:fragment,transparent:true,depthWrite:false,depthTest:true,side:T.DoubleSide,uniforms:{depthA:{value:this.a},depthB:{value:this.b},blend:{value:1},aspect:{value:16/9},spread:{value:1},softness:{value:1},grid:{value:new T.Vector2(this.width,this.height)},colorMap:{value:null},showDepth:{value:false}}});
  this.createGeometry();
  this.mesh=new T.Mesh(this.geometry,this.material);this.mesh.frustumCulled=false;this.scene.add(this.mesh);
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  window.addEventListener('keydown',e=>{if(['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return;if(['w','a','s','d','q','e'].includes(e.key.toLowerCase()))this.keys.add(e.key.toLowerCase());});
  window.addEventListener('keyup',e=>this.keys.delete(e.key.toLowerCase()));window.addEventListener('blur',()=>this.keys.clear());
 }
 makeDepth(data){const t=new T.DataTexture(data,this.width,this.height,T.RedFormat,T.FloatType);t.minFilter=T.LinearFilter;t.magFilter=T.LinearFilter;t.needsUpdate=true;return t;}
 createGeometry(){
  this.geometry=new T.InstancedBufferGeometry();this.geometry.setAttribute('position',new T.Float32BufferAttribute([-2,-2,0,2,-2,0,2,2,0,-2,2,0],3));this.geometry.setIndex([0,1,2,0,2,3]);
  this.uvs=new Float32Array(this.width*this.height*2);this.order=Array.from({length:this.width*this.height},(_,i)=>i);this.zsort=new Float32Array(this.order.length);
  this.geometry.setAttribute('sourceUV',new T.InstancedBufferAttribute(this.uvs,2).setUsage(T.DynamicDrawUsage));this.geometry.instanceCount=this.order.length;this.sort();
 }
 source(source){
  if(this.sourceElement===source)return;this.sourceElement=source;this.texture?.dispose();
  this.texture=source instanceof HTMLVideoElement?new T.VideoTexture(source):new T.CanvasTexture(source);this.texture.flipY=true;this.texture.colorSpace=T.NoColorSpace;this.material.uniforms.colorMap.value=this.texture;
 }
 setDepth(data,w,h,immediate=false){
  // Bilinear upsampling stays on the GPU; retain a fixed splat sampling grid.
  const resized=new Float32Array(this.width*this.height);
  for(let y=0;y<this.height;y++)for(let x=0;x<this.width;x++)resized[y*this.width+x]=data[Math.min(h-1,Math.floor(y*h/this.height))*w+Math.min(w-1,Math.floor(x*w/this.width))];
  this.a.image.data.set(immediate?resized:this.b.image.data);this.b.image.data.set(resized);this.depth=resized;this.a.needsUpdate=true;this.b.needsUpdate=true;this.lastDepth=performance.now();this.material.uniforms.blend.value=immediate?1:0;this.immediate=immediate;this.sort();
 }
 sort(){
  this.camera.updateMatrixWorld();const e=this.camera.matrixWorldInverse.elements,spread=this.material?.uniforms.spread.value||1,aspect=this.material?.uniforms.aspect.value||16/9;
  for(let i=0;i<this.depth.length;i++){const u=(i%this.width+.5)/this.width,v=(Math.floor(i/this.width)+.5)/this.height,z=1+6*(1-this.depth[i])*spread;this.zsort[i]=e[2]*(u-.5)*2*aspect*.46630766*z+e[6]*(.5-v)*2*.46630766*z-e[10]*z+e[14];}
  this.order.sort((a,b)=>this.zsort[a]-this.zsort[b]);
  for(let n=0;n<this.order.length;n++){const i=this.order[n];this.uvs[n*2]=(i%this.width+.5)/this.width;this.uvs[n*2+1]=(Math.floor(i/this.width)+.5)/this.height;}
  this.geometry.attributes.sourceUV.needsUpdate=true;this.lastSort=performance.now();
 }
 reset(){this.controls.target.set(0,0,-3.5);this.camera.position.set(0,0,0);this.controls.autoRotate=false;this.controls.update();}
 frame(dt){
  const width=this.canvas.clientWidth,height=this.canvas.clientHeight;if(!width||!height)return;
  if(this.oldW!==width||this.oldH!==height){this.renderer.setSize(width,height,false);this.camera.aspect=width/height;this.camera.updateProjectionMatrix();this.oldW=width;this.oldH=height;}
  const move=new T.Vector3(),forward=new T.Vector3();this.camera.getWorldDirection(forward);const right=new T.Vector3().crossVectors(forward,this.camera.up).normalize();
  if(this.keys.has('w'))move.add(forward);if(this.keys.has('s'))move.sub(forward);if(this.keys.has('d'))move.add(right);if(this.keys.has('a'))move.sub(right);if(this.keys.has('e'))move.y+=1;if(this.keys.has('q'))move.y-=1;
  move.multiplyScalar(Math.min(dt,.05)*1.7);this.camera.position.add(move);this.controls.target.add(move);this.controls.update();
  if(performance.now()-this.lastSort>130)this.sort();
  this.material.uniforms.blend.value=this.immediate?1:Math.min(1,(performance.now()-this.lastDepth)/220);
  if(this.texture && !(this.texture instanceof T.VideoTexture))this.texture.needsUpdate=true;
  this.renderer.render(this.scene,this.camera);
 }
}
