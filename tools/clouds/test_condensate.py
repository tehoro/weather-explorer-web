import unittest
import numpy as np
from condensate import allocate
class AllocationTests(unittest.TestCase):
 def test_conserves_both_column_masses(self):
  density=np.array([[[0.,.2],[.4,.8],[.8,0.]]])
  preference=np.array([[[1.,1.],[.8,.5],[0.,0.]]])
  liquid=np.array([[.2,.3]]);ice=np.array([[.1,.4]])
  a,b=allocate(density,preference,liquid,ice,.2)
  np.testing.assert_allclose(a.sum(axis=1)*200,liquid)
  np.testing.assert_allclose(b.sum(axis=1)*200,ice)
  self.assertTrue(np.all(a[density==0]==0));self.assertTrue(np.all(b[density==0]==0))
  self.assertGreater(a[0,1,0],a[0,2,0]);self.assertGreater(b[0,2,0],b[0,1,0])
 def test_zero_cloud_does_not_invent_heights(self):
  a,b=allocate(np.zeros((1,3,1)),np.ones((1,3,1)),np.ones((1,1)),np.ones((1,1)),.2)
  self.assertFalse(a.any());self.assertFalse(b.any());self.assertTrue(np.isfinite(a+b).all())
 def test_unsupported_phase_uses_existing_cloud_only(self):
  d=np.array([[[0.],[.5],[1.]]])
  a,b=allocate(d,np.ones_like(d),np.array([[0.]]),np.array([[.2]]),.2)
  self.assertFalse(a.any());self.assertEqual(b[0,0,0],0)
  np.testing.assert_allclose(b.sum()*200,.2)
 def test_empty_columns_stay_transparent(self):
  a,b=allocate(np.ones((1,3,1)),np.ones((1,3,1))*.5,np.zeros((1,1)),np.zeros((1,1)),.2)
  self.assertFalse((a+b).any())
if __name__=='__main__':unittest.main()
