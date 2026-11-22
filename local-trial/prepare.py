"""Prepare a private static IFS 0.1° trial, never used by the production workflow.

Range-download indexed messages once; crop both trial regions from each decode.
The raw GRIB cache can be reused for another area without downloading again.
All weather arrays run north to south, matching the Weather3D renderer.
"""
from __future__ import annotations
import argparse
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import threading
import time
import numpy as np
import eccodes

HERE = Path(__file__).resolve().parent
CACHE_ROOT = Path(os.environ.get('EXPLORE_GRIB_CACHE', '/private/tmp/weather-explorer-local-ifs-cache'))
ROOTS = ['https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com', 'https://data.ecmwf.int/forecasts']
LEVELS = [1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150, 100, 50]
REGIONS = {'otaki': [173.8, 176.8, -42., -39.8], 'alps': [166.5, 173.8, -46.4, -41.6]}
decode_lock = threading.Lock()

def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix+'.part')
    tmp.write_text(json.dumps(data, separators=(',', ':'), allow_nan=False))
    tmp.replace(path)

def download(url, path, byte_range=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix+'.part')
    cmd = ['curl', '-fsSL', '--retry', '3', '--max-time', '90']
    if byte_range: cmd += ['-H', 'Range: bytes='+byte_range]
    subprocess.run(cmd+[url, '-o', str(tmp)], check=True, capture_output=True)
    tmp.replace(path)

def array(a, decimals=2):
    return np.round(np.asarray(a,dtype=np.float64), decimals).ravel().tolist()

