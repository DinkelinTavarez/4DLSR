import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {FlyControls} from './fly-controls.js';
import {sortSplats} from './splat-sort.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {PLYLoader} from 'three/addons/loaders/PLYLoader.js';
import {scapeObject,scapeVisibility} from './scape-view.js';

const vertex=`
attribute vec3 center,scale3;attribute vec4 rotation,tint;
uniform vec2 viewport;varying vec2 gaussian;varying vec4 color;
void main(){
 vec4 q=normalize(rotation);float w=q.x,x=q.y,y=q.z,z=q.w;
 mat3 R=mat3(1.-2.*(y*y+z*z),2.*(x*y+w*z),2.*(x*z-w*y),2.*(x*y-w*z),1.-2.*(x*x+z*z),2.*(y*z+w*x),2.*(x*z+w*y),2.*(y*z-w*x),1.-2.*(x*x+y*y));
 mat3 A=mat3(modelViewMatrix)*R*mat3(scale3.x,0.,0.,0.,scale3.y,0.,0.,0.,scale3.z);
 mat3 C=A*transpose(A);vec4 v=modelViewMatrix*vec4(center,1.);vec4 clip=projectionMatrix*v;
 if(v.z>-.05){gl_Position=vec4(2.,2.,2.,1.);color=vec4(0.);gaussian=position.xy;return;}
 float iz=1./(-v.z);float fx=projectionMatrix[0][0]*viewport.x*.5,fy=projectionMatrix[1][1]*viewport.y*.5;
 vec3 jx=vec3(fx*iz,0.,fx*v.x*iz*iz),jy=vec3(0.,fy*iz,fy*v.y*iz*iz);
 float a=dot(jx,C*jx)+.3,b=dot(jx,C*jy),d=dot(jy,C*jy)+.3;
 float mid=.5*(a+d),disc=sqrt(max(0.,.25*(a-d)*(a-d)+b*b));
 vec2 axis=abs(b)>.00001?normalize(vec2(b,mid+disc-a)):a>d?vec2(1.,0.):vec2(0.,1.);
 vec2 offset=axis*sqrt(max(.1,mid+disc))*position.x+vec2(-axis.y,axis.x)*sqrt(max(.1,mid-disc))*position.y;
 clip.xy+=offset*2./viewport*clip.w;gl_Position=clip;gaussian=position.xy;color=tint;
}`;
const fragment=`precision highp float;varying vec2 gaussian;varying vec4 color;void main(){float a=color.a*exp(-.5*dot(gaussian,gaussian));if(a<.003)discard;gl_FragColor=vec4(color.rgb,a);}`;

