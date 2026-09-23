import sys
import tempfile
import unittest
import json
import struct
from pathlib import Path
import cv2
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from reconstruct import triangulate, export_splat, PROFILES
from surface_guides import estimate_surface_guides
from scipy.spatial.transform import Rotation
from geometry_export import depth_grid_mesh, export_depth_glb, export_seed_ply
from reconstruction_metrics import compare_images,summarize
from visibility_filter import cross_view_visibility
from camera_geometry import camera_views,camera_offsets,profile_for_views,crop_height
from splat_budget import apply_splat_budget


class ReconstructionTests(unittest.TestCase):
    def test_explicit_budget_preserves_all_camera_layers_and_attribute_alignment(self):
        # Four camera layers, each with a distinct color and radius.
        points=np.arange(1200,dtype=np.float32).reshape(400,3)
        colors=np.repeat(np.eye(4,3,dtype=np.float32),100,axis=0)
        radii=np.repeat(np.array([.01,.02,.03,.04]),100)
        p,c,r=apply_splat_budget(points,colors,radii,80)
        self.assertEqual(len(p),80)
        for layer in range(4):
            inside=(p[:,0]>=layer*300)&(p[:,0]<(layer+1)*300)
            self.assertEqual(inside.sum(),20)
            np.testing.assert_array_equal(c[inside],np.repeat(colors[layer*100][None],20,axis=0))
            self.assertTrue(np.all(r[inside]==radii[layer*100]))
        self.assertIs(apply_splat_budget(points,colors,radii,0)[0],points)
        self.assertEqual(len(apply_splat_budget(points,colors,radii,1000)[0]),400)
        for bad in [-1,2.5,True]:
            with self.assertRaises(ValueError):apply_splat_budget(points,colors,radii,bad)

    def test_four_view_poses_timing_and_budget_preserve_each_camera(self):
        views=np.repeat(np.eye(4)[None],4,axis=0)
        views[:,0,3]=[0,-1,1,2]
        np.testing.assert_array_equal(camera_views({'views':views.tolist()}),views)
        spec={'cameras':[{'startRequestedMs':x} for x in [10,20,30,40]],'offsetsMs':[0,5,-5,10]}
        np.testing.assert_allclose(camera_offsets(spec),[0,.015,.015,.04])
        budget=profile_for_views(PROFILES['detailed'],4)
        self.assertEqual(budget['iterations']//4,PROFILES['detailed']['iterations']//2)
        self.assertIsNone(budget['max_points'])
        legacy=camera_views({'R':np.eye(3).tolist(),'t':[-1,0,0]})
        self.assertEqual(legacy.shape,(2,4,4));self.assertEqual(legacy[1,0,3],-1)
        im=np.arange(8*4*3).reshape(8,4,3);np.testing.assert_array_equal(crop_height(im,4),im[2:6])

    def test_visibility_keeps_occluded_geometry_but_rejects_free_space_conflicts(self):
        keep,confirmed,occluded=cross_view_visibility(np.array([3.,6.,1.,4.,3.]),np.array([3.,3.,3.,0.,3.]),np.array([True,True,True,True,False]),np.ones(5,dtype=bool))
        np.testing.assert_array_equal(keep,[True,True,False,True,True]);np.testing.assert_array_equal(confirmed,[True,False,False,False,False]);np.testing.assert_array_equal(occluded,[False,True,False,False,False])

    def test_image_scores_penalize_blur_missing_geometry_and_worst_camera(self):
        rng=np.random.default_rng(11);reference=rng.random((64,64,3),dtype=np.float32);ones=np.ones((64,64),np.float32)
        perfect=compare_images(reference,reference,ones);self.assertEqual(perfect['sourceViewScore'],100);self.assertTrue(perfect['sourceViewPass'])
        blurred=compare_images(reference,cv2.GaussianBlur(reference,(9,9),2),ones);self.assertLess(blurred['ssim'],perfect['ssim']);self.assertFalse(blurred['sourceViewPass'])
        empty=compare_images(reference,np.zeros_like(reference),np.zeros_like(ones));self.assertEqual(empty['sourceViewScore'],0)
        score=summarize([{'views':[perfect,empty]}]);self.assertEqual(score['sourceViewScore'],0);self.assertIsNone(score['realismScore']);self.assertFalse(score['novelViewValidated'])
        with self.assertRaises(ValueError):compare_images(reference,reference[:30],ones)

    def test_depth_mesh_does_not_bridge_depth_edges_or_invalid_pixels(self):
        yy,xx=np.mgrid[:12,:20];z=np.where(xx<10,3.,6.)
        xyz=np.stack([xx*.01,yy*.01,z],axis=-1);colors=np.ones_like(xyz)*.5;valid=np.ones_like(z,dtype=bool);valid[4:7,3:6]=False
        points,_,faces=depth_grid_mesh(xyz,colors,valid,z,stride=1)
        self.assertGreater(len(faces),200)
        self.assertTrue(np.all(np.ptp(points[faces,2],axis=1)==0))
        self.assertFalse(np.any((points[:,0]>=.03-1e-8)&(points[:,0]<=.05+1e-8)&(points[:,1]>=.04-1e-8)&(points[:,1]<=.06+1e-8)))

    def test_inspection_exports_are_real_mesh_and_exact_untrained_points(self):
        points=np.array([[0.,0,3],[.1,0,3],[0,.1,3]],np.float32);colors=np.array([[1.,0,0],[0,1.,0],[0,0,1.]],np.float32);faces=np.array([[0,2,1]],np.uint32)
        with tempfile.TemporaryDirectory() as temp:
            glb=Path(temp)/'mesh.glb';ply=Path(temp)/'seeds.ply'
            report=export_depth_glb(glb,[(points,colors,faces)]);export_seed_ply(ply,points,colors)
            raw=glb.read_bytes();magic,version,length=struct.unpack_from('<III',raw)
            self.assertEqual((magic,version,length),(0x46546C67,2,len(raw)));self.assertEqual(report['triangles'],1)
            size,kind=struct.unpack_from('<II',raw,12);self.assertEqual(kind,0x4E4F534A)
            model=json.loads(raw[20:20+size]);self.assertEqual(model['extras']['stage'],'before Gaussian optimization')
            start=20+size+8;accessor=model['accessors'][model['meshes'][0]['primitives'][0]['attributes']['POSITION']];view=model['bufferViews'][accessor['bufferView']]
            positions=np.frombuffer(raw[start+view['byteOffset']:start+view['byteOffset']+view['byteLength']],dtype='<f4').reshape(-1,3)
            np.testing.assert_array_equal(positions,points*[1,-1,-1])
            data=ply.read_bytes();offset=data.index(b'end_header\n')+len(b'end_header\n');vertices=np.frombuffer(data[offset:],dtype=[('xyz','<f4',3),('rgb','u1',3)])
            np.testing.assert_array_equal(vertices['xyz'],points*[1,-1,-1]);np.testing.assert_array_equal(vertices['rgb'],colors*255)

    def test_surface_guides_align_with_a_tilted_plane_but_reject_a_line(self):
        yy,xx=np.mgrid[-1:1:31j,-1:1:31j]
        points=np.column_stack((xx.ravel(),yy.ravel(),(3+.4*xx-.2*yy).ravel())).astype(np.float32)
        normals,quats,guided,confidence=estimate_surface_guides(points,np.full(len(points),.05))
        expected=np.array([-.4,.2,1]);expected/=np.linalg.norm(expected)
        self.assertGreater(guided.mean(),.9)
        self.assertGreater(np.min(np.abs(normals[guided]@expected)),.999)
        basis=Rotation.from_quat(quats[guided][:,[1,2,3,0]]).as_matrix()
        np.testing.assert_allclose(basis[:,:,2],normals[guided],atol=1e-6)
        line=np.column_stack((np.linspace(0,1,100),np.zeros(100),np.ones(100)))
        _,_,line_guides,_=estimate_surface_guides(line,np.full(100,.03))
        self.assertFalse(line_guides.any())

    def test_triangulation_recovers_known_geometry_and_rejects_mismatch(self):
        rng=np.random.default_rng(2)
        xyz=rng.uniform([-1,-.7,3],[1,.7,8],(200,3))
        K=np.array([[550.,0,320],[0,550,180],[0,0,1]])
        R=cv2.Rodrigues(np.array([0.,.15,0]))[0];t=np.array([[-.8],[.05],[0.]])
        a=xyz@K.T;a=a[:,:2]/a[:,2:]
        b=(xyz@R.T+t.ravel())@K.T;b=b[:,:2]/b[:,2:]
        result,valid,_,_=triangulate(a,b,K,R,t)
        self.assertTrue(valid.all());np.testing.assert_allclose(result,xyz,atol=1e-8)
        b[:,1]+=100
        _,bad,_,_=triangulate(a,b,K,R,t);self.assertLess(bad.sum(),5)

    def test_splat_export_has_positions_scales_colors_and_rotation(self):
        with tempfile.TemporaryDirectory() as temp:
            file=Path(temp)/'test.splat'
            xyz=np.array([[1.,2.,3.]],np.float32);scales=np.array([[.1,.2,.3]],np.float32)
            export_splat(file,[xyz,scales,np.array([[1.,0,0,0]]),np.array([[1.,.5,0]]),np.array([.8])])
            raw=file.read_bytes();self.assertEqual(len(raw),32)
            np.testing.assert_allclose(np.frombuffer(raw[:24],dtype='<f4'),[1,2,3,.1,.2,.3])
            self.assertEqual(list(raw[24:28]),[255,127,0,204]);self.assertEqual(list(raw[28:]),[255,128,128,128])

    def test_higher_profiles_do_more_actual_work(self):
        for key in ['width','fps','iterations']:
            self.assertLess(PROFILES['quick'][key],PROFILES['detailed'][key]);self.assertLess(PROFILES['detailed'][key],PROFILES['maximum'][key])
        for profile in PROFILES.values():
            for count in [2,4,10]:self.assertIsNone(profile_for_views(profile,count)['max_points'])

    def test_multiview_preserves_more_than_old_caps_and_exports_every_splat(self):
        # Exercise real fusion/visibility/deduplication with deterministic depth,
        # bypassing only model loading. Four shifted views of one planar surface.
        from multiview_geometry import MultiViewGeometry
        geometry=MultiViewGeometry.__new__(MultiViewGeometry)
        h,w=360,640
        images=[np.full((h,w,3),100,dtype=np.uint8) for _ in range(4)]
        depth=np.full((4,h,w),3.,dtype=np.float32)
        confidence=np.tile(np.linspace(1,2,w,dtype=np.float32),(4,h,1))
        views=np.repeat(np.eye(4)[None],4,axis=0);views[:,0,3]=[0,-.1,-.2,-.3]
        K=np.repeat(np.array([[500.,0,w/2],[0,500,h/2],[0,0,1]])[None],4,axis=0)
        geometry.reference=images;geometry.depth=depth;geometry.views=views;geometry.K=K;geometry.occlusion_aware=True
        geometry.predict=lambda _: (depth.copy(),confidence,views,K,1.)
        points,colors,radii,support=geometry.reconstruct(images)
        self.assertGreater(len(points),240000)
        self.assertEqual(len(points),support['initialGaussians'])
        self.assertEqual(len(support['support']),4)
        self.assertTrue(np.isfinite(points).all());self.assertTrue((radii>0).all())
        with tempfile.TemporaryDirectory() as temp:
            file=Path(temp)/'uncapped.splat'
            export_splat(file,[points,np.repeat(radii[:,None],3,axis=1),np.tile([1.,0,0,0],(len(points),1)),colors,np.ones(len(points))])
            self.assertEqual(file.stat().st_size,len(points)*32)
            data=np.fromfile(file,dtype=np.uint8).reshape(-1,32)
            xyz=data[:,:12].copy().view('<f4').reshape(-1,3)
            np.testing.assert_array_equal(xyz,points)


if __name__=='__main__':unittest.main()
