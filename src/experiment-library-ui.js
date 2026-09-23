export function experimentLibraryUI({api,post,report,refresh,openBuild}){
 const list=document.getElementById('takes-list'),node=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
 list.parentElement.querySelector('h2').textContent='Experiment library';
 const toolbar=node('div');toolbar.className='library-toolbar';const search=node('input');search.type='search';search.placeholder='Search experiments';search.setAttribute('aria-label','Search experiments');
 const sync=node('button','Refresh / repair archive');sync.className='secondary';toolbar.append(search,sync);list.before(toolbar);
 function filter(){const query=search.value.toLowerCase();for(const row of list.children)row.hidden=!row.textContent.toLowerCase().includes(query);}
 search.oninput=filter;
 sync.onclick=async()=>{sync.disabled=true;sync.textContent='Archiving…';try{const result=await post('/api/experiments/sync',{});await refresh();if(result.errors.length)throw new Error(result.errors.map(e=>e.error).join('; '));}catch(error){report(error);}finally{sync.disabled=false;sync.textContent='Refresh / repair archive';}};
 document.addEventListener('experiment-library-changed',()=>refresh().catch(report));
 async function entries(){return new Map((await api('/api/experiments')).map(e=>[e.id,e]));}
 function decorate(row,take,entry){
  row.dataset.takeId=take.id;
  if(!entry){if(take.status==='saved')row.append(node('small','Archive pending · use Refresh / repair archive. Original recordings are saved.'));return;}
  const details=node('details'),summary=node('summary',`${entry.reconstructions.length} 3D builds · experiment files`);details.className='library-files';details.append(summary);
  const location=node('p',entry.path);location.className='rig-path';details.append(location);
  const originals=node('div');originals.className='library-links';
  for(const camera of entry.originals){const a=node('a',`${camera.label} · original video`);a.href=`/api/experiments/${entry.id}/files/${camera.file}`;a.download=`camera-${camera.slot+1}.webm`;originals.append(a);}
  details.append(originals);
  if(entry.reconstructions.length){
   const select=node('select');select.setAttribute('aria-label','Saved 3D build');
   for(const build of entry.reconstructions)select.add(new Option(`${new Date(build.created).toLocaleString()} · ${build.profile} ${build.mode} · ${build.score?'source score '+build.score.sourceViewScore.toFixed(1)+'/100':'not scored'}`,build.id));
   const open=node('button','Open saved 3D'),links=node('div');links.className='library-links';
   const update=()=>{const build=entry.reconstructions.find(b=>b.id===select.value);links.replaceChildren();for(const [file,label]of [['frame-00000.splat','First Gaussian frame'],['mesh-00000.glb','First 3D mesh'],['pretraining.blend','Blender model'],['scape-layout.json','Scape layout'],['manifest.json','Replay manifest'],['evaluation.json','Score report']])if(build.files.includes(file)){const a=node('a',label);a.href=`/api/experiments/${entry.id}/files/reconstructions/${build.id}/${file}`;a.download=file;links.append(a);}};
   select.onchange=update;update();open.onclick=()=>openBuild(take,select.value).catch(report);details.append(select,open,links);
   const latest=entry.reconstructions[0],quick=node('button','Open latest 3D');quick.onclick=()=>openBuild(take,latest.id).catch(report);row.append(quick);
   if(latest.score)row.append(node('small',`Latest source fidelity: ${latest.score.sourceViewScore.toFixed(1)} / 100 · 3D realism unverified`));
  }else details.append(node('p','Original angles are archived. Build combined 3D to add Gaussian replay, model files and scores here.'));
  row.append(details);
 }
 return {entries,decorate,filter};
}
