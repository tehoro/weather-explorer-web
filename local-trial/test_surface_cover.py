import unittest
import numpy as np
from prepare_surface_cover import cover,snowline,neighbourhood,regional_snowline
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
 def test_regional_requires_several_agreeing_donors_and_tracks_change(self):
  # Half-degree synthetic world: donors around the equator and dateline.
  w=np.zeros((361,720));line=np.zeros_like(w);land=np.ones_like(w)
  for y,x in [(179,719),(180,0),(181,1)]:w[y,x]=1;line[y,x]=1.5
  result,weight=regional_snowline(line,w,land,stride=1)
  self.assertGreater(weight[180,719],0)
  self.assertAlmostEqual(result[180,719]/weight[180,719],1.5)
  self.assertEqual(weight[180,30],0) # Outside the 300 km search.
  fresh,_=regional_snowline(line*.6,w,land,stride=1)
  self.assertAlmostEqual(fresh[180,719]/weight[180,719],.9)
  line[181,1]=3.5
  _,conflict=regional_snowline(line,w,land,stride=1)
  self.assertEqual(conflict[180,719],0)
  w[181,1]=0
  _,sparse=regional_snowline(line,w,land,stride=1)
  self.assertEqual(sparse.max(),0)
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

class NzFallback(unittest.TestCase):
 def test_nz_scope_priority_and_latitude(self):
  from prepare_surface_cover import apply_nz_fallback
  shape=(181,360);zero=np.zeros(shape);land=np.ones(shape)
  result,w=apply_nz_fallback(zero,zero,land,zero,zero,1.4)
  self.assertGreater(w[129,175],0)
  self.assertAlmostEqual(result[129,175]/w[129,175],2.3)
  self.assertAlmostEqual(result[132,173]/w[132,173],1.85)
  self.assertEqual(w[44,8],0)
  strong=np.ones(shape)*.7;prior=strong*1.8
  r,ww=apply_nz_fallback(prior,strong,land,zero,zero,1.4)
  np.testing.assert_array_equal(r,prior);np.testing.assert_array_equal(ww,strong)
  r,ww=apply_nz_fallback(zero,zero,land,zero,zero,None)
  self.assertEqual(ww.max(),0)
 def test_reference_requires_separate_supported_areas(self):
  from prepare_surface_cover import nz_reference,smooth_nz_references
  w=np.zeros((361,720));line=np.zeros_like(w)
  self.assertIsNone(nz_reference(line,w))
  for y,x in [(269,337),(269,338),(270,338)]:w[y,x]=1;line[y,x]=1.5
  self.assertIsNotNone(nz_reference(line,w))
  smooth=smooth_nz_references([1,2,2,None,1.5],[3,6,9,12,15])
  self.assertAlmostEqual(smooth[1],1.1);self.assertAlmostEqual(smooth[2],1.2)
  self.assertIsNone(smooth[3]);self.assertEqual(smooth[4],1.5)

if __name__=='__main__':unittest.main()
