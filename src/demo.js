import * as T from 'three';
export class DemoScene{
 constructor(canvas){
  this.canvas=canvas;this.renderer=new T.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});this.renderer.setSize(960,540,false);this.renderer.setPixelRatio(1);this.renderer.setClearColor(0x16291f);this.renderer.outputColorSpace=T.SRGBColorSpace;
  this.scene=new T.Scene();this.camera=new T.PerspectiveCamera(50,16/9,.1,30);this.scene.add(new T.HemisphereLight(0xe7ffdc,0x4a5c43,2));
  const light=new T.DirectionalLight(0xffdda2,3);light.position.set(-2,4,1);this.scene.add(light);
  const box=(x,y,z,w,h,d,color)=>{const o=new T.Mesh(new T.BoxGeometry(w,h,d),new T.MeshStandardMaterial({color,roughness:.8}));o.position.set(x,y,z);this.scene.add(o);return o;};
  box(0,-1.5,-4,12,.1,12,0x293d2b);box(0,0,-6,12,6,.1,0x3f5545);box(-4,0,-3,.1,6,8,0x58735b);box(4,0,-3,.1,6,8,0x304334);
  for(let i=-9;i<10;i++){box(i*.5,-1.443,-4,.007,.003,11,0x698365);box(0,-1.442,i*.5-4,12,.003,.007,0x698365);}
  box(-1.9,.3,-5.9,1.8,2.3,.15,0x17281d);box(-1.9,.3,-5.8,1.55,2.05,.04,0xd2aa69);
  const art=new T.Mesh(new T.TorusGeometry(.43,.075,14,60),new T.MeshStandardMaterial({color:0x735238}));art.position.set(-1.9,.4,-5.7);this.scene.add(art);
  box(.25,-.94,-3.7,1.5,.15,1,0xb19972);for(const x of [-.34,.84])for(const z of [-3.35,-4.05])box(x,-1.22,z,.07,.5,.07,0x233e2d);
  this.ball=new T.Mesh(new T.SphereGeometry(.38,40,24),new T.MeshStandardMaterial({color:0xdd7958,roughness:.27,metalness:.1}));this.scene.add(this.ball);
  const plinth=box(2.3,-1.0,-4.9,.7,.9,.7,0x9ba88a);
  this.knot=new T.Mesh(new T.TorusKnotGeometry(.32,.11,90,12),new T.MeshStandardMaterial({color:0xb0c8a0,metalness:.5,roughness:.23}));this.knot.position.set(2.3,-.1,-4.9);this.scene.add(this.knot);
  const pot=new T.Mesh(new T.CylinderGeometry(.28,.2,.48,28),new T.MeshStandardMaterial({color:0xb7a281}));pot.position.set(-2.6,-1.17,-3.8);this.scene.add(pot);
  for(let i=0;i<11;i++){const leaf=new T.Mesh(new T.SphereGeometry(1,16,10),new T.MeshStandardMaterial({color:new T.Color().setHSL(.28+i*.003,.23,.20+i*.013)}));const angle=i*2.4;leaf.scale.set(.11,.48,.08);leaf.position.set(-2.6+Math.cos(angle)*.22,-.65+i*.025,-3.8+Math.sin(angle)*.22);leaf.rotation.set(Math.cos(angle)*.7,angle,Math.sin(angle)*.65);this.scene.add(leaf);}
  this.target=new T.WebGLRenderTarget(256,144);this.target.depthTexture=new T.DepthTexture(256,144,T.UnsignedIntType);
  this.readTarget=new T.WebGLRenderTarget(256,144);this.quadScene=new T.Scene();this.quadCamera=new T.OrthographicCamera(-1,1,1,-1,0,1);
  this.quadScene.add(new T.Mesh(new T.PlaneGeometry(2,2),new T.ShaderMaterial({uniforms:{map:{value:this.target.depthTexture}},vertexShader:'varying vec2 vUv; void main(){vUv=uv; gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:'uniform sampler2D map;varying vec2 vUv;void main(){float d=texture2D(map,vUv).r;float z=(.1*30.)/(30.-d*(30.-.1));float norm=clamp((1./z-1./7.)/(1.-1./7.),0.,1.);gl_FragColor=vec4(norm,0.,0.,1.);}'})));
  this.pixels=new Uint8Array(256*144*4);this.depth=new Float32Array(256*144);
 }
 frame(time){
  this.ball.position.set(.25+Math.sin(time*.7)*.52,-.42+Math.sin(time*1.4)*.12,-3.6);this.knot.rotation.y=time*.3;
  this.renderer.setRenderTarget(this.target);this.renderer.render(this.scene,this.camera);
  this.renderer.setRenderTarget(this.readTarget);this.renderer.render(this.quadScene,this.quadCamera);this.renderer.readRenderTargetPixels(this.readTarget,0,0,256,144,this.pixels);
  for(let y=0;y<144;y++)for(let x=0;x<256;x++)this.depth[y*256+x]=this.pixels[((143-y)*256+x)*4]/255;
  this.renderer.setRenderTarget(null);this.renderer.render(this.scene,this.camera);return this.depth;
 }
}
