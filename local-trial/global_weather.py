"""Benchmark a complete global, static IFS 0.1° surface/cloud-cover tile set.

10° tiles include their eastern/southern edge: adjacent tiles share samples,
longitude wraps at 360°, and the poles are retained. Each gzip payload contains
field-major little-endian arrays described in manifest.json. No humidity levels.
Outputs and reusable GRIBs stay outside Dropbox. Nothing is uploaded.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import gzip
import json
from pathlib import Path
import time
import numpy as np
import eccodes
from prepare import CACHE_ROOT, ROOTS, download, write

OUTPUT=Path('/private/tmp/weather-explorer-global')
PARAMS=['10u','10v','2t','msl','tp','sf','lcc','mcc','hcc']
FIELDS=[('u','<i2',.1),('v','<i2',.1),('temperature','<i2',.1),
        ('pressure','<u2',.1),('rain','<u2',.001),('snow','<u2',.001),
        ('low','u1',1/255),('middle','u1',1/255),('high','u1',1/255)]

def index(run,step):
    d=datetime.strptime(run,'%Y%m%d%H')
    rel=f'{d:%Y%m%d}/{d:%H}z/ifs/0p1/oper/{run}0000-{step}h-oper-fc-sfc'
    path=CACHE_ROOT/run/f'{step}-sfc.index'
    if not path.exists():
        for root in ROOTS:
            try:download(root+'/'+rel+'.index',path);break
            except Exception:
                if root==ROOTS[-1]:raise
    return rel,[json.loads(x) for x in path.read_text().splitlines()]

def fetch(run,step,param,rel,rows):
    rows=[r for r in rows if r['param']==param and r['levtype']=='sfc']
    if len(rows)!=1:raise ValueError(f'Missing/ambiguous indexed field {param} at {step}')
    row=rows[0];size=row['_length'];offset=row['_offset']
    path=CACHE_ROOT/run/f'{step}-{param}-0.grib2';new=0;t=time.monotonic()
    if not path.exists() or path.stat().st_size!=size:
        for root in ROOTS:
            try:
                download(root+'/'+rel+'.grib2',path,f'{offset}-{offset+size-1}')
                if path.stat().st_size!=size:raise ValueError('Range response length mismatch')
                new=size;break
            except Exception:
                if root==ROOTS[-1]:raise
    return param,path,{'param':param,'bytes':size,'new_bytes':new,'fetch_seconds':time.monotonic()-t}

def decode(path):
    gid=eccodes.codes_new_from_message(path.read_bytes())
    try:
        assert eccodes.codes_get(gid,'Ni')==3600 and eccodes.codes_get(gid,'Nj')==1801
        assert eccodes.codes_get(gid,'latitudeOfFirstGridPointInDegrees')==90
        lon0=eccodes.codes_get(gid,'longitudeOfFirstGridPointInDegrees')
        assert abs(lon0*10-round(lon0*10))<1e-5
        assert abs(eccodes.codes_get(gid,'iDirectionIncrementInDegrees')-.1)<1e-6
        assert not eccodes.codes_get(gid,'jScansPositively')
        assert not eccodes.codes_get(gid,'iScansNegatively')
        a=eccodes.codes_get_values(gid).reshape(1801,3600).astype(np.float32)
        if not np.isfinite(a).all() or np.max(np.abs(a))>1e10:raise ValueError('Missing/nonfinite GRIB values')
        # ECMWF's regular grid can start at 180°; normalise to 0° without interpolation.
        return np.roll(a,round(lon0*10)%3600,axis=1)
    finally:eccodes.codes_release(gid)

def fetch_fields(run,step,params):
    rel,rows=index(run,step)
    with ThreadPoolExecutor(max_workers=8) as pool:
        result=list(pool.map(lambda p:fetch(run,step,p,rel,rows),params))
    return result

def quantise(f,previous):
    rain=np.maximum(0,(f['tp']-previous['tp'])*1000/3)
    snow=np.minimum(rain,np.maximum(0,(f['sf']-previous['sf'])*1000/3))
    raw={'u':f['10u'],'v':f['10v'],'temperature':f['2t']-273.15,'pressure':f['msl']/100,
         'rain':np.sqrt(rain),'snow':np.sqrt(snow),'low':f['lcc'],'middle':f['mcc'],'high':f['hcc']}
    packed={};errors={}
    for name,dtype,scale in FIELDS:
        value=raw[name];limits=np.iinfo(dtype)
        q=np.rint(value/scale)
        if q.min()<limits.min or q.max()>limits.max:raise ValueError(f'{name}: quantisation would clip data')
        packed[name]=q.astype(dtype)
        restored=packed[name].astype(np.float32)*scale
        errors[name]=float(np.max(np.abs(restored-value)))
    return packed,errors

def tile_bytes(fields,x,y,stride=1):
    # x=0 starts at 0°E; x=35's last column is exactly the same as x=0's first.
    ix=np.arange(x*100,x*100+101,stride)%3600
    iy=np.arange(y*100,y*100+101,stride)
    return b''.join(np.ascontiguousarray(fields[name][np.ix_(iy,ix)]).tobytes() for name,_,_ in FIELDS)

def build(args):
    began=time.monotonic();out=OUTPUT/args.run;frames=[];source_bytes=0;new_bytes=0
    initial=fetch_fields(args.run,args.start-3,['tp','sf'])
    previous={p:decode(path) for p,path,m in initial}
    source_bytes+=sum(m['bytes'] for p,path,m in initial);new_bytes+=sum(m['new_bytes'] for p,path,m in initial)
    for step in range(args.start,args.end+1,3):
        tick=time.monotonic();frame_dir=out/f'{step:03}';report=frame_dir/'report.json'
        inputs=fetch_fields(args.run,step,PARAMS)
        source_bytes+=sum(m['bytes'] for p,path,m in inputs);new_bytes+=sum(m['new_bytes'] for p,path,m in inputs)
        if report.exists():
            frames.append(json.loads(report.read_text()))
            previous={p:decode(path) for p,path,m in inputs if p in ('tp','sf')}
            print(f'+{step:03}h: reusing completed global tiles',flush=True);continue
        fetched=time.monotonic();f={p:decode(path) for p,path,m in inputs};decoded=time.monotonic()
        packed,errors=quantise(f,previous);previous={p:f[p] for p in ['tp','sf']};del f
        encoded=time.monotonic()
        for res in ['fine','coarse']:(frame_dir/res).mkdir(parents=True,exist_ok=True)
        def save_tile(xy):
            x,y=xy;counts={}
            for res,stride in [('fine',1),('coarse',10)]:
                raw=tile_bytes(packed,x,y,stride);blob=gzip.compress(raw,compresslevel=4,mtime=0)
                path=frame_dir/res/f'{x:02}-{y:02}.bin.gz';tmp=path.with_suffix('.part');tmp.write_bytes(blob);tmp.replace(path)
                counts[res]=len(blob)
            return counts
        with ThreadPoolExecutor(max_workers=8) as pool:
            sizes=list(pool.map(save_tile,[(x,y) for y in range(18) for x in range(36)]))
        data={'step':step,'seconds':round(time.monotonic()-tick,3),'fetch_seconds':round(fetched-tick,3),
              'decode_seconds':round(decoded-fetched,3),'quantise_seconds':round(encoded-decoded,3),
              'tile_seconds':round(time.monotonic()-encoded,3),'fine_bytes':sum(s['fine'] for s in sizes),
              'coarse_bytes':sum(s['coarse'] for s in sizes),'max_quantisation_error':errors}
        write(report,data);frames.append(data);del packed
        print(f'+{step:03}h: global tiles {data["fine_bytes"]/1e6:.2f} MB, {data["seconds"]:.1f}s',flush=True)
    run=datetime.strptime(args.run,'%Y%m%d%H').replace(tzinfo=timezone.utc)
    manifest={'format':1,'run':args.run,'initial_utc':run.isoformat(),'steps':list(range(args.start,args.end+1,3)),
              'times':[(run+timedelta(hours=s)).isoformat() for s in range(args.start,args.end+1,3)],
              'tile_degrees':10,'tiles_x':36,'tiles_y':18,'origin':[0,90],
              'resolutions':{'fine':{'spacing':.1,'size':101},'coarse':{'spacing':1.,'size':11,'method':'nearest native sample; preview only'}},
              'fields':[{'name':n,'dtype':d,'scale':s,'transform':'square' if n in ('rain','snow') else 'linear'} for n,d,s in FIELDS],
              'attribution':'Data: © 2026 ECMWF, CC BY 4.0. Regridded and unit-converted.'}
    write(out/'manifest.json',manifest)
    report={'run':args.run,'frames':frames,'source_bytes':source_bytes,'downloaded_this_build_bytes':new_bytes,
            'fine_bytes':sum(f['fine_bytes'] for f in frames),'coarse_bytes':sum(f['coarse_bytes'] for f in frames),
            'elapsed_seconds':round(time.monotonic()-began,3),'cache_note':'Existing raw GRIB cache reused where available; download time is not a cold-start benchmark.'}
    write(out/'benchmark.json',report);write(OUTPUT/'latest.json',{'run':args.run,'manifest':args.run+'/manifest.json'})
    print(json.dumps({k:v for k,v in report.items() if k!='frames'},indent=2),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--run',required=True)
    p.add_argument('--start',type=int,default=12);p.add_argument('--end',type=int,default=84);args=p.parse_args()
    if args.start<3 or args.end>144 or args.start%3 or args.end%3 or args.start>args.end:p.error('Use 3-hour steps from 3 to 144')
    build(args)
