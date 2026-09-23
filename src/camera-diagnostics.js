export function cameraDiagnostics(c,report){
 const button=document.createElement('button');button.className='quiet';button.textContent='Check picture';button.disabled=true;
 const panel=document.createElement('details');panel.className='camera-diagnostics';panel.hidden=true;
 c.tile.querySelector('.camera-settings').append(button);c.tile.append(panel);
 let busy=false;
 button.onclick=async()=>{
  const bridge=c.bridge;if(!bridge||busy)return;busy=true;button.disabled=true;button.textContent='Checking…';
  try{
   const result=await bridge.inspect();if(c.bridge!==bridge)return;
   const canvas=document.createElement('canvas');canvas.width=c.video.videoWidth;canvas.height=c.video.videoHeight;
   if(!canvas.width||!canvas.height)throw new Error('Preview has no picture yet');
   canvas.getContext('2d').drawImage(c.video,0,0);
   const summary=document.createElement('summary');summary.textContent=`${c.label} · picture check`;
   const note=document.createElement('p');note.textContent='Temporary snapshots taken moments apart. If both show the same kind of tearing, it is already present before preview compression. These pictures are not saved.';
   const metrics=document.createElement('p'),value=n=>Number.isFinite(n)?n.toFixed(1):'unavailable';
   metrics.textContent=`Encoder input ${value(result.source.framesPerSecond)} FPS · encoded ${value(result.transport.framesPerSecond)} FPS · receiver ${value(result.received.framesPerSecond)} FPS. Codec: ${result.transport.codec||'unavailable'} (${result.transport.encoder||'unavailable'}). Transport limit: ${result.transport.qualityLimitationReason||'unavailable'}. Lost packets: ${result.received.packetsLost??'unavailable'} · dropped decoded frames: ${result.received.framesDropped??'unavailable'}.`;
   const images=document.createElement('div');images.className='diagnostic-images';
   for(const [label,src]of[['Before preview compression',result.image],['Received preview',canvas.toDataURL('image/jpeg',.92)]]){
    const figure=document.createElement('figure'),caption=document.createElement('figcaption'),image=document.createElement('img');caption.textContent=label;image.alt=`${c.label}: ${label}`;image.src=src;figure.append(caption,image);images.append(figure);
   }
   panel.replaceChildren(summary,note,metrics,images);panel.hidden=false;panel.open=true;
  }catch(e){report(e);}finally{busy=false;button.textContent='Check picture';button.disabled=!c.bridge;}
 };
 return {refresh:blocked=>{button.disabled=blocked||busy||!c.bridge;},clear:()=>{panel.replaceChildren();panel.hidden=true;}};
}
