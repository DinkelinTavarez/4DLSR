import path from 'node:path';
import {promises as fs} from 'node:fs';
import {randomUUID} from 'node:crypto';

const valid=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
export function labStore({store,root,body,json,fail,serialized}){
 const base=path.join(store,'Lab','experiments');
 const file=id=>path.join(base,id,'experiment.json');
 async function read(id){if(!valid(id))throw fail(400,'Invalid experiment');try{return JSON.parse(await fs.readFile(file(id),'utf8'));}catch{throw fail(404,'Experiment not found');}}
 async function write(value){await fs.mkdir(path.dirname(file(value.id)),{recursive:true});await fs.writeFile(file(value.id)+'.tmp',JSON.stringify(value,null,2));await fs.rename(file(value.id)+'.tmp',file(value.id));}
 function str(value,label,max=4000,required=false){if(typeof value!=='string'||value.length>max||(required&&value.trim().length<5))throw fail(400,`${label} ${required?'needs at least five characters':'is invalid'}`);return value.trim();}
 async function fields(input,id){
  const result={title:str(input.title,'Experiment title',120,true),hypothesis:str(input.hypothesis,'Hypothesis',4000,true),successCriteria:str(input.successCriteria,'Success criteria',4000,true),group:str(input.group||'','Group',100),status:input.status||'planned',links:input.links||[]};
  if(!['planned','active','reviewed'].includes(result.status))throw fail(400,'Invalid experiment status');
  if(!Array.isArray(result.links)||result.links.length>50||new Set(result.links).size!==result.links.length||result.links.some(x=>!valid(x)||x===id))throw fail(400,'Choose distinct related experiments');
  for(const link of result.links)await read(link);
  return result;
 }
 async function captureContext(input){
  if(!input)throw fail(400,'Choose an experiment and describe this session before recording');
  const experiment=await read(input.experimentId);
  if(experiment.status==='reviewed')throw fail(409,'Reopen this experiment before adding a session');
  return {experimentId:experiment.id,experimentRevision:experiment.revision,title:experiment.title,hypothesis:experiment.hypothesis,successCriteria:experiment.successCriteria,whatChanged:str(input.whatChanged,'What changed',4000,true),procedure:str(input.procedure,'Session procedure',4000,true),conditions:str(input.conditions||'','Conditions',4000),label:str(input.label||'','Session label',120),capturedAt:new Date().toISOString()};
 }
 async function sessions(id){const items=[];for(const name of await fs.readdir(path.join(store,'.rigs')).catch(()=>[])){if(!/^[a-f0-9-]{36}\.json$/.test(name))continue;const rig=await fs.readFile(path.join(store,'.rigs',name),'utf8').then(JSON.parse).catch(()=>null);if(rig&&(!id||rig.context?.experimentId===id))items.push(rig);}return items.sort((a,b)=>b.created.localeCompare(a.created));}
 async function report(id){
  const experiment=await read(id),takes=await sessions(id),builds=[];
  for(const job of await fs.readdir(path.join(root,'.reconstructions')).catch(()=>[])){if(!valid(job))continue;const dir=path.join(root,'.reconstructions',job);const spec=await fs.readFile(path.join(dir,'spec.json'),'utf8').then(JSON.parse).catch(()=>null);if(!takes.some(t=>t.id===spec?.rigId))continue;
   const status=await fs.readFile(path.join(dir,'status.json'),'utf8').then(JSON.parse).catch(()=>({state:'unknown'}));const evaluation=await fs.readFile(path.join(dir,'evaluation.json'),'utf8').then(JSON.parse).catch(()=>null);
   const manifest=await fs.readFile(path.join(dir,'manifest.json'),'utf8').then(JSON.parse).catch(()=>null);
   builds.push({id:job,rigId:spec.rigId,created:spec.created,profile:spec.profile,mode:spec.mode,cameraSlots:spec.slots,method:spec.method,optimizations:spec.optimizations,surfaceGuidance:spec.surfaceGuidance,state:status.state,elapsedSeconds:status.elapsedSeconds,score:evaluation?.summary||null,scoringVersion:evaluation?.scoringVersion||null,training:manifest?.training||null,sampleTimes:manifest?.frames.map(f=>f.time)||[],resolution:manifest?{width:manifest.width,height:manifest.height}:null});
  }
  return {version:1,generated:new Date().toISOString(),experiment,sessions:takes,builds:builds.sort((a,b)=>a.created.localeCompare(b.created)),verdict:'Novel-view realism, metric scale and exposure synchronization remain unverified. Source-view scores are not percent realism.',comparisonRule:'Compare the same take, selected views, scoring version and sample times to isolate a software change. New camera layouts require a repeated motion protocol and a withheld reference view.'};
 }
 function markdown(r){return `# ${r.experiment.title}\n\nGroup: ${r.experiment.group||'Ungrouped'} · Status: ${r.experiment.status}\n\nHypothesis: ${r.experiment.hypothesis}\n\nSuccess criteria: ${r.experiment.successCriteria}\n\n${r.verdict}\n\n${r.comparisonRule}\n\n## Sessions\n\n${r.sessions.map(t=>`### ${t.name}\n\n${t.created} · ${t.cameras.length} cameras · ${t.status}${t.simulated?' · SIMULATED':''}\n\nChanged: ${t.context.whatChanged}\n\nProcedure: ${t.context.procedure}\n\nConditions: ${t.context.conditions||'Not specified'}\n\nID: ${t.id}`).join('\n\n')||'No sessions yet.'}\n\n## Builds\n\n${r.builds.map(b=>`- ${b.id}: ${b.profile} ${b.mode}, ${b.cameraSlots?.length||'?'} views, ${b.state}, source score ${b.score?.sourceViewScore?.toFixed(2)??'unmeasured'}/100.`).join('\n')||'No builds yet.'}\n\n## Notebook\n\n${r.experiment.notes.map(n=>`### ${n.created} · ${n.kind}\n\n${n.text}`).join('\n\n')||'No notes yet.'}\n`;}
 async function routes(req,res,url){
  if(!url.pathname.startsWith('/api/lab/'))return false;
  if(url.pathname==='/api/lab/experiments'){
   if(req.method==='GET'){const items=[];for(const id of await fs.readdir(base).catch(()=>[]))if(valid(id))items.push(await read(id));const takes=await sessions();json(res,items.sort((a,b)=>b.updated.localeCompare(a.updated)).map(e=>({...e,sessionCount:takes.filter(t=>t.context?.experimentId===e.id).length})));return true;}
   if(req.method==='POST'){const input=JSON.parse((await body(req,65536)).toString()),id=randomUUID(),now=new Date().toISOString();const value={version:1,id,...await fields(input,id),created:now,updated:now,revision:1,notes:[],history:[]};await write(value);json(res,value,201);return true;}
  }
  const m=/^\/api\/lab\/experiments\/([a-f0-9-]{36})(?:\/(notes|report\.json|report\.md))?$/.exec(url.pathname);
  if(!m)throw fail(404,'Unknown lab route');const [,id,action]=m;
  if(req.method==='GET'){
   if(action?.startsWith('report.')){const r=await report(id);const dir=path.dirname(file(id));await fs.writeFile(path.join(dir,'report.json'),JSON.stringify(r,null,2));await fs.writeFile(path.join(dir,'report.md'),markdown(r));res.setHeader('Content-Disposition',`attachment; filename="experiment-${id}.${action.endsWith('md')?'md':'json'}"`);if(action.endsWith('md')){res.writeHead(200,{'Content-Type':'text/markdown; charset=utf-8','Cache-Control':'no-store'});res.end(markdown(r));}else json(res,r);return true;}
   if(!action){json(res,{...await read(id),sessions:await sessions(id)});return true;}
  }
  if(req.method!=='POST')throw fail(405,'POST required');
  const input=JSON.parse((await body(req,65536)).toString());
  const value=await serialized('lab:'+id,async()=>{const e=await read(id);if(input.revision!==e.revision)throw fail(409,'This experiment changed. Refresh before saving. Your draft has not been discarded.');const now=new Date().toISOString();
   if(action==='notes'){if(!['observation','decision','next-step'].includes(input.kind))throw fail(400,'Invalid note type');e.notes.push({id:randomUUID(),kind:input.kind,text:str(input.text,'Note',12000,true),created:now});}
   else if(!action){e.history.push({revision:e.revision,updated:e.updated,title:e.title,hypothesis:e.hypothesis,successCriteria:e.successCriteria,group:e.group,status:e.status,links:e.links});Object.assign(e,await fields(input,id));}
   else throw fail(404,'Unknown lab action');e.revision++;e.updated=now;await write(e);return e;});json(res,value);return true;
 }
 return {routes,captureContext};
}
