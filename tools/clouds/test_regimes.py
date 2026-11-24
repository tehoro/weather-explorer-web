import unittest
import numpy as np
from regimes import morphology
class Regimes(unittest.TestCase):
 def test_guidance(self):
  z=np.arange(12,dtype=float)[:,None,None]*1000
  sp=np.array([[101000.]])
  stable=290-z*.004;unstable=290-z*.008
  a=lambda t,cp,tp:float(morphology(t,z,sp,np.array([[cp]]),np.array([[tp]]))[0,0])
  self.assertEqual(a(stable,0,0),0)
  self.assertGreater(a(unstable,0,0),.6)
  self.assertGreater(a(stable,1,1),a(stable,0,1))
  self.assertLessEqual(a(unstable,2,1),1)
 def test_subsurface(self):
  z=np.arange(12,dtype=float)[:,None,None]*1000;t=290-z*.004;t[0]=400
  score=morphology(t,z,np.array([[90000.]]),np.zeros((1,1)),np.zeros((1,1)))
  self.assertEqual(float(score[0,0]),0)
if __name__=='__main__':unittest.main()