def build(args):
    started = time.monotonic()
    run = datetime.strptime(args.run, '%Y%m%d%H').replace(tzinfo=timezone.utc)
    out = Path(args.out).resolve() if args.out else HERE/'data'
    cache = CACHE_ROOT/args.run
    boxes = dict(REGIONS)
    if args.bounds:
        if not args.name or not args.name.replace('-', '').isalnum():
            raise ValueError('--bounds requires a simple --name')
        w,e,s,n = args.bounds
        if not -180 <= w < e <= 180 or not -85 <= s < n <= 85:
            raise ValueError('Use non-wrapping bounds west east south north within ±85°')
        boxes = {args.name: [w,e,s,n]}
    grids = {}
    for name,(w,e,s,n) in boxes.items():
        lons = np.linspace(w,e,round((e-w)*10)+1)
        lats = np.linspace(n,s,round((n-s)*10)+1)
        grids[name] = {'lons': lons, 'lats': lats, 'bounds': [w,e,s,n]}

    def field(step, param, level=None):
        suffix = 'pl' if level is not None else 'sfc'
        rel = f'{run:%Y%m%d}/{run:%H}z/ifs/0p1/oper/{args.run}0000-{step}h-oper-fc-{suffix}'
        idx = cache/f'{step}-{suffix}.index'
        # Index downloads occur serially before workers start.
        rows = [json.loads(line) for line in idx.read_text().splitlines()]
        match = [r for r in rows if r['param']==param and (level is None or str(r.get('levelist'))==str(level))]
        if len(match)!=1: raise ValueError(f'Expected one indexed {param}/{level}, found {len(match)}')
        row = match[0]; size = int(row['_length']); offset = int(row['_offset'])
        path = cache/f'{step}-{param}-{level or 0}.grib2'
        if not path.exists() or path.stat().st_size != size:
            for root in ROOTS:
                try:
                    download(root+'/'+rel+'.grib2', path, f'{offset}-{offset+size-1}')
                    if path.stat().st_size != size: raise ValueError('Range response length mismatch')
                    break
                except Exception:
                    if root==ROOTS[-1]: raise
        with decode_lock:
            gid = eccodes.codes_new_from_message(path.read_bytes())
            try:
                ni,nj = (eccodes.codes_get(gid,k) for k in ['Ni','Nj'])
                lat0,lon0,dx,dy = (eccodes.codes_get(gid,k) for k in ['latitudeOfFirstGridPointInDegrees','longitudeOfFirstGridPointInDegrees','iDirectionIncrementInDegrees','jDirectionIncrementInDegrees'])
                assert abs(dx-.1)<1e-5 and abs(dy-.1)<1e-5, 'Expected 0.1 degree data'
                assert not eccodes.codes_get(gid,'jScansPositively') and not eccodes.codes_get(gid,'iScansNegatively')
                v = eccodes.codes_get_values(gid).reshape(nj,ni).astype(np.float32)
                result = {}
                for name,g in grids.items():
                    ix = np.rint((g['lons']-lon0)/dx).astype(int)%ni
                    iy = np.rint((lat0-g['lats'])/dy).astype(int)
                    result[name] = v[np.ix_(iy,ix)].copy()
            finally: eccodes.codes_release(gid)
        return (param,level),result

    def indices(step, suffixes):
        for suffix in suffixes:
            idx=cache/f'{step}-{suffix}.index'
            if idx.exists(): continue
            rel=f'{run:%Y%m%d}/{run:%H}z/ifs/0p1/oper/{args.run}0000-{step}h-oper-fc-{suffix}.index'
            for root in ROOTS:
                try: download(root+'/'+rel,idx); break
                except Exception:
                    if root==ROOTS[-1]: raise

    def fields(step, specs):
        indices(step, sorted({'pl' if level else 'sfc' for param,level in specs}))
        with ThreadPoolExecutor(max_workers=8) as pool:
            return dict(pool.map(lambda spec:field(step,*spec),specs))

    previous = fields(args.start-3, [('tp',None),('sf',None)])
    metrics=[]
    for step in range(args.start,args.end+1,3):
        tick=time.monotonic()
        complete=all((out/'atmosphere'/'ifs'/args.run/name/f'hour-{step:03}.json').exists()
                     and (out/'ifs'/args.run/name/f'hour-{step:03}.json').exists()
                     and (out/'ifs'/args.run/name/'terrain.json').exists() for name in grids)
        if complete:
            for name in grids:
                path=out/'atmosphere'/'ifs'/args.run/name/f'hour-{step:03}.json'
                atmosphere=json.loads(path.read_text())
                if atmosphere['grid']['bounds']!=grids[name]['bounds'] or (args.clouds=='both' and not atmosphere['layers']):
                    break
            else:
                for name in grids:
                    path=out/'atmosphere'/'ifs'/args.run/name/f'hour-{step:03}.json'
                    atmosphere=json.loads(path.read_text())
                    write(path.with_name(f'cover-{step:03}.json'),atmosphere|{'layers':[]})
                previous=fields(step,[('tp',None),('sf',None)])
                metrics.append({'step':step,'cached':True,'seconds':round(time.monotonic()-tick,2)})
                print(f'+{step:03}h: reusing prepared frames',flush=True)
                continue
        specs=[(p,None) for p in ['10u','10v','2t','tp','sf','sp','msl','lsm','lcc','mcc','hcc']]
        specs += [('t',925)]
        specs += ([(p,lev) for lev in LEVELS for p in ['r','gh']]
                  if args.clouds=='both' else [('gh',925)])
        f=fields(step,specs)
        for name,g in grids.items():
            get=lambda p,l=None:f[p,l][name]
            w,e,s,n=g['bounds']; nx=len(g['lons']);ny=len(g['lats'])
            width=(e-w)*111.195*np.cos(np.deg2rad((s+n)/2));depth=(n-s)*111.195
            # Model surface height estimated hypsometrically; pressure masks are exact.
            orog=np.maximum(0,get('gh',925)+287.05*get('t',925)/9.80665*np.log(92500/get('sp')))
            if step==args.start:
                terrain={'nx':nx,'ny':ny,'width_km':width,'depth_km':depth,'bounds':g['bounds'],
                         'native_spacing_km':9,'height':array(orog),'land':array(get('lsm')),
                         'valid':[1]*(nx*ny),'note':'IFS 0.1° weather; model surface height estimated from 925 hPa height, temperature and surface pressure.'}
                reference=out/'reference'/f'{name}.json'
                ref=json.loads(reference.read_text()) if reference.exists() else None
                if ref is not None and ref['bounds']==g['bounds']:
                    # Resample the reference overview DEM onto the weather mesh. Adaptive
                    # tiles keep their original bounds and refine independently in the browser.
                    for src,dst in [('detail_height','detail_height'),('detail_land','detail_land')]:
                        a=np.array(ref[src]).reshape(ref['ny'],ref['nx'])
                        xs=np.linspace(0,ref['nx']-1,nx);ys=np.linspace(0,ref['ny']-1,ny)
                        row=np.array([np.interp(xs,np.arange(ref['nx']),v) for v in a])
                        sampled=np.array([np.interp(ys,np.arange(ref['ny']),row[:,i]) for i in range(nx)]).T
                        terrain[dst]=array(sampled)
                    terrain['coastlines']=ref.get('coastlines',[])
                else:
                    terrain['detail_height']=terrain['height'];terrain['detail_land']=terrain['land']
                write(out/'ifs'/args.run/name/'terrain.json',terrain)
            rain=np.maximum(0,(get('tp')-previous['tp',None][name])*1000/3)
            snow=np.minimum(rain,np.maximum(0,(get('sf')-previous['sf',None][name])*1000/3))
            # Snow is already a forecast water-equivalent rate, no guessed snow line.
            surface={'hour':step,'cycle':args.run,'u':array(get('10u')),'v':array(get('10v')),
                     'temperature':array(get('2t')-273.15),'precip':array(rain,3),'snow_water':array(snow,3),
                     'snow_level':[-1000]*(nx*ny),'fraction':[0]*(nx*ny)}
            write(out/'ifs'/args.run/name/f'hour-{step:03}.json',surface)
            grid={'nx':nx,'ny':ny,'width_km':width,'depth_km':depth,'bounds':g['bounds'],
                  'native_spacing_km':9,'x':np.linspace(-.5,.5,nx).tolist(),'y':np.linspace(-.5,.5,ny).tolist(),'valid':[1]*(nx*ny)}
            layers=[]
            for lev in (LEVELS if args.clouds=='both' else []):
                valid=get('sp')>=lev*100
                layers.append({'level':lev,'height':array(get('gh',lev),0),
                               'rh':[round(float(v),1) if ok else None for v,ok in zip(get('r',lev).ravel(),valid.ravel())]})
            atmosphere={'cycle':args.run,'hour':step,'grid':grid,'pressure':array(get('msl')/100),
                        'layers':layers,'terrain':array(orog),'cloud_cover':{p:array(np.clip(get(p),0,1),3) for p in ['lcc','mcc','hcc']},
                        'diagnostic':'Humidity volumes or schematic low/middle/high cloud cover; IFS 0.1° Open Data.'}
            write(out/'atmosphere'/'ifs'/args.run/name/f'hour-{step:03}.json',atmosphere)
            write(out/'atmosphere'/'ifs'/args.run/name/f'cover-{step:03}.json',atmosphere|{'layers':[]})
        previous=f
        metrics.append({'step':step,'seconds':round(time.monotonic()-tick,2)})
        print(f'{args.run} +{step:03}h: {len(grids)} region(s) ready ({metrics[-1]["seconds"]} s)',flush=True)
    timing={'initial_utc':run.isoformat(),'issue_local':datetime.now(timezone.utc).isoformat(),
            'display_end_local':(run+timedelta(hours=args.end)).isoformat(),'display_lead_hours':args.end,
            'start_hour':args.start,'step_hours':3}
    write(out/'manifest.json',{'published':{'cycle':args.run,'timing':timing,'data_version':'ifs','atmosphere_version':'ifs','clouds':args.clouds},'regions':boxes})
    size=sum(p.stat().st_size for p in cache.glob('*.grib2'))
    write(out/'build-report.json',{'run':args.run,'levels':LEVELS if args.clouds=='both' else [],'clouds':args.clouds,'regions':boxes,'frames':metrics,
          'elapsed_seconds':round(time.monotonic()-started,2),'cached_grib_bytes':size,'cache_directory':str(cache)})
    print(f'Complete. Cached GRIB: {size/1e6:.1f} MB; elapsed {time.monotonic()-started:.1f} s',flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--run',required=True);p.add_argument('--start',type=int,default=12);p.add_argument('--end',type=int,default=84)
    p.add_argument('--name');p.add_argument('--bounds',nargs=4,type=float,metavar=('WEST','EAST','SOUTH','NORTH'))
    p.add_argument('--clouds',choices=['both','cover'],default='both',help='cover omits the vertical humidity fields')
    p.add_argument('--out',help='Alternative local output directory')
    args=p.parse_args()
    if args.start<3 or args.end>144 or args.start%3 or args.end%3 or args.end<args.start:p.error('Use 3-hour steps, 3 <= start <= end <= 144')
    build(args)
