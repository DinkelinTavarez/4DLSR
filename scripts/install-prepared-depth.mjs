// One-time installation of locally prepared geometry; original video is never rewritten.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const id='b9ac9e57-6694-4c0b-b39e-e1a6462bc211';
const base=path.resolve('C:/Users/Dean/Desktop/Spatial Replay Recordings');
const target=path.join(base,id),source=path.resolve('.quality-recordings',id,'depth-hq');
const config=await (await fetch('http://127.0.0.1:8794/api/config')).json();
if(path.resolve(config.recordingsDir)!==base)throw Error('Recording directory changed');
const sessions=await (await fetch('http://127.0.0.1:8794/api/sessions')).json();
if(sessions.some(s=>s.status==='recording'))throw Error('Active recording; do not restart');
const times=await(await fetch(`http://127.0.0.1:8797/api/sessions/${id}/frame-times`)).json();
const stamps=times.map(t=>Math.round(t*1000));
const names=(await fs.readdir(source)).filter(n=>/^\d+\.bin$/.test(n));
if(names.length!==294||stamps.some(t=>!names.includes(`${t}.bin`)))throw Error('Incomplete HQ preparation');
for(const name of names){const b=await fs.readFile(path.join(source,name));if(b.readUInt32LE(0)!==640||b.readUInt32LE(4)!==360||b.length!==460808)throw Error('Invalid depth map');}
const originals=['capture.webm','recording.webm',...(await fs.readdir(path.join(target,'depth'))).map(n=>`depth/${n}`)];
async function hashes(){const result={};for(const name of originals)result[name]=createHash('sha256').update(await fs.readFile(path.join(target,name))).digest('hex');return result;}
const before=await hashes();
const metadata=await fs.readFile(path.join(target,'session.json'),'utf8');
await fs.writeFile('artifacts/session-before-hq.json',metadata);
const s=JSON.parse(metadata);if(s.status!=='saved')throw Error('Session is not saved');
const serverPid=Number((await fs.readFile('artifacts/server.pid','utf8')).trim());
if(serverPid!==44644)throw Error('Production process changed; recheck before restarting');
process.kill(serverPid);
await fs.mkdir(path.join(target,'depth-hq'),{recursive:true});
for(const name of names)await fs.copyFile(path.join(source,name),path.join(target,'depth-hq',name),1);
s.hqDepthFrames=names.length;
await fs.writeFile(path.join(target,'session.json.tmp'),JSON.stringify(s,null,2));
await fs.rename(path.join(target,'session.json.tmp'),path.join(target,'session.json'));
const after=await hashes();if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Original-file integrity mismatch');
await fs.writeFile('artifacts/hq-installation.json',JSON.stringify({id,frames:names.length,width:640,height:360,bytes:names.length*460808,originalsUnchanged:true,hashes:after},null,2));
console.log(JSON.stringify({frames:names.length,originalFilesVerified:originals.length,originalsUnchanged:true}));
