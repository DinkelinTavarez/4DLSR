"""Local tangent planes for experimental surface-constrained Gaussian training.

These planes inherit uncertainty from the input depth. They are neither object
segmentation nor a watertight collision mesh, and do not validate empty space.
"""
import numpy as np
from scipy.spatial import cKDTree
from scipy.spatial.transform import Rotation


def estimate_surface_guides(points, radii, neighbors=16):
    count=len(points)
    normals=np.zeros((count,3),np.float32)
    quaternions=np.tile(np.array([1.,0,0,0],np.float32),(count,1))
    confidence=np.zeros(count,np.float32)
    if count<6:
        return normals,quaternions,confidence>0,confidence
    tree=cKDTree(points)
    for start in range(0,count,8192):
        stop=min(start+8192,count)
        distances,ids=tree.query(points[start:stop],k=min(neighbors,count),workers=4)
        local=points[ids];centered=local-local.mean(axis=1,keepdims=True)
        covariance=np.einsum('nki,nkj->nij',centered,centered)/local.shape[1]
        values,vectors=np.linalg.eigh(covariance)
        score=(values[:,1]-values[:,0])/np.maximum(values[:,2],1e-12)
        # Reject line-like clusters, isolated points and neighborhoods spanning
        # large gaps. The remaining normal can still be wrong if depth is wrong.
        score[(distances[:,-1]>radii[start:stop]*10)|(values[:,1]<1e-12)]=0
        normal=vectors[:,:,0];tangent=vectors[:,:,2]
        basis=np.stack([tangent,np.cross(normal,tangent),normal],axis=-1)
        xyzw=Rotation.from_matrix(basis).as_quat()
        normals[start:stop]=normal;quaternions[start:stop]=xyzw[:,[3,0,1,2]]
        confidence[start:stop]=np.clip(score,0,1)
    guided=confidence>.25
    quaternions[~guided]=[1,0,0,0]
    return normals,quaternions,guided,confidence


def surface_measurements(points, seeds, scales, normals, guided, radii):
    if not guided.any():
        return dict(guidedGaussians=0,guidedFraction=0.,maxThicknessRatio=None,maxNormalDriftInSeedRadii=None)
    thickness=scales[guided,2]/np.minimum(scales[guided,0],scales[guided,1])
    drift=np.abs(np.sum((points-seeds)*normals,axis=1))[guided]/radii[guided]
    return dict(guidedGaussians=int(guided.sum()),guidedFraction=float(guided.mean()),
                maxThicknessRatio=float(thickness.max()),medianThicknessRatio=float(np.median(thickness)),
                maxNormalDriftInSeedRadii=float(drift.max()),
                geometryValidated=False)
