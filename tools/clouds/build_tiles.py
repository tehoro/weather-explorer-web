"""Offline global MSL cloud volumes; shared border nodes and filtered spatial LODs.
No per-view compute server. Called by prepare_clouds_r2.py.
"""
import gzip,json,time,shutil,os
from pathlib import Path
import numpy as np
HERE=Path(__file__).resolve().parent
OUT=HERE/'tiles-v1';V=128;TOP=20.;TILE=20
LEVELS=[.5,1.,2.]

def read_frame(path):
 raw=gzip.decompress(path.read_bytes());n=361*720;offset=0;out={}
 for name,dtype,count in [('cover','u1',15),('height','<i2',15),('pressure','<u2',15),('ground','<i2',1),('flags','u1',3),('target','u1',3)]:
  size=n*count*np.dtype(dtype).itemsize
  out[name]=np.frombuffer(raw[offset:offset+size],dtype=dtype).reshape(count,361,720)
  offset+=size
 assert offset==len(raw)
 return out

def band(z,lo,hi):return np.clip(np.minimum((z-lo)/.2,(hi-z)/.2),0,1)

def volume(f,regime):
 hs=f['height'].astype('f4')/1000;cs=f['cover'].astype('f4')/255
 ground=np.maximum(0,f['ground'][0].astype('f4')/1000)
 out=np.zeros((361,V,720,4),dtype='u1')
 for zi,z in enumerate(np.linspace(0,TOP,V)):
  density=np.zeros((361,720),dtype='f4');assigned=np.zeros((361,720),dtype=bool)
  for k in range(12):
   h=hs[k];prev=hs[k-1] if k else h-(hs[1]-h);nxt=hs[k+1] if k<11 else h+(h-hs[10])
   lo=np.maximum(ground,(prev+h)/2);hi=(h+nxt)/2
   mask=(z>=lo)&(z<=hi)&(hi>lo)&~assigned
   other=np.where(z<h,hs[max(0,k-1)],hs[min(11,k+1)])
   oc=np.where(z<h,cs[max(0,k-1)],cs[min(11,k+1)])
   w=np.minimum(.5,abs(z-h)/np.maximum(.001,abs(other-h)))
   c=cs[k]+(oc-cs[k])*w
   if k==0:c*=np.clip((z-lo)/.15,0,1)
   if k==11:c*=np.clip((hi-z)/.3,0,1)
   density=np.where(mask,c,density);assigned|=mask
  approx=np.zeros_like(density);fixed=np.zeros_like(density)
  for k,half in enumerate([.4,.8,1.2]):
   fallback=cs[12+k]*band(z,np.maximum(ground,hs[12+k]-half),hs[12+k]+half)
   approx=np.where(fallback>density,f['flags'][k],approx);density=np.maximum(density,fallback)
   fixed=np.maximum(fixed,f['target'][k]/255*band(z,ground+[.3,3,7][k],ground+[1.8,5.4,10.4][k]))
  # Do not bake the display terrain into clouds. Heights are MSL and the
  # renderer clips against the actual rendered terrain at its current resolution.
  out[:,zi,:,0]=np.rint(np.clip(density,0,1)*255)
  # Production has a browser-generated three-band fallback; omit comparison data.
  out[:,zi,:,1]=0
  out[:,zi,:,2]=np.rint(approx*255)
  out[:,zi,:,3]=regime
 # All longitudes meet at the pole; use a longitude mean there.
 out[0]=np.rint(out[0].mean(axis=1,keepdims=True));out[-1]=np.rint(out[-1].mean(axis=1,keepdims=True))
 return out

def coarse(a,stride):
 if stride==1:return a
 # Separable tent filter around the retained nodes: no hard nearest-neighbour LOD.
 weights=np.arange(1,stride+1).tolist()+np.arange(stride-1,0,-1).tolist()
 xs=np.arange(0,720,stride);ys=np.arange(0,361,stride)
 tmp=np.zeros((361,V,len(xs),4),dtype='f4')
 for d,w in zip(range(1-stride,stride),weights):tmp+=a[:,:,(xs+d)%720,:]*float(w)
 tmp/=sum(weights)
 out=np.zeros((len(ys),V,len(xs),4),dtype='f4')
 for d,w in zip(range(1-stride,stride),weights):out+=tmp[np.clip(ys+d,0,360)]*float(w)
 out=np.rint(out/sum(weights)).astype('u1')
 out[0]=np.rint(out[0].mean(axis=1,keepdims=True));out[-1]=np.rint(out[-1].mean(axis=1,keepdims=True))
 return out

def write_frame(run,step):
 directory=OUT/run/f'{step:03}';done=directory/'ready.json'
 if done.exists():return json.loads(done.read_text())
 if shutil.disk_usage(HERE).free<2_000_000_000:raise RuntimeError('Less than 2 GB free; stopping cloud tile build')
 start=time.monotonic();f=read_frame(HERE/'data'/run/f'{step:03}.bin.gz')
 regime=np.frombuffer(gzip.decompress((HERE/'data'/run/f'{step:03}.regime.gz').read_bytes()),dtype='u1').reshape(361,720)
 a=volume(f,regime);size=0;count=0
 for lod,res in enumerate(LEVELS):
  b=coarse(a,round(res/.5));side=round(TILE/res);nx=b.shape[2]
  folder=directory/str(lod);folder.mkdir(parents=True,exist_ok=True)
  for y in range(9):
   for x in range(18):
    tile=b[y*side:(y+1)*side+1,:,(np.arange(side+1)+x*side)%nx,:]
    payload=gzip.compress(tile.tobytes(),compresslevel=1,mtime=0)
    path=folder/f'{x}-{y}.bin.gz';tmp=path.with_suffix('.tmp');tmp.write_bytes(payload);tmp.replace(path)
    size+=len(payload);count+=1
 stats={'bytes':size,'tiles':count,'seconds':round(time.monotonic()-start,2)}
 done.write_text(json.dumps(stats));print(run,step,stats,flush=True);return stats
