"""Explore optional cloud input acquisition.
Indexed range downloads; raw GRIB discarded after sampling to 0.5 degrees.
"""
import concurrent.futures as cf, json, subprocess, time, threading, os
from pathlib import Path
import numpy as np, eccodes
HERE=Path(__file__).resolve().parent
CACHE=Path(os.environ.get('EXPLORE_CLOUD_CACHE','/tmp/explore-cloud-inputs'));CACHE.mkdir(exist_ok=True)
# Prefer the AWS Open Data mirror; fall back to ECMWF on failures.
ROOTS=['https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com','https://data.ecmwf.int/forecasts']
LEVELS=[1000,925,850,700,600,500,400,300,250,200,150,100]
LOCK=threading.Lock()
def get(url,extra=[]):
 p=subprocess.run(['curl','-fsSL','--retry','2','--connect-timeout','15','--max-time','100',*extra,url],capture_output=True)
 if p.returncode: raise RuntimeError(p.stderr.decode()[-250:])
 return p.stdout
def index(run,step,surface=False):
 res,suffix=('0p1','-sfc') if surface else ('0p25','')
 rel=f'{run[:8]}/{run[8:]}z/ifs/{res}/oper/{run}0000-{step}h-oper-fc{suffix}'
 path=CACHE/f'{run}-{step}-{res}.json'
 if path.exists():return rel,json.loads(path.read_text())
 for root in ROOTS:
  try:
   rows=[json.loads(x) for x in get(root+'/'+rel+'.index').decode().splitlines()];path.write_text(json.dumps(rows));return rel,rows
  except Exception:
   if root==ROOTS[-1]:raise

def field(task):
 run,step,param,level,rel,row=task;path=CACHE/f'{run}-{step}-{param}-{level}.npy'
 if path.exists():
  try:return param,level,np.load(path)
  except Exception:path.rename(path.with_suffix('.incomplete'))
 offset,size=int(row['_offset']),int(row['_length'])
 for attempt in range(3):
  for root in ROOTS:
   try:
    raw=get(root+'/'+rel+'.grib2',['-H',f'Range: bytes={offset}-{offset+size-1}']);assert len(raw)==size
    break
   except Exception:
    if root==ROOTS[-1] and attempt==2:raise
  else:continue
  break
 with LOCK:
  g=eccodes.codes_new_from_message(raw)
  try:
   ni,nj=[eccodes.codes_get(g,k) for k in ['Ni','Nj']];dx=eccodes.codes_get(g,'iDirectionIncrementInDegrees');dy=eccodes.codes_get(g,'jDirectionIncrementInDegrees')
   lon0=eccodes.codes_get(g,'longitudeOfFirstGridPointInDegrees');lat0=eccodes.codes_get(g,'latitudeOfFirstGridPointInDegrees')
   assert not eccodes.codes_get(g,'jScansPositively') and not eccodes.codes_get(g,'iScansNegatively')
   a=eccodes.codes_get_values(g).reshape(nj,ni)
   x=np.rint((np.arange(0,360,.5)-lon0)/dx).astype(int)%ni;y=np.rint((lat0-np.arange(90,-90.1,-.5))/dy).astype(int)
   a=a[np.ix_(y,x)].astype('f4');assert np.isfinite(a).all() and np.max(abs(a))<1e10
   tmp=path.with_suffix('.part.npy');np.save(tmp,a);tmp.replace(path)
  finally:eccodes.codes_release(g)
 return param,level,a
