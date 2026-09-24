import http from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export function allowedRemoteRoute(method,pathname){
 if(method==='GET')return /^\/api\/(?:remote\/state|rigs(?:\/[a-f0-9-]{36})?|lab\/experiments(?:\/[a-f0-9-]{36}(?:\/report\.json)?)?|reconstructions(?:\/[a-f0-9-]{36}(?:\/(?:manifest\.json|frame-\d{5}\.splat))?)?)$/.test(pathname);
 if(method==='POST')return /^\/api\/(?:remote\/commands|lab\/experiments(?:\/[a-f0-9-]{36}(?:\/notes)?)?|reconstructions)$/.test(pathname);
 return false;
}
export function createRemoteGateway({secret,origins,engine='http://127.0.0.1:8794',fetchImpl=fetch}){
 if(!/^[a-f0-9]{64}$/.test(secret))throw new Error('A random 256-bit access key is required.');
 const accepted=new Set(origins),key=Buffer.from(secret),fail=(res,status,error)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error}));};
 return http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  const origin=req.headers.origin;
  if(origin&&!accepted.has(origin))return fail(res,403,'Origin denied');
  if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Expose-Headers','Content-Length,Content-Range');}
  if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Authorization,Content-Type,Range,ngrok-skip-browser-warning');res.writeHead(204);return res.end();}
  const supplied=Buffer.from(String(req.headers.authorization||'').replace(/^Bearer /,''));
  if(supplied.length!==key.length||!timingSafeEqual(supplied,key))return fail(res,401,'Pair your phone with the desktop access key.');
  try{
   const url=new URL(req.url,'http://gateway.invalid');
   if(!allowedRemoteRoute(req.method,url.pathname)||url.search)return fail(res,404,'Route unavailable');
   let body;
   if(req.method==='POST'){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>65536)return fail(res,413,'Request too large');chunks.push(chunk);}body=Buffer.concat(chunks);}
   const configuration=await fetchImpl(engine+'/api/config',{signal:AbortSignal.timeout(5000)}).then(r=>{if(!r.ok)throw new Error('Desktop unavailable');return r.json();});
   const headers={'X-Spatial-Token':configuration.token};if(body)headers['Content-Type']='application/json';if(req.headers.range)headers.Range=req.headers.range;
   const upstream=await fetchImpl(engine+url.pathname,{method:req.method,headers,body,redirect:'error',signal:AbortSignal.timeout(120000)});
   res.statusCode=upstream.status;
   for(const name of ['content-type','content-length','content-range','accept-ranges'])if(upstream.headers.has(name))res.setHeader(name,upstream.headers.get(name));
   for await(const chunk of upstream.body){if(res.destroyed)break;if(!res.write(chunk))await new Promise(resolve=>{const done=()=>{res.off('drain',done);res.off('close',done);resolve();};res.once('drain',done);res.once('close',done);});}res.end();
  }catch(error){if(!res.headersSent)fail(res,502,'Desktop connection unavailable. Keep the PC awake and the app running.');else res.destroy();}
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const config=JSON.parse(await readFile(new URL('./artifacts/remote-access.json',import.meta.url),'utf8'));
 const server=createRemoteGateway(config);server.listen(config.port||8800,'127.0.0.1',()=>console.log('Private desktop gateway ready on loopback.'));
}
