"""Multi-view reconstruction from stereo or jointly inferred multi-view geometry.

Geometry and calibration remain provisional. Optional local surface constraints
limit Gaussian thickness and drift; they cannot validate inferred depth.
"""
import argparse
import json
import math
import time
import subprocess
import shutil
from pathlib import Path
import cv2
import numpy as np
from scipy.spatial import cKDTree
from geometry_export import export_seed_ply, export_depth_glb
from splat_budget import apply_splat_budget
from camera_geometry import camera_offsets, profile_for_views, crop_height

PROFILES = {
    'quick': dict(width=640, fps=1, iterations=100, max_points=None),
    'detailed': dict(width=960, fps=2, iterations=400, max_points=None),
    'maximum': dict(width=1280, fps=4, iterations=1000, max_points=None),
}


def write_json(file, value):
    temp = file.with_suffix('.tmp')
    temp.write_text(json.dumps(value, indent=2, allow_nan=False), encoding='utf8')
    for attempt in range(8):
        try:
            temp.replace(file)
            break
        except PermissionError:
            # Windows readers may briefly hold the polled status file open.
            if attempt == 7:raise
            time.sleep(.025*(attempt+1))


def read_frame(filename, seconds, width):
    encoded=subprocess.run(['ffmpeg','-v','error','-ss',str(max(0,seconds)),'-i',str(filename),'-frames:v','1','-vf',f'scale={width}:-2','-f','image2pipe','-vcodec','png','pipe:1'],capture_output=True,timeout=30,check=True).stdout
    frame=cv2.imdecode(np.frombuffer(encoded,np.uint8),cv2.IMREAD_COLOR) if encoded else None
    if frame is None:
        raise ValueError(f'Cannot decode frame at {seconds:.3f} seconds')
    return cv2.resize(frame, (width, round(frame.shape[0] * width / frame.shape[1])))


def media_duration(filename, declared):
    """Use the decodable file duration; browser stop timing can be longer."""
    try:
        result=subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',str(filename)],capture_output=True,text=True,timeout=15,check=True)
        measured=float(result.stdout.strip())
        if math.isfinite(measured) and measured>0:return min(float(declared),measured)
    except (OSError,ValueError,subprocess.SubprocessError):pass
    return float(declared)


def intrinsics(width, height, hfov):
    focal = width / (2 * math.tan(math.radians(hfov) / 2))
    return np.array([[focal, 0, width/2], [0, focal, height/2], [0, 0, 1.]], np.float64)


def triangulate(a, b, K, R, t):
    p0 = K @ np.column_stack((np.eye(3), np.zeros(3)))
    p1 = K @ np.column_stack((R, t))
    h = cv2.triangulatePoints(p0, p1, a.T, b.T)
    xyz = (h[:3] / h[3:]).T
    other = xyz @ R.T + t.reshape(1, 3)
    qa = xyz @ K.T; qb = other @ K.T
    errors = np.maximum(np.linalg.norm(qa[:, :2]/qa[:, 2:]-a, axis=1), np.linalg.norm(qb[:, :2]/qb[:, 2:]-b, axis=1))
    center = -R.T @ t.reshape(3)
    rays0 = xyz / np.linalg.norm(xyz, axis=1, keepdims=True)
    rays1 = xyz-center; rays1 /= np.linalg.norm(rays1, axis=1, keepdims=True)
    angles = np.degrees(np.arccos(np.clip(np.sum(rays0*rays1, axis=1), -1, 1)))
    valid = np.isfinite(xyz).all(axis=1) & (xyz[:, 2] > .05) & (other[:, 2] > .05) & (errors < 2.5) & (angles > .4) & (np.linalg.norm(xyz, axis=1) < 100)
    return xyz, valid, errors, angles


