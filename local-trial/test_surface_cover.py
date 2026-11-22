import unittest
import numpy as np
from prepare_surface_cover import cover
class SurfaceCover(unittest.TestCase):
 def test_masks_missing_and_positive_ice(self):
  snow,ice=cover(np.array([0,.02,.005,np.nan,0,0]),np.array([0,0,0,0,.001,np.nan]),np.array([1,1,1,1,0,0]))
  np.testing.assert_array_equal(snow,[0,254,127,255,0,0])
  np.testing.assert_array_equal(ice,[0,0,0,0,254,255])
 def test_sea_snow_does_not_whiten_land(self):
  snow,ice=cover(np.array([.02,.02]),np.array([2,2]),np.array([0,1]))
  np.testing.assert_array_equal(snow,[0,254]);np.testing.assert_array_equal(ice,[254,0])
if __name__=='__main__':unittest.main()
