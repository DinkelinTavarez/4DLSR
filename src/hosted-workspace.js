// The Vercel build has no access to desktop storage, USB devices or CUDA.
// Keep preview notes in this browser; never fake successful capture/processing.
export function browserNotebook(storage, id=()=>crypto.randomUUID()) {
  const key='spatial-hosted-notebook-v1';
  const read=()=>{const value=JSON.parse(storage.getItem(key)||'[]');if(!Array.isArray(value))throw new Error('The browser notebook could not be read.');return value;};
  const text=(value,name,max=4000)=>{const result=String(value||'').trim();if(result.length<5||result.length>max)throw new Error(`${name} must contain 5–${max} characters.`);return result;};
  return async function api(url,options={}) {
    const method=options.method||'GET',route=new URL(url,'https://preview.invalid').pathname;
    if(method==='GET'&&route==='/api/config')return {ffmpeg:false,hosted:true,recordingsDir:'Desktop recordings are not connected to this phone preview.'};
    if(method==='GET'&&['/api/rigs','/api/experiments'].includes(route))return [];
    if(method==='POST'&&route==='/api/experiments/sync')return {errors:[]};
    if(method==='POST'&&route==='/api/camera-bridge/close')return {ok:true};
    const match=/^\/api\/lab\/experiments(?:\/([\w-]+)(?:\/(notes|report\.json))?)?$/.exec(route);
    if(!match)throw new Error('This feature needs the desktop engine. The hosted preview is not connected to your PC.');
    const entries=read(),entry=match[1]?entries.find(e=>e.id===match[1]):null;
    if(match[1]&&!entry)throw new Error('Experiment not found in this browser.');
    if(method==='GET') {
      if(match[2]==='report.json')return {version:1,generated:new Date().toISOString(),experiment:entry,sessions:[],builds:[],verdict:'Browser preview only. No captured geometry has been evaluated.'};
      return entry||entries;
    }
    if(method!=='POST')throw new Error('Unsupported notebook action.');
    const input=JSON.parse(options.body||'{}'),now=new Date().toISOString();
    if(entry&&input.revision!==entry.revision)throw new Error('This experiment changed. Reopen it before saving.');
    if(match[2]==='notes') {
      entry.notes.push({id:id(),kind:['observation','decision','next-step'].includes(input.kind)?input.kind:'observation',text:text(input.text,'Note'),created:now});
      entry.revision++;entry.updated=now;
    } else {
      if(match[2])throw new Error('Reports are read-only.');
      const values={title:text(input.title,'Name',120),hypothesis:text(input.hypothesis,'Question'),successCriteria:text(input.successCriteria,'Criteria'),group:String(input.group||'').slice(0,120),status:['planned','active','reviewed'].includes(input.status)?input.status:'planned',links:(Array.isArray(input.links)?input.links:[]).filter(link=>link!==entry?.id&&entries.some(e=>e.id===link)),updated:now};
      if(entry){entry.history.push({revision:entry.revision,title:entry.title,status:entry.status,updated:entry.updated});Object.assign(entry,values,{revision:entry.revision+1});}
      else entries.unshift({...values,id:id(),revision:1,created:now,notes:[],history:[],sessions:[],sessionCount:0});
    }
    storage.setItem(key,JSON.stringify(entries));
    return entry||entries[0];
  };
}

export function mountHostedWorkspace(api,report) {
  const $=id=>document.getElementById(id);
  document.body.classList.add('hosted-preview');
  document.querySelector('.local-badge').textContent='Phone preview';
  const notice=document.createElement('aside');notice.className='hosted-notice';
  notice.innerHTML='<strong>Your studio, on your phone.</strong><p>Explore the interface, plan experiments, and preview this device’s camera. Notes stay in this browser. Your desktop cameras, recordings, and 3D processing are not connected yet.</p>';
  document.querySelector('.rig-main').prepend(notice);
  $('capture-path').replaceChildren(new Option('This device’s camera','direct'));$('capture-path').value='direct';
  const connection=$('capture-path').closest('p');for(const n of [...connection.childNodes])if(n.nodeType===Node.TEXT_NODE)n.textContent='';
  connection.append(document.createTextNode(' Preview stays on this device. No images are uploaded.'));
  $('auto-connect').checked=false;
  $('live-scene-start').disabled=true;$('rig-locate').disabled=true;
  $('live-scene-state').textContent='Live 3D needs the desktop GPU engine, which is not connected to this preview.';
  $('rig-setup-state').textContent='Camera positioning needs the desktop engine. You can browse the setup workflow here.';
  $('draft-placeholder').querySelector('p').textContent='Available on the desktop. This phone preview has no GPU engine connection.';
  $('rig-save-status').textContent='Your desktop sessions have not been uploaded. Record and process them in the desktop app.';
  $('session-processing-settings').querySelector('summary').textContent='Processing settings · desktop required';
  document.addEventListener('click',async event=>{
    const link=event.target.closest?.('a');
    const match=link?.getAttribute('href')?.match(/^\/api\/lab\/experiments\/([\w-]+)\/report\.(json|md)$/);
    if(!match)return;event.preventDefault();
    try{const data=await api(`/api/lab/experiments/${match[1]}/report.json`),e=data.experiment;
      const contents=match[2]==='json'?JSON.stringify(data,null,2):`# ${e.title}\n\nBrowser preview notebook — not synced to desktop.\n\n${e.hypothesis}\n\nSuccess criteria: ${e.successCriteria}\n\n${e.notes.map(n=>`## ${n.kind}\n\n${n.text}`).join('\n\n')}`;
      const url=URL.createObjectURL(new Blob([contents],{type:match[2]==='json'?'application/json':'text/markdown'}));
      const download=document.createElement('a');download.href=url;download.download=`experiment-${e.id}.${match[2]}`;download.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
    }catch(error){report(error);}
  });
}