def learned_matches(images):
    import torch
    from kornia.feature import LoFTR
    from kornia.feature.loftr.loftr import default_cfg
    from copy import deepcopy
    weights=Path(__file__).resolve().parent.parent/'public/reconstruction-models/loftr_outdoor.ckpt'
    config=deepcopy(default_cfg)
    matcher=LoFTR(pretrained=None,config=config).eval().cuda()
    matcher.load_state_dict(torch.load(weights,map_location='cpu',weights_only=True)['state_dict'])
    tensors=[];factors=[]
    for im in images:
        h,w=im.shape[:2];sw=min(640,w)//8*8;sh=round(h*sw/w)//8*8
        gray=cv2.resize(cv2.cvtColor(im,cv2.COLOR_BGR2GRAY),(sw,sh))
        tensors.append(torch.tensor(gray/255.,dtype=torch.float32,device='cuda')[None,None]);factors.append(np.array([w/sw,h/sh]))
    with torch.no_grad():out=matcher({'image0':tensors[0],'image1':tensors[1]})
    confidence=out['confidence'].cpu().numpy();valid=confidence>.5
    points=[out[f'keypoints{i}'].cpu().numpy()[valid]*factors[i] for i in range(2)]
    del matcher;torch.cuda.empty_cache()
    return points


def calibrate(images, hfov):
    a, b = images
    h, w = a.shape[:2]; K = intrinsics(w, h, hfov)
    sift = cv2.SIFT_create(nfeatures=14000, contrastThreshold=.015)
    ka, da = sift.detectAndCompute(cv2.cvtColor(a, cv2.COLOR_BGR2GRAY), None)
    kb, db = sift.detectAndCompute(cv2.cvtColor(b, cv2.COLOR_BGR2GRAY), None)
    if da is None or db is None:
        raise ValueError('Not enough visible texture to estimate camera positions.')
    matcher = cv2.BFMatcher()
    forward = [m for m,n in matcher.knnMatch(da, db, k=2) if m.distance < .72*n.distance]
    reverse = {(m.trainIdx, m.queryIdx) for m,n in matcher.knnMatch(db, da, k=2) if m.distance < .72*n.distance}
    matches = [m for m in forward if (m.queryIdx,m.trainIdx) in reverse]
    pa = np.float64([ka[m.queryIdx].pt for m in matches]); pb = np.float64([kb[m.trainIdx].pt for m in matches])
    matcher_name='SIFT'
    if len(matches)<100:
        pa,pb=learned_matches(images);matcher_name='LoFTR MegaDepth'
    if len(pa) < 60:
        raise ValueError(f'Only {len(pa)} shared features; need at least 60. Increase overlap and capture textured, stationary objects.')
    matched_count=len(pa)
    E, mask = cv2.findEssentialMat(pa, pb, K, method=cv2.RANSAC, prob=.999, threshold=1.5)
    if E is None or E.shape != (3,3):
        raise ValueError('No consistent stereo pose could be estimated.')
    _, R, t, pose_mask = cv2.recoverPose(E, pa, pb, K, mask=mask)
    good = pose_mask.ravel() > 0; pa=pa[good]; pb=pb[good]
    xyz, valid, errors, angles = triangulate(pa, pb, K, R, t)
    cells = np.unique(np.floor(pa[valid]/[w/8,h/5]).astype(int), axis=0).shape[0]
    report = dict(matcher=matcher_name,matches=matched_count, inliers=int(valid.sum()), occupiedCells=int(cells), totalCells=40,
                  medianReprojectionPx=float(np.median(errors[valid])) if valid.any() else None,
                  medianParallaxDegrees=float(np.median(angles[valid])) if valid.any() else None,
                  intrinsics='assumed horizontal field of view; not lens calibrated', horizontalFov=hfov,
                  scale='relative; camera baseline = 1 unit', exposureSync='unverified',
                  status='provisional', R=R.tolist(), t=t.ravel().tolist(), K=K.tolist())
    if valid.sum()<50 or cells<8 or np.median(errors[valid])>1.5:
        raise ValueError(f'Pose quality gate failed: {valid.sum()} valid points across {cells}/40 image regions. A calibration capture is required.')
    return K, R, t, report


