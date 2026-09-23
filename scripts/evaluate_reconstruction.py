"""Evaluate the actual exported/quantized splats, at every saved time and source camera."""
import json
import time
from pathlib import Path
import cv2
import numpy as np
from reconstruction_metrics import compare_images,summarize
from camera_geometry import camera_views,camera_offsets,crop_height


def evaluate(output, progress=lambda message,value:None):
    import torch
    from gsplat import rasterization
    from reconstruct import read_frame,write_json
    started=time.time();spec=json.loads((output/'spec.json').read_text(encoding='utf-8-sig'));manifest=json.loads((output/'manifest.json').read_text())
    if not torch.cuda.is_available():raise ValueError('CUDA is required to render exported splats for comparison')
    def tensor(x):return torch.tensor(x.copy() if isinstance(x,np.ndarray) else x,dtype=torch.float32,device='cuda')
    calibration=manifest['calibration'];views=tensor(camera_views(calibration));count=len(spec['cameras'])
    K=np.array(calibration['K']);ks=tensor(K if K.ndim==3 else np.stack([K]*count));w,h=manifest['width'],manifest['height']
    offsets=camera_offsets(spec)
    dtype=np.dtype([('position','<f4',3),('scale','<f4',3),('color','u1',4),('rotation','u1',4)])
    results=[];previous={};temporal=[];snapshots={0,len(manifest['frames'])//2,len(manifest['frames'])-1}
    with torch.no_grad():
        for index,frame in enumerate(manifest['frames']):
            progress(f'Comparing exported frame {index+1}/{len(manifest["frames"])} with all original cameras',index/len(manifest['frames']))
            raw=np.fromfile(output/frame['file'],dtype=dtype)
            if not len(raw):raise ValueError('Empty exported Gaussian file')
            means=tensor(raw['position']);scales=tensor(raw['scale']);quat=tensor((raw['rotation'].astype(np.float32)-128)/128);quat/=quat.norm(dim=1,keepdim=True).clamp_min(1e-8)
            colors=tensor(raw['color'][:,:3]/255);alpha=tensor(raw['color'][:,3]/255);row=dict(index=index,time=frame['time'],views=[])
            for camera in range(count):
                render,opacity,_=rasterization(means,quat,scales,alpha,colors,views[camera:camera+1],ks[camera:camera+1],w,h,packed=False,near_plane=.05,far_plane=100)
                predicted=render[0].clamp(0,1).cpu().numpy();coverage=opacity[0,:,:,0].cpu().numpy()
                reference=crop_height(read_frame(spec['cameras'][camera]['file'],frame['time']-offsets[camera],w),h)[:,:,::-1].astype(np.float32)/255
                metrics=compare_images(reference,predicted,coverage);metrics['camera']=camera;metrics['slot']=spec['cameras'][camera].get('slot',camera)
                if camera in previous:
                    last_ref,last_pred=previous[camera];temporal.append(float(np.mean(np.abs((predicted-last_pred)-(reference-last_ref)))))
                previous[camera]=(reference,predicted)
                if index in snapshots:
                    error=np.mean(np.abs(reference-predicted),axis=2);heat=cv2.applyColorMap(np.uint8(np.clip(error*4*255,0,255)),cv2.COLORMAP_INFERNO)
                    panels=[np.uint8(reference[:,:,::-1]*255),np.uint8(predicted[:,:,::-1]*255),heat]
                    for panel,label in zip(panels,['ORIGINAL CAMERA','EXPORTED GAUSSIANS','ERROR x4']):cv2.rectangle(panel,(0,0),(250,30),(15,20,25),-1);cv2.putText(panel,label,(8,21),cv2.FONT_HERSHEY_SIMPLEX,.55,(255,255,255),1,cv2.LINE_AA)
                    name=f'comparison-{index:05d}-{camera}.jpg';cv2.imwrite(str(output/name),np.concatenate(panels,axis=1));metrics['comparisonFile']=name
                row['views'].append(metrics)
            results.append(row)
    summary=summarize(results);summary['meanTemporalChangeError']=float(np.mean(temporal)) if temporal else None
    report=dict(version=1,scoringVersion='source-fidelity-v1',created=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
                scope='Training-camera RGB comparison of exported splats against recorded frames. Not held-out validation or a percent-realism score.',
                method='Full image, including uncovered pixels; inferred poses; approximate exposure timing; no fitted exposure correction.',
                formula='100 × min(clamp((PSNR−10)/30,0,1), SSIM, opacity coverage, 1−bad-pixel fraction, edge F1). Summary uses the worst frame/camera.',
                thresholds=dict(psnr=35,ssim=.97,coverage=.98,badPixelFraction=.02,edgeF1=.95),
                badPixelDefinition='Any RGB channel error > 0.10 on [0,1]. Edge matches allow 1 pixel. Temporal error compares inter-sample image changes, not tracked 3D motion.',
                summary=summary,frames=results,elapsedSeconds=time.time()-started)
    write_json(output/'evaluation.json',report);return report


if __name__=='__main__':
    import sys
    from reconstruct import write_json
    directory=Path(sys.argv[1])
    try:
        evaluate(directory,lambda message,value:write_json(directory/'evaluation-status.json',dict(state='running',stage=message,progress=value)))
        write_json(directory/'evaluation-status.json',dict(state='complete',progress=1))
    except Exception as error:
        write_json(directory/'evaluation-status.json',dict(state='failed',error=str(error)));raise
