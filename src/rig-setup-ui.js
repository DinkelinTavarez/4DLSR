import {rigLayout} from './rig-geometry.js';
import {RigViewer,rigColors} from './rig-viewer.js';
import {captureStallMs} from './capture-policy.js';
import {showLabTab} from './lab-ui.js';
const $=id=>document.getElementById(id);
const element=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
const advancing=c=>c.stream&&c.video.readyState>=2&&c.video.videoWidth>0&&performance.now()-(c.lastFrame||0)<captureStallMs(c.requested?.frameRate);
const assigned=c=>!!$(`camera-${c.slot}`)?.value;
const signature=cameras=>JSON.stringify(cameras.filter(assigned).map(c=>[c.slot,$(`camera-${c.slot}`).value,c.stream?.id,c.stream?.getVideoTracks()[0]?.id,c.video.videoWidth,c.video.videoHeight]));

function capture(cameras){
 const selected=cameras.filter(assigned),active=selected.filter(advancing);
 if(selected.length<2||selected.length>8)throw new Error('Choose 2–8 cameras for rig positioning in Live capture.');
 if(active.length!==selected.length)throw new Error('Every assigned camera needs an advancing preview. Connect the missing cameras or unassign their slots in Live capture.');
 if(new Set(active.map(c=>c.deviceId)).size!==active.length)throw new Error('Assign a different device to each camera slot.');
 const height=Math.min(...active.map(c=>Math.round(c.video.videoHeight*640/c.video.videoWidth)));
 const started=performance.now(),capturedAt=new Date().toISOString(),key=signature(cameras);
 const frames=active.map(c=>{
  const canvas=document.createElement('canvas');canvas.width=640;canvas.height=height;
  const sourceHeight=height*c.video.videoWidth/640;
  canvas.getContext('2d').drawImage(c.video,0,(c.video.videoHeight-sourceHeight)/2,c.video.videoWidth,sourceHeight,0,0,640,height);
  return {slot:c.slot,canvas,image:canvas.toDataURL('image/jpeg',.9),label:c.label,deviceLabel:c.deviceLabel,settings:{...c.settings},previewAgeMs:performance.now()-c.lastFrame};
 });
 return {frames,capturedAt,key,captureSpanMs:performance.now()-started};
}

