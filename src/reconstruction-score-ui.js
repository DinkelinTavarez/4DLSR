export function reconstructionScoreUI({api,post,report}){
 const $=id=>document.getElementById(id),root=$('reconstruction-score');let job=null,generation=0,timer;
 const node=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
 function draw(data){
  const s=data.summary;root.replaceChildren(node('h3',`Source fidelity: ${s.sourceViewScore.toFixed(1)} / 100 · worst frame / camera`),node('p',s.verdict),node('p','This is a conservative comparison with the recorded camera images, not a percentage of 3D realism. Hidden geometry and unseen viewpoints remain unverified.'));
  const table=node('table'),heading=node('tr');for(const label of ['Time','Camera','Score','PSNR ↑','SSIM ↑','Coverage ↑','Bad pixels ↓','Edges ↑'])heading.append(node('th',label));table.append(heading);
  const rows=data.frames.flatMap(f=>f.views.map(v=>({...v,time:f.time}))).sort((a,b)=>a.sourceViewScore-b.sourceViewScore);
  for(const v of rows.slice(0,6)){const row=node('tr');for(const text of [v.time.toFixed(2)+' s',String((v.slot??v.camera)+1),v.sourceViewScore.toFixed(1),v.psnr.toFixed(2)+' dB',v.ssim.toFixed(3),(v.coverage*100).toFixed(1)+'%',(v.badPixelFraction*100).toFixed(1)+'%',v.edgeF1.toFixed(3)])row.append(node('td',text));table.append(row);}
  const wrap=node('div');wrap.className='quality-table';wrap.append(table);root.append(wrap,node('p',`${s.framesCompared} reconstructed time samples / ${s.viewsCompared} source-view comparisons. Median score ${s.medianSourceViewScore.toFixed(1)}. Weakest six comparisons shown.`));
  const detail=node('details'),summary=node('summary','Scoring rules and missing evidence');detail.append(summary,node('p',data.formula),node('p','Pass thresholds: PSNR ≥ 35 dB; SSIM ≥ 0.97; coverage ≥ 98%; bad pixels ≤ 2%; edge F1 ≥ 0.95. All source views must pass.'));
  detail.append(node('p',`${data.method} ${data.badPixelDefinition}`),node('p','3D geometry accuracy: unmeasured. Held-out camera accuracy: unmeasured. Continuous 4D motion accuracy: unmeasured. No overall realism grade issued.'));root.append(detail);
  const samples=data.frames.flatMap(f=>f.views.filter(v=>v.comparisonFile).map(v=>({...v,time:f.time}))),label=node('label','Visual comparison '),select=node('select'),image=node('img');image.className='reconstruction-comparison';image.alt='Original camera, rendered exported Gaussians, and amplified error side by side';
  for(const sample of samples)select.add(new Option(`${sample.time.toFixed(2)} s · Camera ${(sample.slot??sample.camera)+1}`,sample.comparisonFile));
  if(samples.length){const currentJob=job;const update=()=>image.src=`/api/reconstructions/${currentJob}/${select.value}`;select.onchange=update;update();label.append(select);root.append(label,image);}
  const download=node('a','Download full score report');download.href=`/api/reconstructions/${job}/evaluation.json`;download.download='evaluation.json';root.append(download);
  const again=node('button','Re-run source comparison');again.onclick=()=>start().catch(report);root.append(again);
 }
 async function load(id){job=id;const request=++generation;clearTimeout(timer);root.replaceChildren(node('p','Loading source comparison…'));try{
  const response=await fetch(`/api/reconstructions/${id}/evaluation.json`);if(request!==generation)return;
  if(response.ok){const data=await response.json();if(request===generation)draw(data);return;}
  if(response.status!==404)throw new Error('Source comparison report could not be loaded');
  const status=await api(`/api/reconstructions/${id}/evaluation-status.json`);if(request!==generation)return;
  if(status.state==='running'){poll(request);return;}
  root.replaceChildren(node('h3','Source fidelity: not scored'),node('p','Compare every exported time sample against all selected original camera recordings. Missing evidence does not receive a passing grade.'));
  const button=node('button','Score against original cameras');button.onclick=()=>start().catch(report);root.append(button);
 }catch(error){if(request===generation){root.replaceChildren(node('p',error.message));report(error);}}}
 async function poll(request){if(request!==generation)return;try{const state=await api(`/api/reconstructions/${job}/evaluation-status.json`);if(request!==generation)return;
  if(state.state==='running'){root.replaceChildren(node('p',`${Math.round((state.progress||0)*100)}% · ${state.stage||'Comparing original cameras'}`));timer=setTimeout(()=>poll(request),1200);}
  else if(state.state==='complete'){await load(job);document.dispatchEvent(new Event('experiment-library-changed'));}
  else{root.replaceChildren(node('p',state.error||'Comparison stopped without a score'));const retry=node('button','Retry source comparison');retry.onclick=()=>start().catch(report);root.append(retry);}
 }catch(error){if(request===generation){root.replaceChildren(node('p',error.message));report(error);}}}
 async function start(){if(!job)return;const id=job,request=generation;await post(`/api/reconstructions/${id}/evaluate`,{});if(request!==generation)return;root.replaceChildren(node('p','Starting source comparison…'));poll(request);}
 return {load};
}
