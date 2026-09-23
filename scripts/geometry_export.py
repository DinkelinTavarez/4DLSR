"""Inspectable geometry captured before Gaussian optimization.

Depth-grid triangles are an inspection proxy, not a watertight or validated mesh.
The exact sampled Gaussian seed positions are exported separately as points.
"""
import json
import struct
import numpy as np


def depth_grid_mesh(xyz, rgb, valid, depth, stride=3, relative_jump=.04):
    xyz=xyz[::stride,::stride];rgb=rgb[::stride,::stride]
    valid=valid[::stride,::stride];depth=depth[::stride,::stride]
    h,w=valid.shape
    grid=np.arange(h*w).reshape(h,w)
    a=grid[:-1,:-1].ravel();b=grid[:-1,1:].ravel();c=grid[1:,:-1].ravel();d=grid[1:,1:].ravel()
    faces=np.concatenate([np.column_stack([a,c,b]),np.column_stack([b,c,d])])
    points=xyz.reshape(-1,3);colors=rgb.reshape(-1,3);z=depth.ravel()
    accepted=valid.ravel()[faces].all(axis=1)&np.isfinite(points[faces]).all(axis=(1,2))
    local=z[faces];smallest=local.min(axis=1)
    accepted &= (smallest>0)&((local.max(axis=1)-smallest)<=relative_jump*smallest)
    edges=np.stack([points[faces[:,0]]-points[faces[:,1]],points[faces[:,0]]-points[faces[:,2]],points[faces[:,1]]-points[faces[:,2]]])
    accepted &= np.linalg.norm(edges,axis=2).max(axis=0)<smallest*.08
    area=np.linalg.norm(np.cross(edges[0],edges[1]),axis=1)
    accepted &= area>1e-12
    faces=faces[accepted]
    ids,remap=np.unique(faces,return_inverse=True)
    return points[ids].astype(np.float32),colors[ids].astype(np.float32),remap.reshape(-1,3).astype(np.uint32)


def export_seed_ply(path, points, colors):
    # OpenCV camera coordinates -> glTF/Three Y-up. Blender conversion is supplied
    # in the native .blend export, since PLY has no universal up-axis convention.
    header=('ply\nformat binary_little_endian 1.0\ncomment untrained Gaussian seeds; Y-up, camera baseline=1; not metric\n'
            f'element vertex {len(points)}\nproperty float x\nproperty float y\nproperty float z\n'
            'property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n').encode('ascii')
    data=np.empty(len(points),dtype=[('xyz','<f4',3),('rgb','u1',3)])
    data['xyz']=points*np.array([1,-1,-1],np.float32);data['rgb']=np.clip(colors*255,0,255).astype(np.uint8)
    with open(path,'wb') as file:file.write(header);file.write(data.tobytes())


def export_depth_glb(path, surfaces):
    binary=bytearray()
    model=dict(asset={'version':'2.0','generator':'Spatial Replay pre-training geometry'},scene=0,scenes=[{'nodes':[]}],nodes=[],meshes=[],buffers=[],bufferViews=[],accessors=[],
               materials=[{'name':'Observed vertex colors','doubleSided':True,'pbrMetallicRoughness':{'metallicFactor':0,'roughnessFactor':1}}],
               extras={'stage':'before Gaussian optimization','source':'inferred depth grids','watertight':False,'scale':'relative camera baseline = 1; units are not surveyed meters','coordinates':'right-handed Y-up'})
    def accessor(array,kind,component,target,bounds=False):
        array=np.ascontiguousarray(array);offset=len(binary);binary.extend(array.tobytes())
        while len(binary)%4:binary.append(0)
        view=len(model['bufferViews']);model['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':array.nbytes,'target':target})
        item={'bufferView':view,'componentType':component,'count':len(array),'type':kind}
        if bounds:item.update(min=array.min(axis=0).tolist(),max=array.max(axis=0).tolist())
        index=len(model['accessors']);model['accessors'].append(item);return index
    total_vertices=total_faces=0
    for camera,(points,colors,faces) in enumerate(surfaces):
        if not len(faces):continue
        positions=(points*np.array([1,-1,-1],np.float32)).astype('<f4')
        normals=np.zeros_like(positions);tri=positions[faces]
        cross=np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0])
        for corner in range(3):np.add.at(normals,faces[:,corner],cross)
        lengths=np.linalg.norm(normals,axis=1,keepdims=True);normals/=np.maximum(lengths,1e-12)
        normals[lengths[:,0]<1e-12]=[0,0,1]
        # glTF vertex colors are linear; source camera colors are sRGB.
        linear=np.where(colors<=.04045,colors/12.92,((colors+.055)/1.055)**2.4).astype('<f4')
        primitive={'attributes':{'POSITION':accessor(positions,'VEC3',5126,34962,True),'NORMAL':accessor(normals,'VEC3',5126,34962),'COLOR_0':accessor(linear,'VEC3',5126,34962)},
                   'indices':accessor(faces.astype('<u4').ravel(),'SCALAR',5125,34963),'material':0,'mode':4}
        index=len(model['nodes']);model['nodes'].append({'name':f'Camera {camera+1} depth surface','mesh':len(model['meshes'])})
        model['meshes'].append({'primitives':[primitive]});model['scenes'][0]['nodes'].append(index)
        total_vertices+=len(points);total_faces+=len(faces)
    if not total_faces:return None
    model['buffers']=[{'byteLength':len(binary)}]
    encoded=json.dumps(model,separators=(',',':'),allow_nan=False).encode('utf8');encoded+=b' '*((-len(encoded))%4)
    with open(path,'wb') as file:
        file.write(struct.pack('<III',0x46546C67,2,12+8+len(encoded)+8+len(binary)))
        file.write(struct.pack('<II',len(encoded),0x4E4F534A));file.write(encoded)
        file.write(struct.pack('<II',len(binary),0x004E4942));file.write(binary)
    return dict(vertices=total_vertices,triangles=total_faces,layers=len(model['nodes']),relativeDepthJumpLimit=.04)
