import unittest
import numpy as np
from cloud_model import constrain,deck_peaks,reconstruct,LEVELS
class Clouds(unittest.TestCase):
 def test_decks_and_exact_coverage(self):
  rng=np.random.default_rng(7)
  w=rng.random((13,20,30)).astype('f4');w[w<.35]=0;w[0]=.7
  targets=rng.random((20,30)).astype('f4');targets[0]=0;targets[1]=1
  c,error=constrain(w,targets)
  self.assertLess(error,5e-5);self.assertTrue(np.all((c>=0)&(c<=1)))
  self.assertTrue(np.all(c[:,0]==0));self.assertTrue(np.all(c[w==0]==0))
 def test_separate_decks(self):
  w=np.array([.5,.8,0,.6,0],dtype='f4')[:,None,None]
  np.testing.assert_allclose(deck_peaks(w).ravel(),[0,.8,0,.6,0])
  c,error=constrain(w,np.array([[.8]],dtype='f4'))
  actual=1-(1-c[:2].max())*(1-c[3]);self.assertAlmostEqual(float(actual.item()),.8,places=5)
 def test_unresolved_cloud_and_below_ground(self):
  shape=(2,2);p=LEVELS[:,None,None];z=44330*(1-(p/1013.25)**.1903)
  a={'r':np.full((12,*shape),40,dtype='f4'),'t':np.full((12,*shape),270,dtype='f4'),'gh':np.broadcast_to(z,(12,*shape)).copy(),'sp':np.full(shape,80000,dtype='f4'),'2t':np.full(shape,275,dtype='f4'),'2d':np.full(shape,273,dtype='f4')}
  for band in ['lcc','mcc','hcc']:a[band]=np.full(shape,.8,dtype='f4')
  c,h,pressure,ground,flags,errors=reconstruct(a)
  self.assertTrue(np.all(c[:3]==0));self.assertTrue(np.all(flags==1));self.assertLess(max(errors),5e-5);self.assertTrue(np.all(h[12:]>ground))
  for band in ['lcc','mcc','hcc']:a[band][:]=0
  self.assertTrue(np.all(reconstruct(a)[0]==0))
if __name__=='__main__':unittest.main()
