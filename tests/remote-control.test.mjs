import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {remoteControl} from '../remote-control.mjs';
function fixture(){let clock=1000;const route=remoteControl({body:async req=>Buffer.from(JSON.stringify(req.data)),json:(res,data,status=200)=>Object.assign(res,{data,status}),fail:(status,message)=>Object.assign(new Error(message),{status}),now:()=>clock});return {advance:n=>clock+=n,call:async(path,data,method='POST')=>{const res={};await route({method,data},res,new URL(path,'http://local'));return res.data;}};}
const start=()=>({id:randomUUID(),action:'start',seconds:10,profile:'quick',maxGaussians:0,requireQuality:true,context:{experimentId:randomUUID(),whatChanged:'Remote test of the recording flow'}});
test('remote capture requires an online agent and delivers a command once despite retries',async()=>{
 const f=fixture(),c=start(),agentId=randomUUID(),state={recording:false,cameras:[]};
 await assert.rejects(f.call('/api/remote/commands',c),/offline/);
 await f.call('/api/remote/agent',{agentId,state});
 await f.call('/api/remote/commands',c);await f.call('/api/remote/commands',c);
 assert.equal((await f.call('/api/remote/agent',{agentId,state})).command.id,c.id);
 assert.equal((await f.call('/api/remote/agent',{agentId,state})).command,null);
 await f.call('/api/remote/agent',{agentId,state,ack:{id:c.id}});
 assert.equal((await f.call('/api/remote/state',null,'GET')).command.status,'complete');
 await assert.rejects(f.call('/api/remote/agent',{agentId:randomUUID(),state}),/Another desktop/);
});
test('stale start requests expire and a busy agent can defer command delivery',async()=>{
 const f=fixture(),agentId=randomUUID(),state={cameras:[]},c=start();await f.call('/api/remote/agent',{agentId,state});await f.call('/api/remote/commands',c);
 assert.equal((await f.call('/api/remote/agent',{agentId,state,acceptCommands:false})).command,null);
 f.advance(16000);assert.equal((await f.call('/api/remote/state',null,'GET')).online,false);
 assert.equal((await f.call('/api/remote/agent',{agentId,state})).command,null);
 assert.equal((await f.call('/api/remote/state',null,'GET')).command.status,'failed');
});
test('remote commands enforce duration, explicit quality policy and supported actions',async()=>{
 const f=fixture();await f.call('/api/remote/agent',{agentId:randomUUID(),state:{cameras:[]}});
 await assert.rejects(f.call('/api/remote/commands',{...start(),seconds:1000}),/duration/);
 await assert.rejects(f.call('/api/remote/commands',{...start(),requireQuality:undefined}),/capture/);
 await assert.rejects(f.call('/api/remote/commands',{...start(),action:'execute'}),/Unsupported/);
});
