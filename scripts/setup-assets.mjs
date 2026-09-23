import { promises as fs } from 'node:fs';
import path from 'node:path';
const root=path.resolve('public/models/onnx-community/depth-anything-v2-small');
await fs.mkdir(path.join(root,'onnx'),{recursive:true});
for(const name of ['config.json','preprocessor_config.json','onnx/model_quantized.onnx']){
  const dest=path.join(root,name);
  if(await fs.stat(dest).catch(()=>null)){console.log('Present:',name);continue;}
  console.log('Downloading:',name);
  const response=await fetch('https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/'+name);
  if(!response.ok)throw new Error(`${response.status}: ${name}`);
  await fs.writeFile(dest,new Uint8Array(await response.arrayBuffer()));
}
await fs.mkdir('public/ort',{recursive:true});
const ort='node_modules/onnxruntime-web/dist';
for(const name of await fs.readdir(ort))if(name.startsWith('ort-wasm')&&(name.endsWith('.wasm')||name.endsWith('.mjs')))await fs.copyFile(path.join(ort,name),path.join('public/ort',name));
console.log('Local inference assets ready.');
