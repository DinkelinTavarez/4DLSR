"""Shared camera/timeline conventions, including legacy two-view manifests."""
import numpy as np

def camera_views(calibration):
    if 'views' in calibration:
        views=np.asarray(calibration['views'],dtype=np.float32)
        if views.ndim!=3 or views.shape[1:]!=(4,4) or not np.isfinite(views).all():
            raise ValueError('Invalid camera matrices')
        return views
    pose=np.eye(4,dtype=np.float32)
    pose[:3,:3]=calibration['R'];pose[:3,3]=calibration['t']
    return np.stack([np.eye(4,dtype=np.float32),pose])

def camera_offsets(spec):
    starts=[c.get('startRequestedMs',0)/1000 for c in spec['cameras']]
    offsets=np.asarray(starts)-min(starts)
    corrections=spec.get('offsetsMs')
    if corrections is not None:
        if len(corrections)!=len(starts):raise ValueError('One timing correction per selected camera is required')
        offsets+=np.asarray(corrections)/1000
    else:offsets[1]+=spec.get('offsetMs',0)/1000
    return offsets.tolist()

def profile_for_views(profile,count):
    # Preserve per-camera optimization effort. Geometry has no count cap;
    # profiles control raster detail, iterations and replay sampling cadence.
    return {**profile,'iterations':int(profile['iterations']*count/2),
            'max_points':None}

def crop_height(image,height):
    if image.shape[0]<height:raise ValueError('Source image is smaller than its recorded crop')
    top=(image.shape[0]-height)//2
    return image[top:top+height]