export class CombinedViewer{
 constructor(canvas,{onNavigation=()=>{}}={}){
  this.canvas=canvas;this.renderer=new T.WebGLRenderer({canvas,antialias:false});this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));this.renderer.setClearColor(0x10151b);
  this.scene=new T.Scene();this.camera=new T.PerspectiveCamera(50,1,.03,200);this.controls=new OrbitControls(this.camera,canvas);this.controls.enableDamping=true;
  this.group=new T.Group();this.group.scale.set(1,-1,-1);this.scene.add(this.group);
  this.scene.add(new T.HemisphereLight(0xe6f0ff,0x59614d,2));const light=new T.DirectionalLight(0xffffff,2);light.position.set(3,5,2);this.scene.add(light);this.representation='gaussians';
  this.material=new T.ShaderMaterial({vertexShader:vertex,fragmentShader:fragment,transparent:true,depthWrite:false,side:T.DoubleSide,uniforms:{viewport:{value:new T.Vector2(1000,600)}}});
  this.camera.position.set(0,0,0);this.controls.target.set(0,0,-2);this.controls.update();
  this.fly=new FlyControls(this.camera,canvas,{onState:onNavigation});this.onNavigation=onNavigation;this.setMode('fly');
  this.generation=0;this.lastSort=0;this.lastTime=0;this.sortedDirection=null;this.sortPending=false;
  try{this.worker=new Worker(new URL('./splat-sort.worker.js',import.meta.url),{type:'module'});
   this.worker.onmessage=({data})=>{if(data.generation!==this.generation)return;this.sortPending=false;this.instances.array.set(data.sorted);this.instances.needsUpdate=true;};
   this.worker.onerror=()=>{this.worker.terminate();this.worker=null;this.sortPending=false;this.sortedDirection=null;onNavigation('Background sorting unavailable · reduced navigation performance');};
  }catch{onNavigation('Background sorting unavailable · reduced navigation performance');}
  this.tick=this.tick.bind(this);this.tick();
 }
 setMode(mode){
  this.mode=mode;this.controls.enabled=mode==='orbit';this.fly.setEnabled(mode==='fly');
  if(mode==='orbit'){this.camera.up.set(0,1,0);const direction=this.camera.getWorldDirection(new T.Vector3());this.controls.target.copy(this.camera.position).addScaledVector(direction,this.focusDistance||2);this.controls.update();this.onNavigation('Drag to orbit · wheel to zoom · right-drag to pan');}
 }
 setSpeed(multiplier){this.speedMultiplier=multiplier;this.fly.speed=Math.max(.1,(this.focusDistance||2)*.45)*multiplier;}
 captureMouse(){return this.fly.capture();}
 setCalibration(manifest){this.manifest=manifest;this.focusDistance=null;this.snap(0);}
 snap(index){
  const c=this.manifest.calibration,flip=new T.Vector3(1,-1,-1);let center=new T.Vector3(),forward=new T.Vector3(0,0,1),up=new T.Vector3(0,-1,0);
  if(c.views?.[index]){const v=c.views[index],r=new T.Matrix3().set(...v.slice(0,3).flatMap(row=>row.slice(0,3))).transpose();center.set(v[0][3],v[1][3],v[2][3]).negate().applyMatrix3(r);forward.applyMatrix3(r);up.applyMatrix3(r);}
  else if(index){const r=new T.Matrix3().set(...c.R.flat()).transpose();center.set(...c.t).negate().applyMatrix3(r);forward.applyMatrix3(r);up.applyMatrix3(r);}
  center.multiply(flip);forward.multiply(flip);up.multiply(flip);this.camera.position.copy(center);this.camera.up.copy(up);this.controls.target.copy(center).addScaledVector(forward,this.focusDistance||2);
  const K=Array.isArray(c.K[0][0])?c.K[index]:c.K;this.camera.fov=T.MathUtils.radToDeg(2*Math.atan(this.manifest.height/(2*K[1][1])));this.camera.updateProjectionMatrix();
  this.fly.stop();this.camera.lookAt(this.controls.target);if(this.mode==='fly')this.fly.sync();else this.controls.update();
 }
 load(buffer,{fraction=1}={}){
  if(!buffer.byteLength||buffer.byteLength%32)throw new Error('Invalid Gaussian file');const total=buffer.byteLength/32,n=Math.max(1,Math.ceil(total*Math.min(1,Math.max(.01,fraction)))),dv=new DataView(buffer);this.visibleCount=n;this.totalCount=total;this.records=new Float32Array(n*14);const depths=[];
  for(let i=0;i<n;i++){let p=i*14,b=Math.floor(i*total/n)*32;for(let j=0;j<6;j++)this.records[p+j]=dv.getFloat32(b+j*4,true);for(let j=0;j<4;j++){this.records[p+6+j]=(dv.getUint8(b+28+j)-128)/128;this.records[p+10+j]=dv.getUint8(b+24+j)/255;}if(i%31===0)depths.push(this.records[p+2]);}
  depths.sort((a,b)=>a-b);this.focusDistance??=depths[Math.floor(depths.length/2)]||2;
  this.setSpeed(this.speedMultiplier||1);
  if(this.mesh){this.group.remove(this.mesh);this.geometry.dispose();}
  const g=new T.InstancedBufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute([-3,-3,0,3,-3,0,3,3,0,-3,3,0],3));g.setIndex([0,1,2,0,2,3]);
  this.instances=new T.InstancedInterleavedBuffer(this.records.slice(),14,1).setUsage(T.DynamicDrawUsage);
  for(const [name,size,offset]of [['center',3,0],['scale3',3,3],['rotation',4,6],['tint',4,10]])g.setAttribute(name,new T.InterleavedBufferAttribute(this.instances,size,offset));g.instanceCount=n;
  this.geometry=g;this.mesh=new T.Mesh(g,this.material);this.mesh.frustumCulled=false;this.group.add(this.mesh);
  this.representation='gaussians';this.group.visible=true;if(this.surfaceRoot)this.surfaceRoot.visible=false;if(this.scapeRoot)this.scapeRoot.visible=false;
  this.generation++;this.sortedDirection=null;this.sortPending=false;
  if(this.worker){const records=this.records.slice();this.worker.postMessage({type:'load',generation:this.generation,records},[records.buffer]);}this.sort();
 }
 disposeObject(object){if(!object)return;object.traverse(child=>{child.geometry?.dispose();if(child.material)for(const material of Array.isArray(child.material)?child.material:[child.material])material.dispose();});}
 async loadSurface(buffer,representation,isCurrent=()=>true){
  let object;
  if(representation==='seeds'){const geometry=new PLYLoader().parse(buffer);object=new T.Points(geometry,new T.PointsMaterial({size:2,sizeAttenuation:false,vertexColors:true}));}
  else{const result=await new GLTFLoader().parseAsync(buffer,'');object=result.scene;object.traverse(child=>{if(child.isMesh){for(const material of Array.isArray(child.material)?child.material:[child.material])material.dispose();child.material=new T.MeshStandardMaterial({color:representation==='wireframe'?0xb3dcc5:0x9bb7c9,roughness:1,metalness:0,side:T.DoubleSide,flatShading:true,wireframe:representation==='wireframe'});}});}
  if(!isCurrent()){this.disposeObject(object);return;}
  if(this.surfaceRoot){this.scene.remove(this.surfaceRoot);this.disposeObject(this.surfaceRoot);}
  this.surfaceRoot=object;this.scene.add(object);this.group.visible=false;if(this.scapeRoot)this.scapeRoot.visible=false;this.representation=representation;
  if(!this.focusDistance){const center=new T.Box3().setFromObject(object).getCenter(new T.Vector3());this.focusDistance=Math.max(.5,center.length());this.setSpeed(this.speedMultiplier||1);}
 }
 loadScape(layout,options){
  if(this.scapeLayout!==layout){if(this.scapeRoot){this.scene.remove(this.scapeRoot);this.disposeObject(this.scapeRoot);}this.scapeRoot=scapeObject(layout);this.scene.add(this.scapeRoot);this.scapeLayout=layout;}
  this.group.visible=false;if(this.surfaceRoot)this.surfaceRoot.visible=false;this.scapeRoot.visible=true;this.representation='scape';this.setScapeOptions(options);
 }
 setScapeOptions(options){if(this.scapeRoot)scapeVisibility(this.scapeRoot,options);}
 frameGeometry(){
  const object=this.representation==='scape'?this.scapeRoot:this.surfaceRoot;if(!object||this.representation==='gaussians')return;
  const box=new T.Box3().setFromObject(object),center=box.getCenter(new T.Vector3()),size=box.getSize(new T.Vector3()).length();if(!Number.isFinite(size)||size<=0)return;
  this.fly.stop();this.camera.up.set(0,1,0);this.camera.position.copy(center).addScaledVector(new T.Vector3(.65,.4,.8),size);this.camera.lookAt(center);this.controls.target.copy(center);this.camera.far=Math.max(200,size*10);this.camera.updateProjectionMatrix();if(this.mode==='fly')this.fly.sync();else this.controls.update();
 }
 sort(){
  if(this.representation!=='gaussians'||!this.records||this.sortPending)return;this.camera.updateMatrixWorld();const e=this.camera.matrixWorldInverse.elements,direction=[e[2],-e[6],-e[10]];
  if(this.sortedDirection&&direction.every((v,i)=>Math.abs(v-this.sortedDirection[i])<.0001))return;
  this.sortedDirection=direction;
  if(this.worker){this.sortPending=true;this.worker.postMessage({type:'sort',generation:this.generation,direction});}
  else{this.instances.array.set(sortSplats(this.records,direction));this.instances.needsUpdate=true;}
 }
 tick(now=0){this.frame=requestAnimationFrame(this.tick);const dt=Math.min((now-this.lastTime)/1000,.05);this.lastTime=now;if(!this.canvas.isConnected||this.canvas.clientWidth===0||document.hidden){this.fly.stop();return;}const w=this.canvas.clientWidth,h=this.canvas.clientHeight;if(w!==this.w||h!==this.h){this.w=w;this.h=h;this.renderer.setSize(w,h,false);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.material.uniforms.viewport.value.set(w*this.renderer.getPixelRatio(),h*this.renderer.getPixelRatio());}if(this.mode==='fly')this.fly.update(dt);else this.controls.update();if(now-this.lastSort>50){this.sort();this.lastSort=now;}this.renderer.render(this.scene,this.camera);}
 dispose(){cancelAnimationFrame(this.frame);this.worker?.terminate();this.fly.dispose();this.controls.dispose();this.geometry?.dispose();this.disposeObject(this.surfaceRoot);this.disposeObject(this.scapeRoot);this.material.dispose();this.renderer.dispose();}
}
