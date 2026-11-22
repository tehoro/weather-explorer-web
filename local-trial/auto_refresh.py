"""Background global Open Data preparation for the local trial, never per request.

Checks every ten minutes while the trial server runs. A completed run is published
only after all weather and native-pressure tiles pass validation. The preceding
run remains available during preparation and if a download/build fails.
"""
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
import argparse
import fcntl
import gzip
import json
import os
import shutil
import subprocess
import time
import numpy as np
import global_weather as weather
from prepare import write, ROOTS, CACHE_ROOT
from prepare_pressure import build as pressure_build
from prepare_coarse import build as coarse_build

START, END = 3, 84
STEPS = list(range(START, END+1, 3))
STATUS = weather.OUTPUT/'refresh-status.json'


def status(state, **details):
    write(STATUS, {'state':state, 'checked_at':datetime.now(timezone.utc).isoformat(), **details})


def published():
    try:return json.loads((weather.OUTPUT/'latest.json').read_text())['run']
    except FileNotFoundError:return ''


def candidates(now=None):
    now = now or datetime.now(timezone.utc)
    cycle = now.replace(hour=now.hour//6*6, minute=0, second=0, microsecond=0)
    return [(cycle-timedelta(hours=h)).strftime('%Y%m%d%H') for h in range(0, 73, 6)]


def probe(run, step, params):
    date = datetime.strptime(run, '%Y%m%d%H')
    rel = f'{date:%Y%m%d}/{date:%H}z/ifs/0p1/oper/{run}0000-{step}h-oper-fc-sfc.index'
    path = CACHE_ROOT/run/f'{step}-sfc.index'
    if path.exists():text=path.read_text()
    else:
        text = None;missing=False
        for root in ROOTS:
            r = subprocess.run(['curl','-fsSL','--connect-timeout','5','--max-time','15','-w','\n%{http_code}',root+'/'+rel],capture_output=True,text=True)
            body,_,code=r.stdout.rpartition('\n')
            if r.returncode==0 and code=='200':
                text=body;break
            missing=missing or code=='404'
        if text is None:
            if missing:return False
            raise RuntimeError('Could not check IFS availability on either public mirror')
    try:
        rows=[json.loads(line) for line in text.splitlines()]
        if not rows:return False
        for param in params:
            matches=[r for r in rows if r.get('param')==param and r.get('levtype')=='sfc']
            if len(matches)!=1:return False
            r=matches[0]
            if str(r.get('date'))!=run[:8] or int(r.get('time',-1))!=int(run[8:])*100 or int(r.get('step',-1))!=step:return False
            if int(r['_length'])<=0 or int(r['_offset'])<0:return False
    except (ValueError,KeyError,TypeError):return False
    if not path.exists():
        path.parent.mkdir(parents=True,exist_ok=True)
        tmp=path.with_suffix('.probe');tmp.write_text(text);tmp.replace(path)
    return True


def discover(current='', now=None):
    for run in candidates(now):
        if run<=current:break
        # Probe the end first, then every field/time needed by the finished package.
        if not probe(run,END,weather.PARAMS):continue
        if not probe(run,START-3,['tp','sf']):continue
        if all(probe(run,step,weather.PARAMS) for step in STEPS[:-1]):return run
    return None


def validate(root):
    meta=json.loads((root/'manifest.json').read_text())
    if meta['run']!=root.name or meta['steps']!=STEPS or meta.get('pressure_path')!='pressure':raise ValueError('Incomplete forecast manifest')
    if meta.get('global_preview',{}).get('width')!=361:raise ValueError('Missing global preview')
    field_bytes=sum(np.dtype(dtype).itemsize for _,dtype,_ in weather.FIELDS)
    for step in STEPS:
        if len(gzip.decompress((root/'global'/f'{step:03}.bin.gz').read_bytes()))!=361*181*field_bytes:raise ValueError('Invalid global preview')
        for y in range(18):
            for x in range(36):
                name=f'{x:02}-{y:02}.bin.gz'
                for res,n in [('fine',101),('coarse',11)]:
                    raw=gzip.decompress((root/f'{step:03}'/res/name).read_bytes())
                    if len(raw)!=n*n*field_bytes:raise ValueError('Invalid weather tile '+name)
                raw=gzip.decompress((root/'pressure'/f'{step:03}'/name).read_bytes())
                a=np.frombuffer(raw,dtype='<f4')
                if a.size!=10201 or not np.isfinite(a).all() or a.min()<800 or a.max()>1150:raise ValueError('Invalid pressure tile '+name)
    return meta


def prune_runs(keep):
    # Only completed, generated trial packages. Retain the previous run for
    # browsers still displaying it; caches can otherwise grow several GB/day.
    for root in weather.OUTPUT.iterdir():
        if not root.is_dir() or len(root.name)!=10 or not root.name.isdigit() or root.name in keep:continue
        if not (root/'manifest.json').exists():continue
        shutil.rmtree(root)
        raw=CACHE_ROOT/root.name
        if raw.is_dir():shutil.rmtree(raw)


def refresh():
    weather.OUTPUT.mkdir(parents=True,exist_ok=True)
    with (weather.OUTPUT/'refresh.lock').open('a') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:return
        current=published()
        try:
            status('checking',active_run=current)
            run=discover(current)
            if not run:
                status('current',active_run=current);return
            print('Preparing new IFS run '+run,flush=True)
            if shutil.disk_usage(weather.OUTPUT).free<4*1024**3:raise RuntimeError('At least 4 GiB free disk space is needed to prepare a new global run')
            def progress(done):status('preparing',active_run=current,run=run,completed=done,total=len(STEPS))
            weather.build(SimpleNamespace(run=run,start=START,end=END,publish=False,progress=progress))
            status('pressure',active_run=current,run=run)
            pressure_build(run)
            coarse_build(run)
            status('validating',active_run=current,run=run)
            validate(weather.OUTPUT/run)
            # Single atomic pointer change; readers can never discover a partial run.
            write(weather.OUTPUT/'latest.json',{'run':run,'manifest':run+'/manifest.json'})
            status('current',active_run=run)
            print('Published complete global run '+run,flush=True)
            prune_runs({run,current})
        except Exception as e:
            status('error',active_run=current,message=str(e));print('Refresh failed; retaining '+current+': '+str(e),flush=True)
            raise


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--watch',action='store_true');args=p.parse_args()
    os.nice(10)
    if args.watch:
        weather.OUTPUT.mkdir(parents=True,exist_ok=True)
        watcher=(weather.OUTPUT/'watch.lock').open('a')
        try:fcntl.flock(watcher,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise SystemExit(0)
    while True:
        try:refresh()
        except Exception:
            if not args.watch:raise
        if not args.watch:break
        time.sleep(600)