export function rigSetupUI({cameras,liveScene,report,isRecording,simulated=false}){
 const nav=document.createElement('button');nav.className='nav-item';nav.dataset.labTab='setup';nav.innerHTML='<span>⌖</span>Rig setup';nav.onclick=()=>showLabTab('setup');document.querySelector('[data-lab-tab="capture"]').before(nav);
 const panel=document.createElement('section');panel.className='lab-panel';panel.dataset.labPanel='setup';panel.hidden=true;
 panel.innerHTML=`<div class="section-heading"><div><p class="eyebrow">POSITION → INSPECT → CAPTURE</p><h1>Find your cameras in space.</h1><p>Estimate the layout from overlapping live views before you record.</p></div><button id="rig-locate">Locate cameras</button></div>
 <div class="rig-setup-intro"><section class="control-card"><b>01 · Connect & overlap</b><p>Keep cameras fixed. Include shared, textured objects in neighboring views. Hold the scene still for the snapshot.</p><button class="secondary" id="rig-open-capture">Open live cameras ↗</button></section><section class="control-card"><b>02 · Estimate the layout</b><p>Jointly infer camera positions, lens geometry and scene points. Inspect the result; weak overlap can produce a wrong layout.</p></section><section class="control-card"><b>03 · Give it a scale</b><p>Measure one camera-to-camera distance. Add a level reference camera and its height if you want approximate floor alignment.</p></section></div>
 <section class="control-card"><div id="rig-setup-state" role="status">Connect at least two cameras in Live capture to begin. No recording is started.</div><p id="rig-setup-health"></p><p class="quiet-note">One snapshot per camera, processed locally. Camera exposures are not hardware synchronized. Any running live 3D draft stops while locating the rig.</p></section>
 <div id="rig-layout-result" hidden><section class="control-card"><div class="rig-view-toolbar"><div><p class="eyebrow">ESTIMATED GEOMETRY / NOT SURVEYED</p><h2>Your camera layout</h2></div><button class="secondary" id="rig-overview">3D overview</button><button class="secondary" id="rig-top">Look from above</button><button class="secondary" id="rig-moved">I moved a camera</button></div><canvas id="rig-layout-canvas" aria-label="Estimated camera positions, source image planes and scene points"></canvas><div class="rig-view-options"><label><input type="checkbox" id="rig-show-points" checked> Scene points</label><label><input type="checkbox" id="rig-show-images" checked> Source image planes</label><span>Drag to orbit · right-drag to pan · scroll to zoom</span></div><p id="rig-coordinate-note"></p><p id="rig-snapshot-time" class="quiet-note"></p></section>
 <div class="rig-setup-measurements"><section class="control-card"><p class="eyebrow">OPTIONAL / MEASURE WITH A TAPE</p><h2>Set a real-world scale</h2><div class="form-pair"><label>From camera<select id="rig-distance-from"></select></label><label>To camera<select id="rig-distance-to"></select></label></div><label>Lens-center distance, in meters<input id="rig-baseline" type="number" min="0.01" max="1000" step="any" placeholder="e.g. 2.4"></label><p class="quiet-note">Measure the straight-line distance between lens centers, including any height difference. This rescales the estimate; it does not correct bad camera poses.</p><button class="secondary" id="rig-apply-scale">Apply measurement</button> <button class="secondary" id="rig-clear-scale">Use relative units</button><p id="rig-scale-state" role="status">No measured scale.</p></section>
 <section class="control-card"><p class="eyebrow">OPTIONAL / MANUAL FLOOR REFERENCE</p><h2>Estimate heights above the floor</h2><label id="rig-level-label"><input type="checkbox" id="rig-reference-level"> Reference camera is level and upright</label><label>Reference lens height above floor, in meters<input id="rig-reference-height" type="number" min="0" max="1000" step="any" placeholder="e.g. 1.5"></label><p class="quiet-note">First apply a measured distance. Only check this if the reference camera points horizontally with no roll. Heights depend on this assumption; gravity and the floor are not automatically measured.</p><button class="secondary" id="rig-apply-floor">Apply floor reference</button><p id="rig-floor-state" role="status">Floor height unknown.</p></section></div>
 <section class="control-card"><h2>Positions & source views</h2><p id="rig-table-note"></p><div class="rig-table-scroll"><table><thead><tr><th>Camera</th><th>Right</th><th>Up</th><th>Forward</th><th>From reference</th><th>Floor height</th><th>Depth agreement</th></tr></thead><tbody id="rig-positions"></tbody></table></div><p class="quiet-note">Depth agreement = retained inferred points consistent with at least one other inferred depth map. It is not coverage, pose accuracy, or a realism score. Frustums show viewing directions, not proven visibility through objects.</p><div id="rig-source-images"></div></section>
 <section class="control-card"><div class="section-heading"><div><h2>Keep the setup with your experiment</h2><p>Export the estimated poses, measurements and source settings as JSON. Images remain in memory. Re-estimate after moving any camera.</p></div><button class="secondary" id="rig-export">Export layout report</button></div><p class="quiet-note">This is a setup diagnostic. Recording and reconstruction still estimate their own geometry; this report is not applied as a calibrated reconstruction constraint.</p></section></div>`;
 document.querySelector('[data-lab-panel="capture"]').before(panel);
 if(simulated){const demo=element('p','SIMULATED INPUT — for software testing only. This is not a physical camera calibration.');demo.className='rig-demo-notice';panel.prepend(demo);}
 const shortcut=element('button','Position cameras in 3D ↗');shortcut.className='secondary';shortcut.onclick=()=>showLabTab('setup');document.querySelector('[data-lab-panel="capture"] .section-heading').append(shortcut);
 if(sessionStorage.getItem('spatial-lab-tab')==='setup')showLabTab('setup');
 let snapshot=null,result=null,layout=null,viewer=null,measures={},stale=false,busy=false;
 function state(message){$('rig-setup-state').textContent=message;}
 function invalidate(message){if(!result)return;stale=true;state(message);$('rig-layout-result').classList.add('rig-stale');$('rig-export').disabled=true;}
 function showLayout(){
  layout=rigLayout(result,measures);viewer||=new RigViewer($('rig-layout-canvas'));viewer.set(result,snapshot.frames,layout);visibility();
  $('rig-coordinate-note').textContent=layout.floorKnown?'Floor grid uses your measured scale and level-camera assumption. All camera poses remain estimates.':'Reference axes follow the first camera: right, up in its image, and forward. No floor plane is known. “Above” follows that camera’s up direction.';
  $('rig-table-note').textContent=`Positions relative to Camera ${result.cameraSlots[0]+1} · ${layout.units}. ${layout.floorKnown?'Floor heights are approximate.':'Up is not height above the floor.'}`;
  $('rig-scale-state').textContent=layout.units==='m'?`Scaled using Camera ${measures.baseline.from+1} → Camera ${measures.baseline.to+1}: ${measures.baseline.meters} m.`:'No measured scale. Relative units only.';
  $('rig-floor-state').textContent=layout.floorKnown?`Floor reference: Camera ${result.cameraSlots[0]+1} is assumed level at ${layout.referenceHeight} m.`:'Floor height unknown. Requires measured scale, a level reference camera and its height.';
  $('rig-positions').replaceChildren();
  layout.cameras.forEach((c,i)=>{
   const support=result.support?.support?.[i],agreement=support?.retained?`${(100*support.crossViewConsistent/support.retained).toFixed(0)}% of ${support.retained.toLocaleString()} points`:'Unavailable';
   const row=document.createElement('tr');for(const value of [`Camera ${c.slot+1}`,c.position[0].toFixed(2),c.position[1].toFixed(2),(-c.position[2]).toFixed(2),c.distanceFromReference.toFixed(2),c.height===null?'Unknown':`${c.height.toFixed(2)} m`,agreement])row.append(element('td',value));$('rig-positions').append(row);
  });
 }
 function visibility(){viewer?.visibility($('rig-show-points').checked,$('rig-show-images').checked);}
 function checkCurrent(){if(stale)throw new Error('This layout is stale. Locate cameras again before applying measurements or exporting.');}
 function action(fn){try{checkCurrent();fn();showLayout();state(`Estimated ${result.cameraSlots.length} camera positions · ${layout.units==='m'?'measured scale applied':'relative units'} · ${layout.floorKnown?'manual floor reference applied':'floor height unknown'}. Camera poses remain unverified.`);}catch(error){state(error.message);report(error);}}
 $('rig-locate').onclick=async()=>{
  if(busy)return;busy=true;$('rig-locate').disabled=true;
  try{
   if(isRecording())throw new Error('Finish the current recording before locating or moving cameras.');
   const next=capture(cameras());invalidate('Previous layout is stale while a new estimate is prepared.');state('Estimating camera positions and scene depth… Live previews continue; no recording is being saved.');
   const nextResult=await liveScene.snapshot(next.frames.map(({slot,image})=>({slot,image})));
   if(next.key!==signature(cameras())||cameras().filter(assigned).some(c=>!advancing(c)))throw new Error('The connected cameras changed or stopped during estimation. Reconnect and locate them again.');
   if(nextResult.cameraSlots.join(',')!==next.frames.map(f=>f.slot).join(','))throw new Error('The geometry result does not match the snapshot cameras.');
   rigLayout(nextResult);snapshot=next;result=nextResult;measures={};stale=false;
   $('rig-layout-result').hidden=false;$('rig-layout-result').classList.remove('rig-stale');$('rig-export').disabled=false;
   for(const id of ['rig-distance-from','rig-distance-to'])$(id).replaceChildren(...result.cameraSlots.map(slot=>new Option(`Camera ${slot+1}`,String(slot))));
   $('rig-distance-to').selectedIndex=1;$('rig-baseline').value='';$('rig-reference-height').value='';$('rig-reference-level').checked=false;
   $('rig-level-label').lastChild.textContent=` Camera ${result.cameraSlots[0]+1} is level and upright`;
   $('rig-snapshot-time').textContent=`Snapshot: ${new Date(snapshot.capturedAt).toLocaleString()} · ${result.processingSeconds.toFixed(1)} s processing · frozen images, not a live map. Manual movement is not detected automatically.`;
   $('rig-source-images').replaceChildren();snapshot.frames.forEach((f,i)=>{
    const card=document.createElement('article');card.className='rig-source-card';card.style.setProperty('--camera-color',rigColors[i%rigColors.length]);const img=new Image();img.src=f.image;img.alt=`Snapshot used to locate Camera ${f.slot+1}`;const button=element('button',`Inspect Camera ${f.slot+1}`);button.className='secondary';button.onclick=()=>{$('rig-show-images').checked=false;visibility();viewer.snap(i);$('rig-layout-canvas').scrollIntoView({block:'center',behavior:'smooth'});};card.append(img,button,element('small',f.deviceLabel||f.label));$('rig-source-images').append(card);
   });showLayout();state(`Estimated ${result.cameraSlots.length} camera positions. Compare the layout to the physical room before trusting it. Scale and floor height are not measured yet.`);
  }catch(error){state(`Could not locate cameras: ${error.message}`);report(error);}finally{busy=false;$('rig-locate').disabled=false;}
 };
 $('rig-apply-scale').onclick=()=>action(()=>{const next={...measures,baseline:{from:Number($('rig-distance-from').value),to:Number($('rig-distance-to').value),meters:Number($('rig-baseline').value)}};rigLayout(result,next);measures=next;});
 $('rig-clear-scale').onclick=()=>action(()=>{measures={};$('rig-baseline').value='';$('rig-reference-height').value='';$('rig-reference-level').checked=false;});
 $('rig-apply-floor').onclick=()=>action(()=>{
  const level=$('rig-reference-level').checked,value=$('rig-reference-height').value;
  if(level&&(!measures.baseline||value===''||!Number.isFinite(Number(value))||Number(value)<0||Number(value)>1000))throw new Error('Apply a measured scale and enter a valid reference height first.');
  measures={...measures,level,referenceHeight:level?Number(value):null};
 });
 $('rig-export').onclick=()=>{try{checkCurrent();const record={schemaVersion:1,kind:'estimated-rig-setup',simulated,capturedAt:snapshot.capturedAt,exportedAt:new Date().toISOString(),validation:'unverified against physical measurements except the entered baseline',calibration:result.calibration,layout,width:result.width,height:result.height,support:result.support,captureSpanMs:snapshot.captureSpanMs,exposureSynchronization:'unverified; capture span is browser draw time, not shutter skew',cameras:snapshot.frames.map(({slot,label,deviceLabel,settings,previewAgeMs})=>({slot,label,deviceLabel,settings,previewAgeMs})),notes:['Source images excluded; nothing is uploaded.','Camera moves are not automatically detected.','Scale and floor reference are user inputs, not lens or pose calibration.','Reconstruction does not consume this setup report.']};const url=URL.createObjectURL(new Blob([JSON.stringify(record,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`rig-layout-${snapshot.capturedAt.replace(/[:.]/g,'-')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){report(error);}};
 $('rig-open-capture').onclick=()=>showLabTab('capture');$('rig-overview').onclick=()=>viewer?.home();$('rig-top').onclick=()=>viewer?.home(true);$('rig-moved').onclick=()=>invalidate('A camera moved. This is the old layout; locate cameras again.');
 $('rig-show-points').onchange=visibility;$('rig-show-images').onchange=visibility;
 setInterval(()=>{const selected=cameras().filter(assigned),active=selected.filter(advancing);$('rig-setup-health').textContent=`${active.length} advancing / ${selected.length} assigned previews · 2–8 required for positioning.`;if(result&&!stale&&!busy&&(snapshot.key!==signature(cameras())||active.length!==selected.length))invalidate('Camera connections or image sizes changed. This layout is stale; locate cameras again.');},1000);
 return {invalidate};
}
