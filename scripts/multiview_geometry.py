"""Joint learned multi-view geometry. Inference, not metrologically calibrated depth."""
from pathlib import Path
import cv2
import numpy as np
import torch
from scipy.spatial import cKDTree
from vggt.models.vggt import VGGT
from vggt.utils.pose_enc import pose_encoding_to_extri_intri


class MultiViewGeometry:
    def __init__(self, reference, occlusion_aware=False, stable_reference=None, strict_geometry=False):
        torch.set_num_threads(4)
        self.model=VGGT(enable_point=False,enable_track=False).eval()
        state=torch.load(Path(__file__).resolve().parent.parent/'.models/vggt-model.pt',map_location='cpu',weights_only=True)
        self.model.load_state_dict(state,strict=False);del state
        self.model=self.model.cuda()
        self.reference=reference
        self.stable_reference=stable_reference
        self.strict_geometry=strict_geometry
        self.occlusion_aware=occlusion_aware
        depth,confidence,extrinsic,K,baseline=self.predict(reference)
        self.depth=depth;self.K=K;self.views=extrinsic;self.R=extrinsic[1,:3,:3];self.t=extrinsic[1,:3,3:4]
        self.calibration=dict(status='inferred',method='VGGT joint multi-view estimation',intrinsics='inferred jointly from all selected views; not lens calibrated',cameraCount=len(reference),views=extrinsic.tolist(),
                              scale='relative; farthest inferred camera from camera 0 = 1 unit',exposureSync='unverified',R=self.R.tolist(),t=self.t.ravel().tolist(),K=self.K.tolist(),
                              license='VGGT-1B research checkpoint: non-commercial; commercial checkpoint has separate access and terms')

    def predict(self, images):
        h,w=images[0].shape[:2];nw=518;nh=round(h*nw/w/14)*14
        batch=torch.tensor(np.stack([cv2.resize(im[:,:,::-1],(nw,nh)).transpose(2,0,1).copy()/255 for im in images]),dtype=torch.float32,device='cuda')
        with torch.no_grad(),torch.autocast(device_type='cuda',dtype=torch.bfloat16):prediction=self.model(batch)
        extrinsic,K=pose_encoding_to_extri_intri(prediction['pose_enc'],(nh,nw))
        ex=extrinsic[0].float().cpu().numpy();ki=K[0].float().cpu().numpy()
        # Normalize the common world to camera 0 and the inferred baseline.
        root=np.eye(4);root[:3]=ex[0];views=[]
        for pose in ex:
            p=np.eye(4);p[:3]=pose;views.append(p@np.linalg.inv(root))
        views=np.array(views);baseline=np.max(np.linalg.norm(views[1:,:3,3],axis=1))
        if not np.isfinite(baseline) or baseline<1e-5:raise ValueError('The inferred cameras have no usable baseline.')
        views[:,:3,3]/=baseline
        depths=prediction['depth'][0,...,0].float().cpu().numpy()/baseline
        conf=prediction['depth_conf'][0].float().cpu().numpy()
        depths=np.stack([cv2.resize(d,(w,h)) for d in depths]);conf=np.stack([cv2.resize(c,(w,h)) for c in conf])
        ki[:,0,:]*=w/nw;ki[:,1,:]*=h/nh
        del prediction,batch;torch.cuda.empty_cache()
        return depths,conf,views,ki,baseline

    def reconstruct(self, images):
        from geometry_export import depth_grid_mesh
        from visibility_filter import cross_view_visibility
        from temporal_geometry import stationary_mask, depth_interior, confirmed_surface
        depths,conf,ex,_,_=self.predict(images);h,w=images[0].shape[:2]
        # Fixed rig: use the reference poses for every replay sample. Stabilize
        # scale with pixels whose appearance remains unchanged from reference.
        factors=[]
        for i in range(len(images)):
            stationary=np.mean(np.abs(images[i].astype(float)-self.reference[i].astype(float)),axis=2)<15
            valid=stationary&(depths[i]>0)&(conf[i]>np.percentile(conf[i],30))
            factor=np.median(self.depth[i][valid]/depths[i][valid]) if valid.sum()>500 else 1.
            if not .5<factor<2:raise ValueError('Inferred depth scale is unstable. Use a shorter take with fixed cameras.')
            factors.append(float(factor))
        # Preserve the existing reference-scale alignment before testing
        # stationary anchors; joint-scale calibration needs separate validation.
        depths*=np.array(factors,dtype=np.float32)[:,None,None]
        anchored=[]
        for i in range(len(images)):
            stable=self.stable_reference[i] if self.stable_reference is not None else None
            mask=stationary_mask(images[i],self.reference[i],self.depth[i],depths[i],conf[i],stable) if stable is not None else np.zeros_like(depths[i],dtype=bool)
            depths[i][mask]=self.depth[i][mask]
            anchored.append(int(mask.sum()))
        yy,xx=np.indices((h,w));pixel=np.stack([xx,yy,np.ones_like(xx)],axis=-1).reshape(-1,3)
        points=[];colors=[];support=[];self.surface_meshes=[]
        views=[(p[:3,:3],p[:3,3]) for p in self.views]
        for i,(R,t) in enumerate(views):
            xyz=((pixel@np.linalg.inv(self.K[i]).T)*depths[i].reshape(-1,1)-t)@R
            strict=getattr(self,'strict_geometry',False)
            valid=np.isfinite(xyz).all(axis=1)&(depths[i].ravel()>0)&(conf[i].ravel()>np.percentile(conf[i],30 if strict else 10))
            if strict:valid &= depth_interior(depths[i]).ravel()
            supported=np.zeros(len(xyz),np.int32);contradicted=np.zeros(len(xyz),np.int32);hidden=np.zeros(len(xyz),bool)
            for other,(otherR,otherT) in enumerate(views):
                if other==i:continue
                cam=xyz@otherR.T+otherT;p=cam@self.K[other].T
                uv=np.rint(p[:,:2]/np.maximum(p[:,2:],1e-6)).astype(int);inside=(uv[:,0]>=0)&(uv[:,0]<w)&(uv[:,1]>=0)&(uv[:,1]<h)&(cam[:,2]>.01)
                u=uv[:,0].clip(0,w-1);v=uv[:,1].clip(0,h-1);expected=depths[other][v,u]
                reliable=conf[other][v,u]>np.percentile(conf[other],30 if strict else 10)
                keep,consistent,occluded=cross_view_visibility(cam[:,2],expected,inside,reliable,tolerance=.05 if strict else .1)
                supported+=consistent;contradicted+=~keep;hidden|=occluded
            # Require a second observation and no reliable free-space conflict;
            # unseen/occluded pixels are not votes for fabricated geometry.
            valid &= confirmed_surface(supported,contradicted) if strict else (contradicted<=supported)
            self.surface_meshes.append(depth_grid_mesh(xyz.reshape(h,w,3),images[i][:,:,::-1].astype(np.float32)/255,valid.reshape(h,w),depths[i],stride=max(1,int(np.ceil(w/320)))))
            points.append(xyz[valid]);colors.append(images[i][:,:,::-1].reshape(-1,3)[valid]/255)
            support.append(dict(camera=i,retained=int(valid.sum()),crossViewConsistent=int((valid&(supported>0)).sum()),occludedInOtherView=int((valid&hidden).sum()),unconfirmed=int((valid&(supported==0)).sum()),comparedViews=len(views)-1))
        points=np.concatenate(points).astype(np.float32);colors=np.concatenate(colors).astype(np.float32)
        if len(points)<1000:raise ValueError('Too few consistent multi-view points to train a scene.')
        # Merge duplicate observations of the same surface. Retain every
        # resulting point; do not randomly discard geometry to hit a count cap.
        voxel=max(np.median(np.linalg.norm(points,axis=1))*.0015,.001)
        _,ids=np.unique(np.round(points/voxel).astype(np.int64),axis=0,return_index=True)
        points=points[ids];colors=colors[ids]
        radii=np.clip(cKDTree(points).query(points,k=4)[0][:,1:].mean(axis=1)*.8,.001,.08).astype(np.float32)
        return points,colors,radii,dict(source='joint learned geometry',support=support,depthScaleCorrections=factors,stationaryAnchoredPixels=anchored,filterPolicy='cross-view-confirmed-no-free-space-conflicts-v2' if strict else 'occlusion-aware-v1',initialGaussians=len(points))
