import path from 'node:path';
import {promises as fs} from 'node:fs';
import {spawn} from 'node:child_process';

// Project acceptance criteria, not a universal measure of perceptual realism.
export const criteria = Object.freeze({minimumSeconds:10, minimumFpsRatio:0.98,
  maximumGapFrames:2, minimumObservedSpanRatio:0.95, minimumObservationRatio:0.98});

export function summarizeFrames(times, targetFps) {
  if (!Array.isArray(times) || times.length < 2 || !times.every(Number.isFinite) || !(targetFps > 0)) return null;
  const gaps=times.slice(1).map((t,i)=>t-times[i]), duration=times.at(-1)-times[0];
  if(duration<=0)return null;
  return {frames:times.length, durationSeconds:duration, effectiveFps:(times.length-1)/duration,
    maxGapMs:gaps.reduce((a,b)=>Math.max(a,b),0)*1000,
    nonIncreasingIntervals:gaps.filter(g=>g<=0).length,
    targetFps, maxAllowedGapMs:criteria.maximumGapFrames/targetFps*1000};
}

function probeFrames(file) {
  return new Promise((resolve,reject)=>{
    const child=spawn(process.env.FFPROBE||'ffprobe',['-v','error','-select_streams','v:0',
      '-show_entries','frame=best_effort_timestamp_time','-of','csv=p=0',file],{windowsHide:true});
    let output='',error='';
    const timer=setTimeout(()=>{child.kill();reject(new Error('Frame inspection timed out'));},60000);
    child.stdout.on('data',d=>{output+=d;if(output.length>32*1024*1024){child.kill();reject(new Error('Take too long for frame audit'));}});
    child.stderr.on('data',d=>{error=(error+d).slice(-2000);});
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.on('close',code=>{clearTimeout(timer);code===0?
      resolve(output.trim().split(/\r?\n/).filter(Boolean).map(Number)):
      reject(new Error(error||'Recorded video cannot be decoded'));});
  });
}

export function gradeRig(rig, cameras) {
  const complete=cameras.length===rig.cameras.length && cameras.length>0 &&
    cameras.every(c=>c.saved && c.encoded);
  const reliable=complete && cameras.every(c=>!c.error && c.encoded.nonIncreasingIntervals===0 && c.encoded.durationSeconds>=criteria.minimumSeconds &&
    c.encoded.effectiveFps>=c.targetFps*criteria.minimumFpsRatio &&
    c.encoded.maxGapMs<=c.encoded.maxAllowedGapMs+1.1 && c.observed &&
    c.observed.nonIncreasingIntervals===0 && c.observed.durationSeconds/c.encoded.durationSeconds>=criteria.minimumObservedSpanRatio &&
    c.observed.frames/c.encoded.frames>=criteria.minimumObservationRatio && !c.timingRecovered);
  const gate=(id,name,status,evidence,next)=>({id,name,status,evidence,next});
  const gates=[
    gate('capture','Playable original videos',complete?'pass':'fail',
      `${cameras.filter(c=>c.saved&&c.encoded).length} / ${rig.cameras.length} videos have readable frame timestamps.`,
      'Save every angle. An interrupted or undecodable stream fails this gate.'),
    gate('cadence','Capture timing and continuity',reliable?'pass':complete?'fail':'unverified',
      `Measured from saved video timestamps and browser frame observations; these are not exposure times. ${cameras.reduce((n,c)=>n+(c.encoded?.nonIncreasingIntervals||0),0)} duplicate or backward encoded timestamp intervals.`,
      'Record ≥10 seconds. Every angle needs strictly increasing timestamps, ≥98% of requested FPS, no gap >2 frame periods, ≥98% observations, and ≥95% observed time span.'),
    gate('sync','Cross-camera exposure alignment','unverified',
      'Start requests and cue-button clicks do not measure sensor exposure offsets or clock drift.',
      'Measure a shared visible flash near the beginning and end; validate residual alignment ≤5 ms for moving scenes.'),
    gate('calibration','Camera calibration','fail',
      'This take has no independently validated lens calibration. Estimated reconstruction poses do not pass this measurement gate.',
      'Calibrate fixed cameras with a shared target; aim for ≤0.5 px reprojection RMS on independently captured validation frames.'),
    gate('geometry','Shared 3D reconstruction','fail',
      'Combined Gaussian reconstruction is available separately, but this take has no surveyed scale or independently validated geometry and coverage.',
      'Build calibrated multi-view reconstruction; validate surveyed dimensions and surface coverage throughout the intended roaming volume.'),
    gate('holdout','Unseen-view image fidelity','unverified',
      'There are no withheld reference views of a fused reconstruction. Matching the source camera cannot validate 3D.',
      'Reserve independent camera positions/times. Initial R&D targets: PSNR ≥40 dB, SSIM ≥0.99 and LPIPS ≤0.02 at target resolution, with no excluded difficult regions.'),
    gate('motion','Moving-scene stability','unverified',
      'No ground-truth test of novel-view motion, disocclusions, holes or flicker exists yet.',
      'Evaluate held-out video across slow walks, turning, crossed limbs and occlusions; publish worst-view and worst-time errors, including all missing pixels.'),
    gate('perception','Blind realism evaluation','unverified',
      'A finite image score cannot certify perfect reality across arbitrary viewpoints.',
      'Run a preregistered, blinded real-vs-rendered comparison with confidence intervals across the intended viewing conditions.')
  ];
  return {version:1,rigId:rig.id,generatedAt:new Date().toISOString(),simulated:!!rig.simulated,
    verdict:rig.simulated?'SOFTWARE TEST ONLY':'TARGET NOT MET',realismScore:null,
    verifiedGates:gates.filter(g=>g.status==='pass').length,totalGates:gates.length,
    criteria,cameras,gates,
    scope:'Gate counts measure verified engineering checks, not a percentage of realism. Thresholds are provisional R&D targets. Simulated data cannot validate physical reconstruction.',
    nextExperiment:'Keep both cameras fixed with overlapping views of the same movement area. Capture 10–20 seconds: stand still, walk slowly, turn, then stop. Show a visible sync cue at both ends. Keep part of the scene reserved for independent validation; two input cameras leave no third camera for simultaneous held-out validation.'};
}

export async function auditRig(rig, store) {
  const cameras=[];
  // Inspect sequentially: adding cameras must not launch unbounded ffprobe processes.
  for(const c of rig.cameras) {
    const targetFps=c.requested?.frameRate||c.settings.frameRate;
    const info={slot:c.slot,label:c.label,targetFps,settings:c.settings,
      saved:c.recording.status==='saved',timingRecovered:!!c.timingRecovered,encoded:null,observed:null,error:null};
    try {
      if(!info.saved) throw new Error('Save or recover this camera before assessment');
      info.encoded=summarizeFrames(await probeFrames(path.join(store,c.sessionId,'recording.webm')),targetFps);
      if(!info.encoded) throw new Error('Too few usable frames or invalid video duration/timestamps');
      const samples=[];
      for(let i=0;i<c.timingChunks;i++) {
        const chunk=JSON.parse(await fs.readFile(path.join(store,c.sessionId,'timing',`${i}.json`),'utf8'));
        for(const sample of chunk)samples.push(sample[0]/1000);
      }
      info.observed=summarizeFrames(samples,targetFps);
    }catch(e){info.error=e.message;}
    cameras.push(info);
  }
  return gradeRig(rig,cameras);
}
