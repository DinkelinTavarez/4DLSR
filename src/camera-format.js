// Common presets are shortcuts. Every camera can use its own native dimensions
// and fractional FPS; the capture engine verifies the selected combination.
export function cameraFormat(c,{saved,defaults,onApply,onChange}){
 const panel=c.tile.querySelector('.camera-profile'),id=c.slot;
 panel.innerHTML=`<label class="capture-mode-label">Mode<select id="capture-mode-${id}"><option value="custom">Custom · exact settings</option><option value="camera-default">Camera default · device chooses</option></select></label><label>Width<input id="width-${id}" type="number" min="1" step="1" inputmode="numeric"></label><label>Height<input id="height-${id}" type="number" min="1" step="1" inputmode="numeric"></label><label>FPS<input id="framerate-${id}" type="number" min="0" step="any" list="fps-suggestions-${id}"><datalist id="fps-suggestions-${id}">${[.5,1,5,10,15,23.976,24,25,29.97,30,50,59.94,60,90,120,144,240].map(v=>`<option value="${v}"></option>`).join('')}</datalist></label><button class="secondary apply-camera" id="apply-${id}">Apply</button><p class="camera-capabilities" id="capabilities-${id}">Any native width, height and positive FPS can be requested. Connect to read this camera’s reported ranges.</p>`;
 const find=name=>panel.querySelector(`#${name}-${id}`),fields=['width','height','framerate'];let busy=false;
 function controls(){find('capture-mode').disabled=busy;for(const name of fields)find(name).disabled=busy||find('capture-mode').value==='camera-default';find('apply').disabled=busy;}
 function selection(){return {captureMode:find('capture-mode').value,width:Number(find('width').value),height:Number(find('height').value),frameRate:Number(find('framerate').value)};}
 function set(value){find('capture-mode').value=value.captureMode||'custom';find('width').value=value.width;find('height').value=value.height;find('framerate').value=value.frameRate;controls();}
 for(const name of ['capture-mode',...fields])find(name).onchange=()=>{controls();onChange();};
 find('apply').onclick=onApply;
 set({width:saved.width||defaults[0],height:saved.height||defaults[1],frameRate:saved.frameRate||defaults[2],captureMode:saved.captureMode||'custom'});
 function capabilities(caps){
  const format=v=>Number.isFinite(v)?String(Number(v.toFixed(3))):'?';
  const ranges=[['width',caps?.width],['height',caps?.height],['FPS',caps?.frameRate]].filter(([,r])=>r&&Number.isFinite(r.max)).map(([name,r])=>`${name} ${format(r.min)}–${format(r.max)}`);
  find('capabilities').textContent=ranges.length?`Camera reports: ${ranges.join(' · ')}. Not every combination works; Apply verifies it.`:'This camera does not report ranges. Enter its documented mode, or select Camera default.';
 }
 return {selection,set,capabilities,setBusy(value){busy=value;controls();}};
}
