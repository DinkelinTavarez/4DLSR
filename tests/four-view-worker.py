"""GPU integration fixture: four DISTINCT rendered views, never real footage.

This checks pipeline participation and export integrity, not scene realism.
Run manually on the reconstruction environment; result lives only in artifacts.
"""
import json
import sys
import subprocess
from pathlib import Path
import cv2
import numpy as np
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'scripts'))
from reconstruct import run

out=root/'artifacts'/'four-view-verification'
out.mkdir(parents=True,exist_ok=True)
w,h=640,360
rng=np.random.default_rng(17)
texture=rng.integers(50,220,(256,256,3),dtype=np.uint8)
texture=cv2.GaussianBlur(texture,(3,3),0)
# Three room boundaries, two boxes. Each view sees a different perspective.
boxes=[(np.array([-4.,-2.,-1.]),np.array([4.,2.8,7.])),
       (np.array([-.7,-.4,2.6]),np.array([.5,1.9,3.8])),
       (np.array([1.1,.8,4.]),np.array([2.3,1.9,5.2]))]
def render(center):
    target=np.array([0.,.2,3.8]);forward=target-center;forward/=np.linalg.norm(forward)
    right=np.cross(np.array([0.,1,0]),forward);right/=np.linalg.norm(right)
    down=np.cross(forward,right);rotation=np.stack([right,down,forward],axis=1)
    yy,xx=np.mgrid[:h,:w];rays=np.stack([(xx-w/2)/510,(yy-h/2)/510,np.ones((h,w))],axis=-1)@rotation.T
    distance=np.full((h,w),1e6);which=np.zeros((h,w),int);axes=np.zeros((h,w),int)
    for i,(lo,hi) in enumerate(boxes):
        a=(lo-center)/np.where(np.abs(rays)>1e-9,rays,1e-9);b=(hi-center)/np.where(np.abs(rays)>1e-9,rays,1e-9)
        near=np.minimum(a,b);far=np.maximum(a,b);enter=near.max(axis=-1);leave=far.min(axis=-1)
        inside=(center>lo).all() and (center<hi).all();d=leave if inside else enter
        hit=(leave>=np.maximum(enter,0))&(d>0)&(d<distance)
        distance[hit]=d[hit];which[hit]=i;face=far.argmin(axis=-1) if inside else near.argmax(axis=-1);axes[hit]=face[hit]
    points=center+rays*distance[...,None];color=np.zeros((h,w,3),np.uint8)
    for axis in range(3):
        uv=points[...,[(axis+1)%3,(axis+2)%3]];coords=np.floor(uv*55).astype(int)%256
        sample=texture[coords[...,0],coords[...,1]].astype(float)
        checker=(np.floor(uv[...,0]*2)+np.floor(uv[...,1]*2))%2
        sample=sample*.7+checker[...,None]*40
        sample*=np.array([.9,1.,1.]) if axis==1 else np.array([1.,.85,.72])
        mask=axes==axis;color[mask]=sample.clip(0,255).astype(np.uint8)[mask]
    for i in range(1,3):color[which==i]=np.roll(color[which==i],i,axis=-1)
    return color

cameras=[]
for i,x in enumerate([-1.2,-.4,.4,1.2]):
    im=render(np.array([x,-.2,-.5]));file=out/f'fixture-{i}.png';cv2.imwrite(str(file),im)
    video=out/f'fixture-{i}.webm'
    subprocess.run(['ffmpeg','-v','error','-y','-loop','1','-i',str(file),'-t','2.2','-r','10','-c:v','libvpx','-pix_fmt','yuv420p',str(video)],check=True)
    cameras.append(dict(slot=i,file=str(video),duration=2.2,startRequestedMs=i*2))
assert len({(out/f'fixture-{i}.png').read_bytes() for i in range(4)})==4
spec=dict(profile='quick',mode='sequence',method='multiview',time=1,offsetMs=0,offsetsMs=[0,0,0,0],hfov=70,surfaceGuidance=True,optimizations=True,cameras=cameras,simulated=True)
(out/'spec.json').write_text(json.dumps(spec))
run(spec,out)
m=json.loads((out/'manifest.json').read_text());e=json.loads((out/'evaluation.json').read_text())
assert m['cameraCount']==4 and len(m['calibration']['views'])==4
assert m['training']['iterationsPerFrame']==200 and m['training']['gaussianLimit'] is None
assert all(f['gaussians']>40000 for f in m['frames'])
assert all((out/f['file']).stat().st_size==f['gaussians']*32 for f in m['frames'])
assert len(m['frames'])==2
assert all(len(f['quality']['trainingViews'])==4 for f in m['frames'])
assert all(len(f['stereo']['support'])==4 for f in m['frames'])
assert e['summary']['viewsCompared']==8
assert all((out/f'camera-{i}.jpg').exists() for i in range(4))
assert all((out/f'comparison-00000-{i}.jpg').exists() for i in range(4))
report=dict(passed=True,scope='Synthetic four-view software integration only. Not real-camera quality validation.',frames=2,views=4,comparisons=8,elapsedSeconds=m['elapsedSeconds'],training=m['training'])
(out/'verification.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
