import * as T from 'three';

// Integrate exponential acceleration exactly so distance is independent of FPS.
export function dampMotion(position,velocity,target,dt,response=14){
 const decay=Math.exp(-response*dt),integral=(1-decay)/response;
 position.addScaledVector(target,dt).addScaledVector(velocity.clone().sub(target),integral);
 velocity.lerp(target,1-decay);
}

export class FlyControls{
 constructor(camera,canvas,{onState=()=>{}}={}){
  this.camera=camera;this.canvas=canvas;this.onState=onState;this.enabled=false;this.speed=1;this.keys=new Set();this.velocity=new T.Vector3();this.angles=new T.Euler(0,0,0,'YXZ');
  this.forward=new T.Vector3();this.right=new T.Vector3();this.targetVelocity=new T.Vector3();this.dragging=false;
  canvas.tabIndex=0;canvas.setAttribute('aria-label','3D scene. Click to focus. W A S D move, E or Space up, Q or Control down, Shift boosts speed. Drag to look.');
  this.handlers=[];const on=(element,event,fn)=>{element.addEventListener(event,fn);this.handlers.push(()=>element.removeEventListener(event,fn));};
  const codes=new Set(['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','KeyR','KeyF','Space','ControlLeft','ControlRight','ShiftLeft','ShiftRight','AltLeft','AltRight','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyX']);
  on(window,'keydown',e=>{if(!this.enabled||!this.focused()||!codes.has(e.code))return;e.preventDefault();if(e.code==='KeyX')this.stop();else this.keys.add(e.code);});
  on(window,'keyup',e=>this.keys.delete(e.code));on(window,'blur',()=>this.stop());on(canvas,'blur',()=>this.stop());on(document,'visibilitychange',()=>{if(document.hidden)this.stop();});
  on(canvas,'pointerdown',e=>{if(!this.enabled||e.button!==0)return;canvas.focus({preventScroll:true});this.dragging=true;this.lastPointer=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId);});
  on(canvas,'pointermove',e=>{if(!this.enabled)return;const locked=document.pointerLockElement===canvas;if(!locked&&!this.dragging)return;const dx=locked?e.movementX:e.clientX-this.lastPointer[0],dy=locked?e.movementY:e.clientY-this.lastPointer[1];this.lastPointer=[e.clientX,e.clientY];this.look(dx,dy);});
  on(canvas,'pointerup',()=>this.dragging=false);on(canvas,'pointercancel',()=>{this.dragging=false;this.stop();});
  on(canvas,'contextmenu',e=>e.preventDefault());
  on(document,'pointerlockchange',()=>{this.stop();this.onState(document.pointerLockElement===canvas?'Mouse captured · Esc releases':'Drag to look · click scene for keyboard movement');});
  on(document,'pointerlockerror',()=>this.onState('Mouse capture unavailable here · drag to look'));
 }
 focused(){return document.activeElement===this.canvas||document.pointerLockElement===this.canvas;}
 setEnabled(value){this.enabled=value;this.stop();if(value){this.sync();this.onState('Click scene, then fly · drag to look');}else if(document.pointerLockElement===this.canvas)document.exitPointerLock();}
 sync(){this.angles.setFromQuaternion(this.camera.quaternion,'YXZ');}
 look(dx,dy){this.angles.y-=dx*.002;this.angles.x=T.MathUtils.clamp(this.angles.x-dy*.002,-Math.PI/2+.015,Math.PI/2-.015);this.camera.quaternion.setFromEuler(this.angles);}
 stop(){this.keys.clear();this.velocity.set(0,0,0);this.dragging=false;}
 async capture(){if(!this.enabled)return;this.canvas.focus({preventScroll:true});try{if(!this.canvas.requestPointerLock)throw new Error();await this.canvas.requestPointerLock();}catch{this.onState('Mouse capture unavailable here · drag to look');}}
 update(dt){
  if(!this.enabled||!this.focused()){this.stop();return false;}
  const has=(...codes)=>codes.some(c=>this.keys.has(c));
  this.forward.set(0,0,-1).applyQuaternion(this.camera.quaternion);this.right.set(1,0,0).applyQuaternion(this.camera.quaternion);
  this.targetVelocity.copy(this.forward).multiplyScalar(Number(has('KeyW','ArrowUp'))-Number(has('KeyS','ArrowDown'))).addScaledVector(this.right,Number(has('KeyD','ArrowRight'))-Number(has('KeyA','ArrowLeft')));
  this.targetVelocity.y+=Number(has('KeyE','KeyR','Space'))-Number(has('KeyQ','KeyF','ControlLeft','ControlRight'));
  if(this.targetVelocity.lengthSq()>0)this.targetVelocity.normalize().multiplyScalar(this.speed*(has('ShiftLeft','ShiftRight')?4:1)*(has('AltLeft','AltRight')?.25:1));
  const moving=this.velocity.lengthSq()>1e-8||this.targetVelocity.lengthSq()>0;
  dampMotion(this.camera.position,this.velocity,this.targetVelocity,Math.min(dt,.05));return moving;
 }
 dispose(){this.stop();for(const remove of this.handlers)remove();}
}
