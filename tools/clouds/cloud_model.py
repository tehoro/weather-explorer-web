"""Illustrative globally shared RH placement, constrained by IFS band cover.
Maximum overlap within contiguous decks; random overlap between separated decks.
No region/country coefficients. Regime nudges are heuristics, not newly fitted physics.
"""
import gzip,json,time,os
from pathlib import Path
import numpy as np
LEVELS=np.array([1000,925,850,700,600,500,400,300,250,200,150,100],dtype='f4')
def smooth(x):
 x=np.clip(x,0,1);return x*x*(3-2*x)
def deck_peaks(w,gap=.025):
 peak=np.zeros_like(w[0]);out=np.zeros_like(w)
 for k in range(len(w)):
  peak=np.maximum(peak,w[k]);end=(w[k+1]<=gap) if k+1<len(w) else np.ones_like(peak,dtype=bool)
  out[k]=np.where(end,peak,0);peak=np.where(end,0,peak)
 return out

def constrain(w,target):
 peak=np.maximum(w.max(axis=0),1e-12);w=w/peak
 # Very small weights are dry gaps for both reconstruction and verification.
 w=np.where(w>.025,w,0)
 decks=deck_peaks(w);lo=np.zeros_like(target);hi=np.ones_like(target)
 for _ in range(17):
  mid=(lo+hi)*.5;cover=1-np.prod(1-decks*mid,axis=0)
  lo=np.where(cover<target,mid,lo);hi=np.where(cover>=target,mid,hi)
 scale=np.where(target>=1,1,np.where(target<=0,0,(lo+hi)*.5))
 out=w*scale;actual=1-np.prod(1-decks*scale,axis=0)
 return out,float(np.max(abs(actual-target)))

def reconstruct(a):
 r,t,z=a['r'],a['t'],a['gh']/1000;sp=a['sp']/100
 ratio=LEVELS[:,None,None]/sp;valid=LEVELS[:,None,None]<=sp
 # Ground estimate from nearest valid pressure level and hydrostatic relation.
 k=np.argmax(valid,axis=0);near=lambda x:np.take_along_axis(x,k[None],axis=0)[0]
 ground=np.maximum(0,near(z)+.02927*near(t)*np.log(near(np.broadcast_to(LEVELS[:,None,None],r.shape))/sp))
 if 'orography' in a:ground=np.maximum(0,a['orography']/1000)
 base=np.clip(.125*np.maximum(0,a['2t']-a['2d']),.12,1.2)
 lowheight=ground+base+.18
 lowpressure=np.maximum(sp*.801,sp*np.exp(-(base+.18)/(.02927*a['2t'])))
 lowheight=ground+.02927*a['2t']*np.log(sp/lowpressure)
 # Lowest-level inversion: continuously weight shallow moisture beneath a warm cap.
 inversion=smooth((t[1]-t[0])/5)*valid[0]*valid[1]
 bounds=[ratio>.8,(ratio<=.8)&(ratio>.45),ratio<=.45]
 allc=np.zeros((15,*sp.shape),dtype='f4');heights=np.concatenate([z,np.zeros((3,*sp.shape),dtype='f4')]);pressures=np.concatenate([np.broadcast_to(LEVELS[:,None,None],r.shape),np.zeros((3,*sp.shape),dtype='f4')]);flags=np.zeros((3,*sp.shape),dtype='u1');errors=[]
 for b,name in enumerate(['lcc','mcc','hcc']):
  # Pooled cap100 baseline: RH85–100 low/middle,90–100 high.
  threshold=[85,85,90][b]
  # Cold upper-level humidity and warm capped boundary layers get mild continuous adjustments.
  cold=smooth((253-t)/20)
  lower=threshold+(2*cold if b==2 else 0)
  w=smooth((r-lower)/(100-lower))*valid*bounds[b]
  if b==0:w[:2]*=1+.25*inversion
  weak=w.max(axis=0)<.05
  target=np.clip(a[name],0,1)
  fallback=weak&(target>.001);flags[b]=fallback
  # Use moistest valid level when present; otherwise represent an unresolved layer.
  if b==0:
   # A synthetic low level fills the sparse surface-to-925 hPa gap only when unresolved.
   fh=lowheight;fp=lowpressure
  else:
   supported=valid&bounds[b]
   wettest=np.argmax(np.where(supported,r,-1e9),axis=0)
   fp=np.take_along_axis(np.broadcast_to(LEVELS[:,None,None],r.shape),wettest[None],axis=0)[0]
   fh=np.take_along_axis(z,wettest[None],axis=0)[0]
   fh=np.maximum(fh,ground+.3)
  heights[12+b]=fh;pressures[12+b]=fp
  # Resolve the humidity-supported profile, or clearly flagged approximate fallback.
  w=np.where(fallback[None],0,w)
  extended=np.concatenate([w,fallback[None].astype('f4')])
  c,error=constrain(extended,target);allc[:12]+=c[:12];allc[12+b]=c[12];errors.append(error)
 return allc,heights,pressures,ground,flags,errors

def build_frame(run,step,input_path,outroot):
 out=Path(outroot)/'data'/run;out.mkdir(parents=True,exist_ok=True)
 dest=out/f'{step:03}.bin.gz';stat=out/f'{step:03}.json'
 if dest.exists() and stat.exists():
  old=json.loads(stat.read_text())
  if old.get('model_version')==2:return old
 started=time.perf_counter();a=dict(np.load(input_path))
 orography=Path(os.environ.get('EXPLORE_CLOUD_CACHE','/tmp/explore-cloud-inputs'))/f'{run}-0-z-0.npy'
 if orography.exists():a['orography']=np.load(orography)/9.80665
 c,z,p,ground,flags,errors=reconstruct(a)
 cq=np.where(c>0,np.maximum(1,np.rint(c*255)),0).astype('u1');zq=np.rint(np.clip(z,-1,32)*1000).astype('<i2');pq=np.rint(p).astype('<u2');gq=np.rint(np.clip(ground,-1,32)*1000).astype('<i2')
 target=np.rint(np.stack([a[n] for n in ['lcc','mcc','hcc']])*255).astype('u1')
 raw=cq.tobytes()+zq.tobytes()+pq.tobytes()+gq.tobytes()+flags.tobytes()+target.tobytes()
 tmp=dest.with_suffix('.part');tmp.write_bytes(gzip.compress(raw,compresslevel=5,mtime=0));tmp.replace(dest)
 quant_errors=[]
 ratio=LEVELS[:,None,None]/(a['sp']/100)
 masks=[ratio>.8,(ratio<=.8)&(ratio>.45),ratio<=.45]
 for b,name in enumerate(['lcc','mcc','hcc']):
  q=np.concatenate([cq[:12]/255*masks[b],cq[12+b:13+b]/255])
  restored=1-np.prod(1-deck_peaks(q,gap=0),axis=0)
  quant_errors.append(float(np.max(abs(restored-a[name]))))
 assert max(quant_errors)<.012,quant_errors
 stats={'model_version':2,'max_cover_error_after_quantisation':max(quant_errors),'actual_model_orography':orography.exists(),'run':run,'step':step,'max_cover_error_before_quantisation':max(errors),'fallback_fraction_by_band':[round(float(x.mean()),4) for x in flags],'seconds':round(time.perf_counter()-started,2),'bytes':dest.stat().st_size}
 stat.write_text(json.dumps(stats));return stats