def dense_stereo(images, K, R, t):
    a,b=images; h,w=a.shape[:2]
    ra,rb,pa,pb,Q,_,_=cv2.stereoRectify(K,np.zeros(5),K,np.zeros(5),(w,h),R,t,flags=cv2.CALIB_ZERO_DISPARITY,alpha=-1)
    # OpenCV's alpha=0 crop can magnify convergent cameras thousands of pixels.
    # Fit the rectified raster to the actual shared feature rays instead.
    ma,mb=learned_matches(images)
    rays=np.concatenate([cv2.undistortPoints(p[:,None],K,None,R=r).reshape(-1,2) for p,r in [(ma,ra),(mb,rb)]])
    lo,hi=np.percentile(rays,[2,98],axis=0);span=(hi-lo)*1.3
    focal=min(w/span[0],h/span[1]);center=(lo+hi)/2
    pa=np.array([[focal,0,w/2-center[0]*focal,0],[0,focal,h/2-center[1]*focal,0],[0,0,1,0]],np.float64)
    pb=pa.copy();tx=float((rb@t).ravel()[0]);pb[0,3]=focal*tx
    Q=np.array([[1,0,0,-pa[0,2]],[0,1,0,-pa[1,2]],[0,0,0,focal],[0,0,-1/tx,0]],np.float64)
    maps=[cv2.initUndistortRectifyMap(K,np.zeros(5),r,p,(w,h),cv2.CV_32FC1) for r,p in [(ra,pa),(rb,pb)]]
    ar,br=[cv2.remap(im,*m,cv2.INTER_LINEAR) for im,m in zip(images,maps)]
    grays=[cv2.cvtColor(im,cv2.COLOR_BGR2GRAY) for im in [ar,br]]
    ndisp=max(64, ((w//2)//16)*16); minimum=-ndisp if pb[0,3]>0 else 0
    def matcher(low):
        return cv2.StereoSGBM_create(minDisparity=low,numDisparities=ndisp,blockSize=5,P1=8*25,P2=32*25,disp12MaxDiff=1,uniquenessRatio=12,speckleWindowSize=100,speckleRange=2,mode=cv2.STEREO_SGBM_MODE_SGBM_3WAY)
    dl=matcher(minimum).compute(*grays).astype(np.float32)/16
    dr=matcher(-minimum-ndisp).compute(grays[1],grays[0]).astype(np.float32)/16
    yy,xx=np.indices((h,w)); xr=np.rint(xx-dl).astype(int); inside=(xr>=0)&(xr<w)
    xc=xr.clip(0,w-1)
    lr=np.abs(dl+dr[yy,xc]); color_error=np.mean(np.abs(ar.astype(float)-br[yy,xc].astype(float)),axis=2)
    valid=inside&(dl>minimum)&(np.abs(dl)>.5)&(lr<1.5)&(color_error<45)
    for index,(mx,my) in enumerate(maps):
        # Exclude remapped image borders, which can otherwise make false black surfaces.
        if index:mx=mx[yy,xc];my=my[yy,xc]
        valid &= (mx>2)&(mx<w-3)&(my>2)&(my<h-3)
    xyz=cv2.reprojectImageTo3D(dl,Q).reshape(-1,3) @ ra
    colors=ar[:,:,::-1].reshape(-1,3).astype(np.float32)/255
    valid=valid.ravel() & np.isfinite(xyz).all(axis=1)&(xyz[:,2]>.1)&(np.linalg.norm(xyz,axis=1)<60)
    ids=np.flatnonzero(valid); accepted=len(ids)
    if accepted<300:
        raise ValueError(f'Only {accepted} consistent stereo pixels. No combined scene published; check overlap/calibration.')
    points=xyz[ids].astype(np.float32);colors=colors[ids]
    nearest=cKDTree(points).query(points,k=min(4,len(points)))[0][:,1:].mean(axis=1)
    radii=np.clip(nearest*.65,.001,.07).astype(np.float32)
    return points,colors,radii,dict(consistentPixels=accepted,imagePixels=w*h,stereoCoverage=accepted/(w*h),initialGaussians=len(points)),(ar,br)


def train(points, colors, radii, images, K, R, t, iterations, progress, surface_guidance=False, optimizations=False, camera_matrices=None, lock_geometry=False):
    import torch
    from gsplat import rasterization
    if optimizations:from kornia.losses import ssim_loss
    if not torch.cuda.is_available():raise ValueError('CUDA GPU is unavailable. Gaussian training was not run.')
    device='cuda'; n=len(points)
    def tensor(x):return torch.tensor(x,dtype=torch.float32,device=device)
    means=torch.nn.Parameter(tensor(points)); seeds=means.detach().clone()
    initial_scales=np.repeat(radii[:,None],3,axis=1)
    initial_quat=np.tile([1.,0,0,0],(n,1))
    if surface_guidance:
        from surface_guides import estimate_surface_guides, surface_measurements
        normals,initial_quat,guided,confidence=estimate_surface_guides(points,radii)
        initial_scales[guided,:2]*=1.2;initial_scales[guided,2]*=.12
        normal=tensor(normals);mask=torch.tensor(guided,device=device);anchor_quat=tensor(initial_quat)
    radius=tensor(radii)[:,None];initial_size=tensor(initial_scales)
    scales=torch.nn.Parameter(initial_size.log())
    quat=torch.nn.Parameter(tensor(initial_quat))
    rgb=torch.nn.Parameter(torch.logit(tensor(colors).clamp(.01,.99)))
    alpha=torch.nn.Parameter(torch.full((n,),1.4,device=device))
    pose=np.eye(4,dtype=np.float32);pose[:3,:3]=R;pose[:3,3]=t.ravel()
    views=tensor(camera_matrices if camera_matrices is not None else np.stack([np.eye(4),pose]));ks=tensor(K if K.ndim==3 else np.stack([K]*len(images)))
    targets=tensor(np.stack([im[:,:,::-1].copy()/255 for im in images]));h,w=images[0].shape[:2]
    optimizer=torch.optim.Adam([{'params':[means],'lr':.00015},{'params':[scales],'lr':.005},{'params':[quat],'lr':.001},{'params':[rgb],'lr':.02},{'params':[alpha],'lr':.01}])
    loss_start=None
    for step in range(iterations):
        camera=step%len(images)
        render,opacity,_=rasterization(means,quat,scales.exp(),alpha.sigmoid(),rgb.sigmoid(),views[camera:camera+1],ks[camera:camera+1],w,h,packed=False,near_plane=.05,far_plane=100)
        # Full-image loss prevents reducing opacity to hide difficult pixels.
        # Geometry starts only at observed/inferred surfaces; no background planes.
        photometric=(render-targets[camera:camera+1]).abs().mean()
        appearance=photometric
        if optimizations:
            structural=ssim_loss(render.permute(0,3,1,2),targets[camera:camera+1].permute(0,3,1,2),window_size=7,reduction='mean')
            appearance=.8*photometric+.2*structural
            optimizer.param_groups[0]['lr']=.00015*(.1**(step/max(1,iterations-1)))
        loss=appearance+((means-seeds)**2).mean()*.5+(scales.exp()/initial_size-1).square().mean()*.0001
        optimizer.zero_grad();loss.backward();optimizer.step()
        with torch.no_grad():
            scales.clamp_(min=-7,max=-2);alpha.clamp_(-4,5)
            means.copy_(seeds+(means-seeds).clamp(-.03,.03))
            if surface_guidance:
                # Preserve tangent orientation. Thin axes must not rotate into
                # viewing-ray billboards simply to improve source image scores.
                quat[mask]=anchor_quat[mask]
                displacement=means-seeds
                normal_distance=(displacement*normal).sum(dim=1,keepdim=True)
                tangent=displacement-normal_distance*normal
                tangent*=torch.minimum(torch.ones_like(radius),radius/tangent.norm(dim=1,keepdim=True).clamp_min(1e-8))
                constrained=seeds+tangent+normal*torch.maximum(-radius*.15,torch.minimum(radius*.15,normal_distance))
                means[mask]=constrained[mask]
                size=scales.exp()
                tangent_size=torch.maximum(radius*.35,torch.minimum(radius*2,size[:,:2]))
                thickness=torch.maximum(radius*.04,torch.minimum(tangent_size.min(dim=1,keepdim=True).values*.12,size[:,2:]))
                size=torch.cat([tangent_size,thickness],dim=1)
                scales[mask]=size[mask].log()
            if lock_geometry:
                # Appearance fitting cannot drag confirmed surface seeds into
                # empty space. Spatial motion comes from observed frame depth.
                means.copy_(seeds)
        if loss_start is None:loss_start=float(photometric.detach())
        if step%25==0:progress(step/iterations)
    metrics=[]
    with torch.no_grad():
        for camera in range(len(images)):
            render,opacity,_=rasterization(means,quat,scales.exp(),alpha.sigmoid(),rgb.sigmoid(),views[camera:camera+1],ks[camera:camera+1],w,h,packed=False)
            # Full-image error includes empty/unsupported pixels, so missing geometry is penalized.
            mse=float(((render-targets[camera:camera+1])**2).mean());coverage=float((opacity>.5).float().mean())
            metrics.append(dict(camera=camera,psnr=-10*math.log10(max(mse,1e-12)),coverage=coverage))
        values=[x.detach().cpu().numpy() for x in [means,scales.exp(),quat/quat.norm(dim=1,keepdim=True),rgb.sigmoid(),alpha.sigmoid()]]
    del optimizer
    torch.cuda.empty_cache()
    quality=dict(trainingViews=metrics,initialFullImageL1=loss_start,finalFullImageL1=float(photometric.detach()),heldOutView='not available; training-view scores do not prove novel-view fidelity')
    if surface_guidance:quality['surfaceGuidance']=surface_measurements(values[0],points,values[1],normals,guided,radii)
    return values,quality


def export_splat(path, values):
    xyz,scales,quat,rgb,alpha=values
    # Standard 32-byte .splat records: position, scales, RGBA, normalized WXYZ rotation.
    out=np.zeros(len(xyz),dtype=[('position','<f4',3),('scale','<f4',3),('color','u1',4),('rotation','u1',4)])
    out['position']=xyz;out['scale']=scales
    out['color'][:,:3]=np.uint8(np.clip(rgb*255,0,255));out['color'][:,3]=np.uint8(np.clip(alpha*255,0,255))
    out['rotation']=np.uint8(np.clip(quat*128+128,0,255));out.tofile(path)


def run(spec, output):
    started=time.time();files=[Path(c['file']) for c in spec['cameras']]
    if len(files)<2:raise ValueError('Select at least two camera views.')
    if spec.get('method')=='stereo' and len(files)!=2:raise ValueError('Strict stereo requires two views; use multi-view for larger rigs.')
    profile=profile_for_views(PROFILES[spec['profile']],len(files))
    offsets=camera_offsets(spec)
    durations=[media_duration(f,c['duration']) for f,c in zip(files,spec['cameras'])]
    duration=min(d+o for d,o in zip(durations,offsets));start=max(max(offsets),.15);end=duration-.25
    if duration-start<1:raise ValueError('Not enough overlapping video.')
    def frames(sec):
        images=[read_frame(f,sec-o,profile['width']) for f,o in zip(files,offsets)]
        height=min(im.shape[0] for im in images)
        return [crop_height(im,height) for im in images]
    def status(stage,percent,**extra):write_json(output/'status.json',dict(state='running',stage=stage,progress=percent,elapsedSeconds=time.time()-started,**extra))
    status('Estimating shared camera geometry',.02)
    samples=[frames(float(v)) for v in np.linspace(start,min(end,12),7)]
    backgrounds=[np.median(np.stack([s[c] for s in samples]),axis=0).astype(np.uint8) for c in range(len(files))]
    stable_reference=[np.max(np.abs(np.stack([s[c] for s in samples]).astype(np.float32)-backgrounds[c]),axis=(0,3))<12 for c in range(len(files))]
    geometry=None;method=spec.get('method','stereo')
    if method=='multiview':
        from multiview_geometry import MultiViewGeometry
        status('Estimating joint multi-view geometry on GPU',.03)
        geometry=MultiViewGeometry(backgrounds,occlusion_aware=True,stable_reference=stable_reference,strict_geometry=spec.get('strictGeometry',False));K,R,t,calibration=geometry.K,geometry.R,geometry.t,geometry.calibration
    else:K,R,t,calibration=calibrate(backgrounds,spec.get('hfov',70))
    write_json(output/'calibration.json',calibration)
    for camera,image in enumerate(backgrounds):cv2.imwrite(str(output/f'camera-{camera}.jpg'),image)
    if spec.get('mode','moment')=='sequence':times=np.arange(start,end,1/profile['fps']).tolist()
    else:times=[max(start,min(spec.get('time',start),end))]
    manifest=dict(version=2,cameraCount=len(files),cameraSlots=[c['slot'] for c in spec['cameras']],kind='jointly-trained-multi-view-gaussian-sequence',method=method,profile=spec['profile'],mode=spec.get('mode','moment'),
                  training=dict(iterationsPerFrame=profile['iterations'],gaussianLimit=spec.get('maxGaussians') or None,pointPolicy='all-valid-unique-geometry' if geometry else 'all-consistent-stereo-pixels',geometryInferenceWidth=518 if geometry else None,temporalRegularization=False,surfaceGuidance=spec.get('surfaceGuidance',False),optimizations='visibility-ssim-v1' if spec.get('optimizations',False) else 'legacy'),
                  width=backgrounds[0].shape[1],height=backgrounds[0].shape[0],calibration=calibration,frames=[],
                  limitations=['Estimated intrinsics, no lens-distortion calibration.','Software alignment; exposure synchronization is unverified.',
                               'All selected views contribute; unobserved areas remain unknown. Mirrors, blank surfaces and occlusions can produce errors or holes.',
                               'Independent time samples; no persistent dynamic tracking or temporal regularization.',
                               'Not a validated photorealistic reconstruction.'],metricsPass=False,realismScore=None)
    manifest['training']['geometryStabilization']='fixed-rig-stationary-depth-anchors-v1' if geometry else None
    manifest['training']['positionsLockedToSeeds']=bool(geometry and spec.get('lockGeometry',False))
    manifest['training']['geometryFilter']=('cross-view-confirmed-no-free-space-conflicts-v2' if spec.get('strictGeometry',False) else 'occlusion-aware-v1') if geometry else 'stereo-consistency'
    manifest['limitations'].append('Conservative filtering may leave holes. Stationary depth anchors are appearance/depth heuristics; moving subjects still lack persistent identities or motion tracking.')
    if spec.get('surfaceGuidance',False):manifest['limitations'].append('Local tangent planes constrain supported Gaussians; inferred surfaces and empty space remain unverified. No collision mesh.')
    for index,sec in enumerate(times):
        status(f'{"Inferring shared geometry" if geometry else "Stereo matching"} frame {index+1}/{len(times)}',.05+.9*index/len(times))
        images=frames(sec)
        if geometry:points,colors,radii,stereo=geometry.reconstruct(images)
        else:
            points,colors,radii,stereo,rectified=dense_stereo(images,K,R,t)
            if index==0:cv2.imwrite(str(output/'rectified.jpg'),np.concatenate(rectified,axis=1))
        available_points=len(points)
        points,colors,radii=apply_splat_budget(points,colors,radii,spec.get('maxGaussians',0))
        stereo['availableGaussians']=available_points
        stereo['selectedGaussians']=len(points)
        # Preserve geometry BEFORE train() can optimize positions/scales/colors.
        point_file=f'seeds-{index:05d}.ply';export_seed_ply(output/point_file,points,colors)
        mesh_file=f'mesh-{index:05d}.glb'
        mesh_report=export_depth_glb(output/mesh_file,geometry.surface_meshes) if geometry else None
        inspection=dict(stage='before Gaussian optimization',seedFile=point_file,seedPoints=len(points),meshFile=mesh_file if mesh_report else None,mesh=mesh_report,
                        note='Depth-grid surface proxy; camera layers can overlap. Not watertight, not verified free space. Seed points are the exact initial Gaussian positions.')
        values,quality=train(points,colors,radii,images,K,R,t,profile['iterations'],lambda fraction:status(f'Training frame {index+1}/{len(times)}',.05+.9*(index+fraction)/len(times)),surface_guidance=spec.get('surfaceGuidance',False),optimizations=spec.get('optimizations',False),camera_matrices=geometry.views if geometry else None,lock_geometry=bool(geometry and spec.get('lockGeometry',False)))
        filename=f'frame-{index:05d}.splat';export_splat(output/filename,values)
        manifest['frames'].append(dict(time=sec,file=filename,gaussians=len(points),stereo=stereo,quality=quality,geometry=inspection))
        write_json(output/'manifest.partial.json',manifest)
    # Optional native Blender document. GLB and PLY remain available without it.
    blender=shutil.which('blender') or next((str(p) for p in Path('C:/Program Files/Blender Foundation').glob('Blender */blender.exe')),None)
    if blender and manifest['frames'][0]['geometry']['meshFile']:
        status('Creating Blender geometry document',.96)
        try:
            result=subprocess.run([blender,'--background','--factory-startup','--python',str(Path(__file__).with_name('export_blender_geometry.py')),'--',str(output)],capture_output=True,text=True,timeout=90,creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess,'CREATE_NO_WINDOW') else 0)
            (output/'blender-export.log').write_text(result.stdout+'\n'+result.stderr,encoding='utf8')
            if result.returncode==0 and (output/'pretraining.blend').exists():manifest['blender']={'file':'pretraining.blend','frame':0,'time':times[0],'stage':'before Gaussian optimization'}
            else:manifest['blender']={'error':'Native export failed; download GLB and import into Blender.'}
        except (OSError,subprocess.TimeoutExpired) as error:manifest['blender']={'error':str(error)}
    manifest['elapsedSeconds']=time.time()-started
    manifest['qualitySummary']={'trainingViewWorstPSNR':min(v['psnr'] for frame in manifest['frames'] for v in frame['quality']['trainingViews']),
                                'trainingViewWorstCoverage':min(v['coverage'] for frame in manifest['frames'] for v in frame['quality']['trainingViews']),
                                'heldOutValidated':False,'temporalValidated':False}
    write_json(output/'manifest.json',manifest)
    # Grade the exported bytes, including quantized color/rotation, not just the optimizer tensors.
    if geometry:del geometry
    import gc;gc.collect()
    from evaluate_reconstruction import evaluate
    try:
        evaluation=evaluate(output,lambda message,value:status(message,.97+.025*value))
        manifest['evaluationFile']='evaluation.json';manifest['sourceFidelity']=evaluation['summary']
    except Exception as error:
        manifest['evaluationError']=str(error)
        write_json(output/'evaluation-status.json',dict(state='failed',error=str(error)))
    write_json(output/'manifest.json',manifest)
    write_json(output/'status.json',dict(state='complete',stage='Combined scene ready — experimental quality',progress=1,elapsedSeconds=time.time()-started,frames=len(times),metricsPass=False))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('spec');parser.add_argument('output');args=parser.parse_args()
    output=Path(args.output);output.mkdir(parents=True,exist_ok=True)
    try:run(json.loads(Path(args.spec).read_text(encoding='utf-8-sig')),output)
    except Exception as error:
        write_json(output/'status.json',dict(state='failed',stage='Reconstruction failed its checks',error=str(error),progress=0))
        raise
