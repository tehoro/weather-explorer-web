"""Precompute named-place timelines from the same quantised 0.1° tiles as Local."""
import gzip
import json
import subprocess
import sys
from pathlib import Path
import numpy as np


def build(source, meta):
    catalogue = Path(__file__).resolve().parents[1] / 'local-trial/data/places'
    if not (catalogue/'manifest.json').exists():
        archive=Path('/tmp/weather-explorer-cities500.zip')
        subprocess.run(['curl','-fL','--retry','3','--max-time','180','https://download.geonames.org/export/dump/cities500.zip','-o',str(archive)],check=True)
        sys.path.insert(0,str(catalogue.parent.parent))
        from prepare_places import build as prepare
        prepare(archive,catalogue)
    overview={f'{p[2]:.5f}/{p[3]:.5f}' for p in json.loads((catalogue/'overview.json').read_text())}
    overview_rows={}
    groups = {}
    for path in catalogue.glob('[0-9][0-9]-[0-9][0-9].json'):
        for _, name, lat, lon, *_ in json.loads(path.read_text()):
            longitude = lon % 360
            x, y = int(longitude // 10), max(0, min(17, int((90-lat)//10)))
            groups.setdefault((x,y), []).append((lat,lon,longitude-x*10,90-y*10-lat))
    offset = 0
    for field in meta['fields']:
        if field['name'] == 'temperature':
            break
        offset += np.dtype(field['dtype']).itemsize * 10201
    target = source / 'place-temperatures-v1'
    target.mkdir(exist_ok=True)
    for (x,y), places in groups.items():
        col = np.clip(np.array([p[2] for p in places])*10,0,100)
        row = np.clip(np.array([p[3] for p in places])*10,0,100)
        i,j = np.minimum(col.astype(int),99),np.minimum(row.astype(int),99)
        u,v = col-i,row-j
        series = []
        for step in meta['steps']:
            raw = gzip.decompress((source/f'{step:03}/fine/{x:02}-{y:02}.bin.gz').read_bytes())
            a = np.frombuffer(raw,dtype=field['dtype'],count=10201,offset=offset).reshape(101,101).astype(np.float32)*field['scale']
            series.append(((a[j,i]*(1-u)+a[j,i+1]*u)*(1-v)+(a[j+1,i]*(1-u)+a[j+1,i+1]*u)*v).round(4).tolist())
        rows = {f'{p[0]:.5f}/{p[1]:.5f}': list(values) for p,values in zip(places,zip(*series))}
        overview_rows.update({k:v for k,v in rows.items() if k in overview})
        (target/f'{x:02}-{y:02}.json').write_text(json.dumps({'run':meta['run'],'steps':meta['steps'],'places':rows},separators=(',',':')))
    (target/'overview.json').write_text(json.dumps({'run':meta['run'],'steps':meta['steps'],'places':overview_rows},separators=(',',':')))
    meta['place_temperatures'] = 'place-temperatures-v1'
    print(f'Prepared temperature timelines for {sum(map(len,groups.values())):,} named places.')
    return meta
