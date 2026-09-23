import {showLabTab} from './lab-ui.js';
const $=id=>document.getElementById(id);
const make=(tag,html='',cls='')=>{const el=document.createElement(tag);el.innerHTML=html;el.className=cls;return el;};
const details=(title,...nodes)=>{const el=make('details',`<summary>${title}</summary>`,'studio-details');el.append(...nodes);return el;};

// Keep the capture/reconstruction engines and their controls, but give them one
// session lifecycle. Reparenting preserves listeners and live video elements.
export function sessionWorkspace({lab,reconstruction,liveScene,isBusy,report}){
 const registry=new Map([...document.querySelectorAll('[id]')].map(el=>[el.id,el]));
 const $=id=>document.getElementById(id)||registry.get(id);
 document.body.classList.add('studio');
 const capture=document.querySelector('[data-lab-panel="capture"]');
 const oldHeading=capture.querySelector('.section-heading'),context=capture.querySelector('.session-context');
 const checklist=$('ready-count').closest('.control-card'),toolbar=capture.querySelector('.rig-toolbar');
 const connection=$('capture-path').closest('p'),quality=$('require-capture-quality').closest('label');
 const heading=make('div','<div><p class="eyebrow">YOUR SPATIAL WORKSPACE</p><h1 id="session-heading">New session</h1><p id="session-subtitle">Link an experiment. Capture a moment. Step inside it.</p></div><button id="session-reset" class="secondary">+ New session</button>','section-heading session-heading');
 const steps=make('ol',['Set up','Capture','Process','Replay'].map((s,i)=>`<li data-session-step="${i}"><span>${i+1}</span>${s}</li>`).join(''),'session-steps');
 const setup=make('section','<div class="step-title"><span>01</span><div><h2>Set up your session</h2><p>Keep the question and the footage together.</p></div></div>','control-card session-setup');setup.id='session-setup';
 const fields=make('div','','session-fields');fields.append($('session-experiment').closest('label'),$('session-label').closest('label'));
 const change=$('session-change').closest('label');change.firstChild.textContent='Session context';$('session-change').placeholder='What are you testing or changing, and what will happen in this recording?';
 setup.append(fields,change,details('More context (optional)',$('session-procedure').closest('label'),$('session-conditions').closest('label')));
 const setupActions=make('div','<button id="session-continue">Continue to cameras →</button>','session-actions');setupActions.append($('session-new-experiment'));setup.append(setupActions,$('session-context-status'));setup.classList.add('session-context');context.remove();
 const summary=make('div','<span id="session-context-summary"></span><button id="session-edit" class="quiet">Edit context</button>','session-summary');summary.id='session-summary';summary.hidden=true;
 const preview=make('section','','session-preview');preview.id='session-preview';
 const cameraSide=make('section','<div class="preview-heading"><div><p class="eyebrow">LIVE INPUT</p><h2>Cameras</h2></div></div>','camera-side');
 const cameraActions=make('div','','camera-actions');cameraActions.append($('connect-rig'),$('add-camera'));$('connect-rig').textContent='Connect cameras';cameraSide.querySelector('.preview-heading').append(cameraActions);
 const settings=details('Camera settings & connection',toolbar,quality,connection);settings.id='session-camera-settings';
 toolbar.prepend($('auto-connect').closest('label'));cameraSide.append($('device-status'),$('camera-grid'),settings,details('Capture checklist',checklist));
 const draft=$('live-scene');preview.append(cameraSide,draft);
 draft.querySelector('.eyebrow').textContent='LIVE PREVIEW';draft.querySelector('.splat-count-policy').remove();draft.querySelector('.section-heading p:last-child').textContent='An approximate 3D preview. The saved replay is optimized after recording.';
 const idle=make('div','<span>◇</span><strong>Your live 3D draft</strong><p>Start the draft to explore the scene before recording.</p>','draft-placeholder');idle.id='draft-placeholder';draft.insertBefore(idle,$('live-scene-view'));
 new MutationObserver(()=>{idle.hidden=!$('live-scene-view').hidden;}).observe($('live-scene-view'),{attributes:true,attributeFilter:['hidden']});
 const dock=make('section','<div><strong id="session-record-state">Ready when you are</strong><p id="session-record-hint">Live previews are not recorded.</p></div><div class="session-record-actions"></div>','session-dock');dock.id='session-dock';dock.querySelector('.session-record-actions').append($('sync-cue'),$('record-rig'));
 const render=make('div','<label>Replay quality<select id="session-quality"><option value="quick">Quick</option><option value="detailed">Detailed</option><option value="maximum">Maximum</option></select></label><label>Splat budget<select id="session-splat-mode"><option value="all">All available · no cap</option><option value="custom">Choose a maximum</option></select></label><label id="session-splat-custom" hidden>Maximum splats<input id="session-splat-limit" type="number" min="1" step="1" value="200000"></label><p>Quality sets optimization time and replay detail. A splat budget reduces the points used; it does not create extra geometry.</p>','session-render-options');render.id='session-render-options';
 const renderDetails=details('Processing settings',render);renderDetails.id='session-processing-settings';
 oldHeading.remove();capture.replaceChildren(heading,steps,$('simulated-banner'),setup,summary,preview,renderDetails,dock);
 const reconstructionPanel=$('reconstruction');capture.append(reconstructionPanel);
 // One replay surface, with controls near the scene. Research diagnostics stay
 // available without taking over the primary recording/playback workflow.
 const buildDetails=details('Build settings & previous versions');buildDetails.id='session-build-settings';
 for(const child of [...reconstructionPanel.children])if(child.id!=='combined-result'&&!['reconstruction-title','reconstruction-progress','reconstruction-status','reconstruction-start','reconstruction-cancel'].includes(child.id))buildDetails.append(child);
 reconstructionPanel.insertBefore(buildDetails,$('reconstruction-progress'));
 const processingActions=make('div','','session-actions');processingActions.append($('reconstruction-start'),$('reconstruction-cancel'));reconstructionPanel.insertBefore(processingActions,buildDetails);
 $('reconstruction-title').textContent='Processing';$('reconstruction-start').textContent='Process replay';
 const splats=make('label','Maximum splats <input id="reconstruction-splat-limit" type="number" min="0" step="1" value="0"><small>0 keeps all available geometry. No fixed application cap.</small>');buildDetails.prepend(splats);
 const result=$('combined-result');result.querySelector('h2').textContent='Explore your replay';
 for(const [id,title,description] of [['gaussians','Splats','Optimized appearance'],['model','Geometry','Shape before optimization'],['scape','Room layout','Simple surfaces']])$('combined-mode-'+id).innerHTML=`${title}<span>${description}</span>`;
 const evidence=details('Quality, measurements & downloads',$('combined-evidence'),$('reconstruction-score'),$('combined-limitations'),$('combined-download'),$('combined-manifest'));evidence.id='session-evidence';result.append(evidence);
 for(const child of [...result.childNodes])if(child.nodeType===Node.TEXT_NODE&&child.textContent.trim()==='·')child.remove();
 const stage=$('combined-stage');const geometry=details('Model tools & exports',stage.querySelector('.geometry-bar'),$('combined-geometry-status'));stage.insertBefore(geometry,$('combined-canvas'));
 const playback=stage.querySelector('.combined-playback'),controls=playback.querySelector('.combined-controls');
 const views=details('Camera viewpoints',$('combined-camera-a'),$('combined-camera-b'),$('combined-extra-cameras'));playback.append(views);
 const density=make('label','Visible splats <input id="combined-density" type="range" min="1" max="100" value="100"><output id="combined-density-value">100%</output>','viewer-density');stage.querySelector('.navigation-bar').append(density);
 controls.querySelector('#combined-play').textContent='Play';
 $('combined-show-score').addEventListener('click',()=>{evidence.open=true;});
 // Reduce navigation to the three daily destinations. Tools are secondary.
 for(const key of ['overview','reconstruct'])document.querySelector(`[data-lab-tab="${key}"]`).hidden=true;
 const nav=document.querySelector('.lab-sidebar nav');
 const sessionNav=document.querySelector('[data-lab-tab="capture"]');sessionNav.innerHTML='Session';
 document.querySelector('[data-lab-tab="library"]').innerHTML='Library';document.querySelector('[data-lab-tab="experiments"]').innerHTML='Experiments';
 nav.prepend(sessionNav);const toolNav=details('Tools',document.querySelector('[data-lab-tab="setup"]'),document.querySelector('[data-lab-tab="research"]'));nav.append(toolNav);
 document.querySelector('.prototype').textContent='STUDIO';
 document.querySelector('.lab-version').textContent='SESSION WORKSPACE';
 document.querySelector('.header-right a').hidden=true;
 let phase='setup',savedTake=null;
 function setPhase(next){phase=next;capture.dataset.phase=next;const index=['setup','capture','process','replay'].indexOf(next);for(const el of steps.children){el.classList.toggle('current',Number(el.dataset.sessionStep)===index);el.classList.toggle('complete',Number(el.dataset.sessionStep)<index);el.setAttribute('aria-current',Number(el.dataset.sessionStep)===index?'step':'false');}setup.hidden=next!=='setup';summary.hidden=next==='setup';preview.hidden=!['setup','capture'].includes(next);dock.hidden=!['setup','capture'].includes(next);renderDetails.hidden=!['setup','capture'].includes(next);$('simulated-banner').hidden=savedTake?!savedTake.simulated:!new URLSearchParams(location.search).has('demo');if(next==='replay'){buildDetails.append(processingActions);$('reconstruction-start').textContent='Reprocess replay';}else{reconstructionPanel.insertBefore(processingActions,buildDetails);$('reconstruction-start').textContent='Process replay';}$('session-context-summary').textContent=savedTake?`${savedTake.context?.title||'Saved session'} · ${savedTake.name}`:($('session-experiment').selectedOptions[0]?.text||'')+' · '+($('session-label').value||'New session');window.dispatchEvent(new Event('resize'));}
 $('session-continue').onclick=()=>{if(!lab.ready()){report(new Error('Choose an experiment and add session context first.'));$('session-change').focus();return;}setPhase('capture');$('session-heading').textContent=$('session-label').value||'Capture session';preview.scrollIntoView({behavior:'smooth',block:'start'});};
 $('session-edit').onclick=()=>{if(!isBusy()&&!reconstruction.busy()){setPhase('setup');setup.scrollIntoView({behavior:'smooth'});}};
 $('session-splat-mode').onchange=()=>{$('session-splat-custom').hidden=$('session-splat-mode').value!=='custom';};
 function processingOptions(){const limit=$('session-splat-mode').value==='custom'?Number($('session-splat-limit').value):0;if(!Number.isSafeInteger(limit)||limit<0||($('session-splat-mode').value==='custom'&&limit===0))throw new Error('Enter a positive whole number for the splat budget, or choose All available.');return {profile:$('session-quality').value,maxGaussians:limit};}
 $('session-reset').onclick=async()=>{if(isBusy()||reconstruction.busy())return;await liveScene.stop().catch(report);savedTake=null;reconstruction.reset();lab.resetContext();$('review').hidden=true;$('session-heading').textContent='New session';$('session-subtitle').textContent='Link an experiment. Capture a moment. Step inside it.';setPhase('setup');showLabTab('capture');setup.scrollIntoView({behavior:'smooth',block:'start'});};
 document.addEventListener('reconstruction-state',e=>{const {state,take:chosen,error}=e.detail;if(chosen){savedTake=chosen;$('session-heading').textContent=chosen.name;}$('session-reset').disabled=state==='running'||isBusy();$('session-edit').disabled=state==='running'||isBusy();if(state==='selected'){setPhase('process');$('session-subtitle').textContent='Choose Process replay, or open a previous version.';}if(state==='running'){setPhase('process');$('session-subtitle').textContent='Your recordings are saved. Optimizing this session’s 3D replay…';}if(state==='complete'){setPhase('replay');$('session-subtitle').textContent='Scrub through time. Move through the scene.';}if(['failed','cancelled','interrupted'].includes(state)){setPhase('process');$('session-subtitle').textContent=error||'Processing stopped. Your original recordings are safe; adjust settings and retry.';}});
 setPhase('setup');showLabTab('capture');
 return {processingOptions,update({recording,saving,connected}){const busy=recording||saving;$('session-reset').disabled=busy||reconstruction.busy();$('session-edit').disabled=busy||reconstruction.busy();$('session-continue').disabled=busy;for(const el of render.querySelectorAll('input,select'))el.disabled=busy;$('record-rig').textContent=saving?'Saving…':recording?'End & process':'Start recording';$('session-record-state').textContent=saving?'Saving every angle…':recording?'Recording':`${connected} camera${connected===1?'':'s'} connected`;$('session-record-hint').textContent=recording?'End the session to save and build your replay.':!lab.ready()?'Choose an experiment and add session context.':'Live previews are not recorded until you start.';if(recording&&phase==='setup')setPhase('capture');},async saved(item,options){savedTake=item;setPhase('process');$('session-heading').textContent=item.name;await liveScene.stop();await reconstruction.select(item);if(item.cameras.length<2){$('session-subtitle').textContent='Saved. Combined 3D needs at least two cameras; original video is available in Library.';return;}await reconstruction.start({profile:options.profile,maxGaussians:options.maxGaussians,mode:'sequence'});}};
}

export function compactCamera(c){
 const tile=c.tile,heading=tile.querySelector('.camera-heading');
 const advanced=details('Settings & diagnostics',tile.querySelector('.camera-profile'),tile.querySelector('.camera-settings'));
 advanced.classList.add('camera-advanced');
 const device=heading.querySelector('select'),deviceLabel=make('label','Device');deviceLabel.append(device);advanced.insertBefore(deviceLabel,advanced.children[1]);
 const order=heading.querySelector('.camera-order'),remove=heading.querySelector('.remove-camera');advanced.append(order,remove);
 const diagnostic=tile.querySelector('.camera-diagnostics');if(diagnostic)advanced.append(diagnostic);
 tile.append(advanced);
}
