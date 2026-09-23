// An authenticated local browser owns capture. Remote clients can request a
// bounded experiment, never arbitrary browser code, shell commands or paths.
export function remoteControl({body,json,fail,now=Date.now}) {
  let owner=null,seen=0,state={cameras:[],recording:false},current=null;
  const commands=new Map();
  const alive=()=>!!owner&&now()-seen<15000;
  const publicState=()=>({online:alive(),updated:seen,...state,command:current?commands.get(current):null});
  return async(req,res,url)=>{
    if(!url.pathname.startsWith('/api/remote/'))return false;
    if(req.method==='GET'&&url.pathname==='/api/remote/state'){json(res,publicState());return true;}
    if(req.method!=='POST')throw fail(405,'POST required');
    const input=JSON.parse((await body(req,1024*1024)).toString());
    if(url.pathname==='/api/remote/agent') {
      if(typeof input.agentId!=='string'||!/^[a-f0-9-]{36}$/.test(input.agentId))throw fail(400,'Invalid desktop agent');
      if(owner!==input.agentId&&alive())throw fail(409,'Another desktop tab owns phone control.');
      if(owner!==input.agentId&&current&&['queued','running'].includes(commands.get(current)?.status)){
        Object.assign(commands.get(current),{status:'failed',error:'Desktop agent changed. Inspect the saved recordings before retrying.'});
      }
      owner=input.agentId;seen=now();
      const s=input.state||{};
      if(!Array.isArray(s.cameras)||s.cameras.length>32)throw fail(400,'Invalid camera status');
      state={recording:s.recording===true,saving:s.saving===true,processing:s.processing===true,rigId:s.rigId||null,cameras:s.cameras.map(c=>({slot:c.slot,label:String(c.label||'Camera').slice(0,80),connected:c.connected===true,width:c.width,height:c.height,fps:c.fps,requestedFps:c.requestedFps,grade:c.grade,image:typeof c.image==='string'&&c.image.length<100000&&/^data:image\/jpeg;base64,/.test(c.image)?c.image:null})),message:String(s.message||'').slice(0,2000)};
      if(input.ack&&commands.has(input.ack.id)){
        const c=commands.get(input.ack.id);
        if(c.status==='running'&&c.agentId===owner){c.status=input.ack.error?'failed':'complete';c.error=String(input.ack.error||'').slice(0,3000);c.completed=now();}
      }
      const c=current?commands.get(current):null;
      if(c?.status==='queued'&&input.acceptCommands!==false){
        if(now()-c.created>15000){c.status='failed';c.error='Desktop did not receive the command in time. Nothing was started.';}
        else {c.status='running';c.agentId=owner;json(res,{command:c});return true;}
      }
      json(res,{command:null});return true;
    }
    if(url.pathname==='/api/remote/commands') {
      if(typeof input.id!=='string'||!/^[a-f0-9-]{36}$/.test(input.id))throw fail(400,'A unique command ID is required');
      if(commands.has(input.id)){json(res,commands.get(input.id));return true;}
      if(!alive())throw fail(503,'Desktop is offline. Keep the PC awake and the camera page open.');
      if(!['start','stop'].includes(input.action))throw fail(400,'Unsupported remote action');
      if(current&&['queued','running'].includes(commands.get(current)?.status))throw fail(409,'Wait for the current desktop command.');
      if(input.action==='start') {
        if(state.recording||state.saving||state.processing)throw fail(409,'The desktop is recording, saving or processing.');
        if(!Number.isFinite(input.seconds)||input.seconds<3||input.seconds>110)throw fail(400,'Choose a recording duration from 3 to 110 seconds.');
        if(!['quick','detailed','maximum'].includes(input.profile)||!Number.isSafeInteger(input.maxGaussians)||input.maxGaussians<0)throw fail(400,'Invalid processing settings');
        if(!input.context||typeof input.context.experimentId!=='string'||typeof input.context.whatChanged!=='string'||input.context.whatChanged.trim().length<5||input.context.whatChanged.length>4000)throw fail(400,'Choose an experiment and add session context.');
        if(typeof input.requireQuality!=='boolean')throw fail(400,'Choose whether capture must meet its FPS target.');
      }
      const c={id:input.id,action:input.action,status:'queued',created:now(),seconds:input.seconds,profile:input.profile,maxGaussians:input.maxGaussians,requireQuality:input.requireQuality,context:input.context};
      commands.set(c.id,c);current=c.id;
      while(commands.size>200)commands.delete(commands.keys().next().value);
      json(res,c,202);return true;
    }
    throw fail(404,'Unknown remote control route');
  };
}
