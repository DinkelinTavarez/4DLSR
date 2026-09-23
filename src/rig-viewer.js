import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {cameraPose,displayPoint,frustumCorners} from './rig-geometry.js';

export const rigColors=['#168cdb','#e59a28','#8b6bd6','#159e89','#d65f88','#526bd2','#7b9830','#bb7139'];
export class RigViewer{
 constructor(canvas){
  this.canvas=canvas;this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#f3f8fd');
  this.camera=new THREE.PerspectiveCamera(48,1,.001,10000);this.renderer=new THREE.WebGLRenderer({canvas,antialias:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  this.controls=new OrbitControls(this.camera,canvas);this.controls.enableDamping=true;this.root=new THREE.Group();this.scene.add(this.root);this.textures=[];
  this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(canvas);this.resize();
  this.renderer.setAnimationLoop(()=>{if(document.hidden||!canvas.clientWidth||!canvas.clientHeight)return;this.controls.update();this.renderer.render(this.scene,this.camera);});
 }
 resize(){const w=this.canvas.clientWidth,h=this.canvas.clientHeight;if(!w||!h)return;this.renderer.setSize(w,h,false);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();}
 clear(){this.root.traverse(o=>{o.geometry?.dispose();for(const m of(Array.isArray(o.material)?o.material:[o.material]))m?.dispose();});this.root.clear();this.textures.forEach(t=>t.dispose());this.textures=[];}
 set(result,frames,layout){
  this.clear();this.result=result;this.layout=layout;this.frusta=[];const scale=layout.scale;
  const bytes=Uint8Array.from(atob(result.splat),c=>c.charCodeAt(0)),data=new DataView(bytes.buffer),positions=[],colors=[];
  const colorValue=new THREE.Color();
  for(let offset=0;offset+32<=bytes.length;offset+=32){const p=displayPoint([0,4,8].map(i=>data.getFloat32(offset+i,true))).map(v=>v*scale);if(!p.every(Number.isFinite))continue;positions.push(...p);colorValue.setRGB(...[24,25,26].map(i=>bytes[offset+i]/255)).convertSRGBToLinear();colors.push(colorValue.r,colorValue.g,colorValue.b);}
  const geom=new THREE.BufferGeometry();geom.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geom.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  this.cloud=new THREE.Points(geom,new THREE.PointsMaterial({size:.012*scale,vertexColors:true,transparent:true,opacity:.85}));this.root.add(this.cloud);
  const centerVectors=layout.cameras.map(c=>new THREE.Vector3(...c.position));const box=new THREE.Box3().setFromPoints(centerVectors);
  // Frame cameras and the central 90% of geometry, excluding distant inference outliers.
  if(positions.length)for(let axis=0;axis<3;axis++){const values=[];for(let i=axis;i<positions.length;i+=3)values.push(positions[i]);values.sort((a,b)=>a-b);box.min.setComponent(axis,Math.min(box.min.getComponent(axis),values[Math.floor(values.length*.05)]));box.max.setComponent(axis,Math.max(box.max.getComponent(axis),values[Math.floor(values.length*.95)]));}
  this.center=box.getCenter(new THREE.Vector3());this.extent=Math.max(box.getSize(new THREE.Vector3()).length(),scale,.01);
  const reach=.32*scale;
  for(let i=0;i<result.cameraSlots.length;i++){
   const color=rigColors[i%rigColors.length],pose=cameraPose(result.calibration.views[i]),origin=new THREE.Vector3(...displayPoint(pose.center)).multiplyScalar(scale);
   const corners=frustumCorners(result.calibration.views[i],result.calibration.K[i],result.width,result.height,reach/scale).map(p=>new THREE.Vector3(...displayPoint(p)).multiplyScalar(scale));
   const lines=[];for(let j=0;j<4;j++)lines.push(origin,corners[j],corners[j],corners[(j+1)%4]);
   const g=new THREE.BufferGeometry().setFromPoints(lines);this.root.add(new THREE.LineSegments(g,new THREE.LineBasicMaterial({color})));
   this.root.add(new THREE.ArrowHelper(new THREE.Vector3(...displayPoint(pose.forward)),origin,reach*1.5,color,reach*.25,reach*.15));
   const marker=new THREE.Mesh(new THREE.SphereGeometry(.018*scale,10,8),new THREE.MeshBasicMaterial({color}));marker.position.copy(origin);this.root.add(marker);
   const imageCanvas=frames[i].canvas,texture=new THREE.CanvasTexture(imageCanvas);texture.colorSpace=THREE.SRGBColorSpace;this.textures.push(texture);
   const pg=new THREE.BufferGeometry().setFromPoints(corners);pg.setIndex([0,1,2,0,2,3]);pg.setAttribute('uv',new THREE.Float32BufferAttribute([0,1,1,1,1,0,0,0],2));
   const plane=new THREE.Mesh(pg,new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide,transparent:true,opacity:.92}));this.root.add(plane);this.frusta.push(plane);
   const label=document.createElement('canvas');label.width=64;label.height=64;const ctx=label.getContext('2d');ctx.fillStyle=color;ctx.beginPath();ctx.arc(32,32,30,0,Math.PI*2);ctx.fill();ctx.fillStyle='#ffffff';ctx.font='bold 38px Segoe UI';ctx.textAlign='center';ctx.fillText(String(result.cameraSlots[i]+1),32,46);
   const lt=new THREE.CanvasTexture(label);this.textures.push(lt);const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:lt,depthTest:false,sizeAttenuation:false}));sprite.position.copy(origin).add(new THREE.Vector3(0,.09*scale,0));sprite.scale.set(.045,.045,1);sprite.renderOrder=10;this.root.add(sprite);
  }
  if(layout.floorKnown){const grid=new THREE.GridHelper(this.extent*2,20,'#82b7d8','#d2e5f2');grid.position.set(this.center.x,layout.floorY,this.center.z);this.root.add(grid);}
  this.home();
 }
 visibility(points,images){if(this.cloud)this.cloud.visible=points;for(const p of this.frusta||[])p.visible=images;}
 home(top=false){if(!this.center)return;this.camera.up.set(0,top?0:1,top?-1:0);this.camera.fov=48;this.camera.position.copy(this.center).add(new THREE.Vector3(...(top?[0,this.extent*1.4,0]:[this.extent*.7,this.extent*.55,this.extent*1.05])));this.controls.target.copy(this.center);this.camera.near=Math.max(.0001,this.extent/10000);this.camera.far=this.extent*100;this.camera.updateProjectionMatrix();this.controls.update();}
 snap(index){const c=this.layout.cameras[index],K=this.result.calibration.K[index];this.camera.position.set(...c.position);this.camera.up.set(...c.up);this.controls.target.copy(this.camera.position).addScaledVector(new THREE.Vector3(...c.forward),this.layout.scale*.8);this.camera.fov=2*Math.atan(this.result.height/(2*K[1][1]))*180/Math.PI;this.camera.updateProjectionMatrix();this.controls.update();}
 dispose(){this.renderer.setAnimationLoop(null);this.observer.disconnect();this.controls.dispose();this.clear();this.renderer.dispose();}
}
