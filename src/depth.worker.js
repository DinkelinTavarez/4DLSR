import { pipeline, env, RawImage } from '@huggingface/transformers';
env.allowRemoteModels=false;
env.allowLocalModels=true;
env.localModelPath='/models/';
env.backends.onnx.wasm.wasmPaths='/ort/';
env.backends.onnx.wasm.numThreads=Math.min(4,navigator.hardwareConcurrency||2);
let estimator, backend='wasm', previous=null;
async function init(){
  const options={dtype:'q8',progress_callback:p=>self.postMessage({type:'progress',progress:p.progress||0,status:p.status})};
  try{
    if(!navigator.gpu || !await navigator.gpu.requestAdapter())throw new Error('WebGPU unavailable');
    estimator=await pipeline('depth-estimation','onnx-community/depth-anything-v2-small',{...options,device:'webgpu'});backend='webgpu';
  }catch{
    estimator=await pipeline('depth-estimation','onnx-community/depth-anything-v2-small',{...options,device:'wasm'});
  }
  estimator.processor.image_processor.size={height:294,width:294};
  self.postMessage({type:'ready',backend});
}
self.onmessage=async({data})=>{
  try{
    if(data.type==='init'){await init();return;}
    const begin=performance.now();
    const hq=data.quality==='hq';estimator.processor.image_processor.size={height:hq?518:294,width:hq?518:294};
    const image=new RawImage(new Uint8ClampedArray(data.rgba),data.width,data.height,4);
    const result=await estimator(image);
    const tensor=result.predicted_depth;
    const values=tensor.data;
    const h=tensor.dims.at(-2),w=tensor.dims.at(-1);
    // Robust per-frame inverse-depth normalization. Relative, not metric geometry.
    const sample=[];for(let i=0;i<values.length;i+=8)sample.push(values[i]);sample.sort((a,b)=>a-b);
    let low=sample[Math.floor(sample.length*.02)],high=sample[Math.floor(sample.length*.98)];
    const sequential=previous&&previous.key===data.key&&data.time>previous.time&&data.time-previous.time<2&&previous.width===data.width&&previous.height===data.height;
    if(sequential){low=previous.low*.65+low*.35;high=previous.high*.65+high*.35;}
    const out=new Float32Array(data.width*data.height),range=Math.max(high-low,.0001);
    for(let y=0;y<data.height;y++)for(let x=0;x<data.width;x++){
      const value=values[Math.min(h-1,Math.floor(y*h/data.height))*w+Math.min(w-1,Math.floor(x*w/data.width))];
      out[y*data.width+x]=Math.max(0,Math.min(1,(value-low)/range));
    }
    const rgb=new Uint8ClampedArray(data.rgba);
    if(sequential&&hq){
      // Align the relative-depth scale on visually stationary pixels of a fixed camera.
      let n=0,sx=0,sy=0,sxx=0,sxy=0;
      for(let i=0;i<out.length;i+=8){const j=i*4,change=Math.abs(rgb[j]-previous.rgb[j])+Math.abs(rgb[j+1]-previous.rgb[j+1])+Math.abs(rgb[j+2]-previous.rgb[j+2]);if(change<20){const x=out[i],y=previous.depth[i];n++;sx+=x;sy+=y;sxx+=x*x;sxy+=x*y;}}
      const variance=n*sxx-sx*sx;
      if(n>200&&variance>1){const scale=Math.max(.85,Math.min(1.18,(n*sxy-sx*sy)/variance)),offset=Math.max(-.1,Math.min(.1,(sy-scale*sx)/n));for(let i=0;i<out.length;i++)out[i]=Math.max(0,Math.min(1,out[i]*scale+offset));}
    }
    if(sequential&&!hq)for(let i=0;i<out.length;i++){
      const j=i*4,change=Math.abs(rgb[j]-previous.rgb[j])+Math.abs(rgb[j+1]-previous.rgb[j+1])+Math.abs(rgb[j+2]-previous.rgb[j+2]);
      if(change<35&&Math.abs(out[i]-previous.depth[i])<.14)out[i]=out[i]*.45+previous.depth[i]*.55;
    }
    previous={key:data.key,width:data.width,height:data.height,time:data.time,low,high,rgb,depth:out.slice()};
    self.postMessage({type:'depth',id:data.id,time:data.time,depth:out.buffer,width:data.width,height:data.height,latency:performance.now()-begin},[out.buffer]);
  }catch(error){self.postMessage({type:'error',id:data.id,error:String(error.message||error)});}
};
