import unittest
import numpy as np
from prepare_surface_cover import cover,snowline,neighbourhood
class SurfaceCover(unittest.TestCase):
 def test_masks_missing_and_positive_ice(self):
  snow,ice=cover(np.array([0,.02,.005,np.nan,0,0]),np.array([0,0,0,0,.001,np.nan]),np.array([1,1,1,1,0,0]))
  np.testing.assert_array_equal(snow,[0,254,127,255,0,0])
  np.testing.assert_array_equal(ice,[0,0,0,0,254,255])
 def test_sea_snow_does_not_whiten_land(self):
  snow,ice=cover(np.array([.02,.02]),np.array([2,2]),np.array([0,1]))
  np.testing.assert_array_equal(snow,[0,254]);np.testing.assert_array_equal(ice,[254,0])
 def test_snowline_requires_elevation_evidence(self):
  z=np.tile(np.linspace(0,3000,41),(41,1));land=np.ones_like(z)
  sd=np.where(z>1500,.02,0)
  line,weight=snowline(sd,land,z)
  self.assertGreater(weight[20,20],.5)
  self.assertAlmostEqual(line[20,20]/weight[20,20],1.5,delta=.2)
  for snow,height in [(np.ones_like(z)*.02,z),(np.zeros_like(z),z),(sd,np.ones_like(z)*100),(sd,3000-z)]:
   _,w=snowline(snow,land,height);self.assertEqual(w.max(),0)
 def test_neighbourhood_wraps_dateline(self):
  a=np.zeros((41,80));a[:,0]=1
  b=neighbourhood(a)
  self.assertGreater(b[20,-1],0)
  self.assertAlmostEqual(b[20,-1],b[20,1])
 def test_smoothing_is_symmetric_in_both_hemispheres(self):
  a=np.zeros((81,160));a[:,60:80]=1
  b=neighbourhood(a,1)
  np.testing.assert_allclose(b,b[::-1],atol=1e-12)
  self.assertTrue(np.any((b>0)&(b<1)))
if __name__=='__main__':unittest.main()
