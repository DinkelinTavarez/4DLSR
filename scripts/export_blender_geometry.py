"""Run with Blender --background --factory-startup --python ... -- JOB_DIR."""
import json
import math
import sys
from pathlib import Path
import bpy
import numpy as np
from mathutils import Matrix, Vector

folder=Path(sys.argv[sys.argv.index('--')+1]).resolve()
manifest=json.loads((folder/'manifest.partial.json').read_text(encoding='utf8'))
frame=manifest['frames'][0]
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(folder/frame['geometry']['meshFile']))
surfaces=[obj for obj in bpy.context.scene.objects if obj.type=='MESH']
for i,obj in enumerate(surfaces):
    obj.color=(.55,.69,.79,1) if i%2==0 else (.71,.76,.58,1)
    obj['geometry_stage']='before Gaussian optimization'
    obj['geometry_status']='Inferred depth surface; incomplete and unvalidated'
    obj['recording_time_seconds']=frame['time']

# Preserve exact untrained seed points as a separate hidden inspection object.
raw=(folder/frame['geometry']['seedFile']).read_bytes();start=raw.index(b'end_header\n')+len(b'end_header\n')
seeds=np.frombuffer(raw[start:],dtype=[('xyz','<f4',3),('rgb','u1',3)])
xyz=seeds['xyz'];xyz=np.column_stack([xyz[:,0],-xyz[:,2],xyz[:,1]]) # Y-up -> Blender Z-up
mesh=bpy.data.meshes.new('Exact untrained Gaussian seed positions');mesh.from_pydata(xyz.tolist(),[],[]);mesh.update()
obj=bpy.data.objects.new('Untrained seed points (unhide to inspect)',mesh);bpy.context.scene.collection.objects.link(obj);obj.hide_render=True;obj.hide_set(True)
obj['geometry_stage']='Exact initialization points, before optimization'

scene=bpy.context.scene;cal=manifest['calibration'];conversion=Matrix(((1,0,0),(0,0,1),(0,-1,0)));camera_axes=Matrix(((1,0,0),(0,-1,0),(0,0,-1)))
views=cal.get('views')
for index in range(len(views) if views else 2):
    rotation=Matrix(np.array(views[index])[:3,:3].tolist()).transposed() if views else (Matrix.Identity(3) if index==0 else Matrix(cal['R']).transposed())
    translation=Vector(np.array(views[index])[:3,3].tolist()) if views else (Vector((0,0,0)) if index==0 else Vector(cal['t']))
    center=-(rotation@translation)
    data=bpy.data.cameras.new(f'Source camera {index+1}');camera=bpy.data.objects.new(data.name,data);scene.collection.objects.link(camera)
    camera.matrix_world=(conversion@rotation@camera_axes).to_4x4();camera.location=conversion@center
    K=cal['K'][index] if isinstance(cal['K'][0][0],list) else cal['K']
    data.sensor_width=36;data.lens=K[0][0]*36/manifest['width'];data.clip_start=.01;data.clip_end=500;data.display_size=.15
    camera['calibration_status']='Inferred; camera baseline is one relative unit'
    if index==0:scene.camera=camera

scene.unit_settings.system='NONE'
scene['geometry_stage']='Before Gaussian optimization'
scene['source_time_seconds']=frame['time']
scene['scale_note']='Camera baseline = 1 relative unit; not surveyed meters'
text=bpy.data.texts.new('READ ME - pre-Gaussian geometry')
text.write(f'''Source time: {frame['time']:.2f} seconds.
This document contains the inferred geometry saved BEFORE Gaussian training.
The per-camera depth surfaces remain separately named camera layers. They can overlap,
disagree, have holes, or be misplaced. This is not a watertight or validated room.
Exact sampled initialization points are in the hidden seed-points object.
Surface triangles are an inspection proxy; training uses the seed points and
local tangent constraints, not a Blender mesh optimization process.
Coordinates are Blender Z-up; scale is relative camera baseline=1, not meters.
No Gaussian splats are included. Source recordings were not modified.
''')
corners=[obj.matrix_world@Vector(corner) for obj in surfaces for corner in obj.bound_box]
lo=Vector(tuple(min(v[i] for v in corners) for i in range(3)));hi=Vector(tuple(max(v[i] for v in corners) for i in range(3)))
center=(lo+hi)/2;size=max((hi-lo).length,1)
eye=center+Vector((.65,-.8,.5))*size;view_rotation=(center-eye).to_track_quat('-Z','Y')
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            space=area.spaces.active;space.shading.type='SOLID';space.shading.color_type='OBJECT';space.overlay.show_floor=False
            space.region_3d.view_location=center;space.region_3d.view_distance=(eye-center).length;space.region_3d.view_rotation=view_rotation
            space.clip_end=max(500,size*10)
scene.render.engine='BLENDER_WORKBENCH';scene.display.shading.color_type='OBJECT';scene.display.shading.light='STUDIO'
scene.display.shading.show_cavity=True;scene.display.shading.cavity_type='BOTH'
scene.render.resolution_x=manifest['width'];scene.render.resolution_y=manifest['height'];scene.render.resolution_percentage=75
scene.render.image_settings.file_format='PNG';scene.render.filepath=str(folder/'geometry-blender-preview.png')
bpy.ops.object.select_all(action='DESELECT')
for surface in surfaces:surface.select_set(True)
bpy.context.view_layer.objects.active=surfaces[0]
bpy.ops.wm.save_as_mainfile(filepath=str(folder/'pretraining.blend'))
report=dict(surfaceObjects=len(surfaces),vertices=sum(len(o.data.vertices) for o in surfaces),triangles=sum(len(o.data.polygons) for o in surfaces),seedPoints=len(seeds),time=frame['time'],stage='before Gaussian optimization')
try:bpy.ops.render.render(write_still=True);report['preview']='geometry-blender-preview.png'
except Exception as error:report['previewError']=str(error)
(folder/'blender-geometry.json').write_text(json.dumps(report,indent=2),encoding='utf8')
print(json.dumps(report))
