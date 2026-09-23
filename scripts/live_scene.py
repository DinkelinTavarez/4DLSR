"""Memory-only live geometry drafts. No Gaussian optimization or recording."""
import sys
import json
import base64
import contextlib
import cv2
import numpy as np
from camera_geometry import crop_height
from splat_budget import apply_splat_budget

geometry=None
slots=None
for line in sys.stdin:
    try:
        payload=json.loads(line);images=[]
        for frame in payload['frames']:
            raw=base64.b64decode(frame['image'].split(',',1)[1],validate=True)
            image=cv2.imdecode(np.frombuffer(raw,np.uint8),cv2.IMREAD_COLOR)
            if image is None or image.shape[0]>2160 or image.shape[1]>3840:raise ValueError('Invalid live image size')
            images.append(cv2.resize(image,(640,round(image.shape[0]*640/image.shape[1]))))
        # A format/aspect change invalidates the previous depth/pose reference.
        key=[(f['slot'],im.shape[:2]) for f,im in zip(payload['frames'],images)]
        height=min(im.shape[0] for im in images);images=[crop_height(im,height) for im in images]
        with contextlib.redirect_stdout(sys.stderr):
            from multiview_geometry import MultiViewGeometry
            if geometry is None or slots!=key:
                if geometry is not None:del geometry
                geometry=MultiViewGeometry(images,occlusion_aware=True);slots=key
            points,colors,radii,support=geometry.reconstruct(images)
        available_points=len(points)
        points,colors,radii=apply_splat_budget(points,colors,radii,payload.get('maxGaussians',0))
        # Isotropic untrained splats are a depth preview, not trained appearance.
        raw=np.zeros(len(points),dtype=[('position','<f4',3),('scale','<f4',3),('color','u1',4),('rotation','u1',4)])
        raw['position']=points;raw['scale']=radii[:,None]*.65
        raw['color'][:,:3]=np.uint8(np.clip(colors*255,0,255));raw['color'][:,3]=210;raw['rotation'][:]=[255,128,128,128]
        result=dict(width=640,height=height,calibration=geometry.calibration,gaussians=len(points),gaussianLimit=payload.get('maxGaussians') or None,availableGaussians=available_points,pointPolicy='all-valid-unique-geometry',support=support,splat=base64.b64encode(raw.tobytes()).decode(),kind='untrained-live-geometry-draft')
        print(json.dumps(result,allow_nan=False),flush=True)
    except Exception as error:print(json.dumps({'error':str(error)}),flush=True)
