import sys
import unittest
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
from temporal_geometry import stationary_mask, depth_interior, confirmed_surface


class TemporalGeometryTests(unittest.TestCase):
    def test_confirmation_rejects_single_view_and_free_space_conflicts(self):
        np.testing.assert_array_equal(confirmed_surface(np.array([0, 1, 2, 1]), np.array([0, 0, 1, 2])), [False, True, False, False])

    def test_anchor_does_not_freeze_motion_or_occlusion(self):
        reference=np.full((20,20,3),100,np.uint8)
        image=reference.copy();image[8:12,8:12]=200
        depth=np.full((20,20),3.,np.float32)
        confidence=np.full((20,20),5.);confidence[:5]=1
        current=depth.copy();current[8:12,14:18]=2.
        stable=np.ones((20,20),bool);stable[16:]=False
        mask=stationary_mask(image,reference,depth,current,confidence,stable)
        self.assertTrue(mask[8,3])
        self.assertFalse(mask[9,9])
        self.assertFalse(mask[9,15])
        self.assertFalse(mask[17,3])
        self.assertFalse(mask[7,9])  # silhouette margin

    def test_depth_edges_and_invalid_depth_are_excluded(self):
        depth=np.full((12,12),3.,np.float32);depth[:,6:]=6.;depth[2,2]=np.nan
        mask=depth_interior(depth)
        self.assertTrue(mask[8,2]);self.assertTrue(mask[8,9])
        self.assertFalse(mask[:,5:7].any());self.assertFalse(mask[1:4,1:4].any())


if __name__=='__main__':unittest.main()
