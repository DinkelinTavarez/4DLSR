import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {createRemoteGateway,allowedRemoteRoute} from '../remote-gateway.mjs';
test('private gateway rejects missing keys, disallowed origins and internal/unsafe routes before touching the desktop',async()=>{
 const secret=randomBytes(32).toString('hex'),calls=[];
 const server=createRemoteGateway({secret,origins:['https://phone.example'],fetchImpl:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(url.endsWith('/api/config')?{token:'LOCAL-ONLY'}:{online:true}),{headers:{'Content-Type':'application/json'}});}});
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`,auth={Authorization:'Bearer '+secret,Origin:'https://phone.example'};
 try{
  assert.equal((await fetch(base+'/api/remote/state')).status,401);
  assert.equal((await fetch(base+'/api/remote/state',{headers:{...auth,Origin:'https://bad.example'}})).status,403);
  for(const path of ['/api/config','/api/remote/agent','/api/camera-bridge/open','/api/remote/state?key=anything','/recordings/private.webm'])assert.equal((await fetch(base+path,{headers:auth})).status,404);
  assert.equal(calls.length,0);
  const response=await fetch(base+'/api/remote/state',{headers:auth});assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://phone.example');
  assert.deepEqual(await response.json(),{online:true});assert.equal(calls[1].options.headers['X-Spatial-Token'],'LOCAL-ONLY');assert.equal(calls[1].options.headers.Authorization,undefined);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('gateway permits only intended reads and bounded experiment operations',()=>{
 assert.ok(allowedRemoteRoute('GET','/api/reconstructions/12345678-1234-1234-1234-123456789abc/frame-00001.splat'));
 assert.ok(allowedRemoteRoute('POST','/api/remote/commands'));
 assert.equal(allowedRemoteRoute('DELETE','/api/rigs'),false);
 assert.equal(allowedRemoteRoute('POST','/api/remote/agent'),false);
 assert.equal(allowedRemoteRoute('GET','/api/reconstructions/12345678-1234-1234-1234-123456789abc/worker.log'),false);
});
