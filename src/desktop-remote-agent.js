export function desktopRemoteAgent({post,cameras,getState,start,stop,prepare,report}) {
  const id=crypto.randomUUID();let ack=null,busy=false,deadline=0,ownedTake=null,stopped=false;
  const badge=document.createElement('span');badge.className='remote-agent-state';badge.textContent='Phone control connecting…';document.querySelector('.header-right').append(badge);
  async function execute(command){
    busy=true;
    try{
      if(command.action==='start'){
        await prepare(command);await start();
        const s=getState();if(!s.recording)throw new Error('Recording did not start. Check the desktop camera connection.');
        ownedTake=s.rigId;deadline=Date.now()+command.seconds*1000;
      }else{deadline=0;ownedTake=null;if(getState().recording)await stop();}
      ack={id:command.id};
    }catch(error){ack={id:command.id,error:error.message||String(error)};report(error);}
    finally{busy=false;}
  }
  async function tick(){
    if(stopped)return;
    try{
      const s=getState();
      if(!s.recording||s.rigId!==ownedTake){deadline=0;ownedTake=null;}
      if(deadline&&Date.now()>=deadline&&!busy){deadline=0;ownedTake=null;busy=true;stop().catch(report).finally(()=>busy=false);}
      const views=cameras().map(c=>{
        let image=null;
        if(c.stream&&c.video.readyState>=2&&c.video.videoWidth){const canvas=document.createElement('canvas');canvas.width=320;canvas.height=Math.round(320*c.video.videoHeight/c.video.videoWidth);canvas.getContext('2d').drawImage(c.video,0,0,canvas.width,canvas.height);image=canvas.toDataURL('image/jpeg',.6);}
        return {slot:c.slot,label:c.label,connected:!!c.stream,width:c.settings?.width,height:c.settings?.height,fps:c.deliveryHealth?.fps??c.observedFPS,requestedFps:c.requested?.frameRate,grade:c.deliveryHealth?.grade,image};
      });
      const sent=ack,result=await post('/api/remote/agent',{agentId:id,state:{...s,cameras:views},ack:sent,acceptCommands:!busy});if(ack===sent)ack=null;
      badge.textContent='Phone control ready · keep PC awake';
      if(result.command&&!busy)execute(result.command);
    }catch(error){badge.textContent='Phone control unavailable · retrying…';}
    if(!stopped)setTimeout(tick,1500);
  }
  tick();
}
