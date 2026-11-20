"""Cache original public GLO-90 COGs locally for browser loading experiments.

No upload or terrain transformation. --point LAT LON may be repeated worldwide.
Ocean tiles are distinguished using the upstream catalogue, not HTTP errors.
"""
import argparse
import json
import math
from pathlib import Path
import subprocess
import time

ROOT='https://copernicus-dem-90m.s3.amazonaws.com'
OUT=Path('/private/tmp/weather-explorer-dem')

def name(lat,lon):
    if not -90<=lat<90:raise ValueError('Latitude must be in [-90,90)')
    lat=math.floor(lat);lon=math.floor((lon+180)%360-180)
    return f'Copernicus_DSM_COG_30_{"N" if lat>=0 else "S"}{abs(lat):02}_00_{"E" if lon>=0 else "W"}{abs(lon):03}_00_DEM'

def fetch(url,path):
    if path.exists():return
    tmp=path.with_suffix('.part')
    subprocess.run(['curl','-fsSL','--retry','2','--max-time','120',url,'-o',str(tmp)],check=True)
    tmp.replace(path)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--point',nargs=2,type=float,action='append',required=True);a=p.parse_args()
    OUT.mkdir(exist_ok=True);fetch(ROOT+'/tileList.txt',OUT/'tileList.txt')
    catalogue=set((OUT/'tileList.txt').read_text().split())
    reports=[]
    for lat,lon in a.point:
        tile=name(lat,lon);t=time.monotonic();path=OUT/(tile+'.tif');cached=path.exists()
        exists=tile in catalogue or tile+'/' in catalogue
        if exists:fetch(f'{ROOT}/{tile}/{tile}.tif',path)
        report={'point':[lat,lon],'tile':tile,'ocean':not exists,'bytes':path.stat().st_size if exists else 0,'cached':cached,'seconds':round(time.monotonic()-t,3)}
        reports.append(report);print(json.dumps(report),flush=True)
    (OUT/'benchmark.json').write_text(json.dumps(reports,indent=2))
