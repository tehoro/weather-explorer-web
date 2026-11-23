"""Repair isolated NZ reference gaps in the current run using official IFS fields.

Write a new immutable cover namespace and manifest before updating latest.
Unaffected surface frames are copied unchanged; weather and local evidence stay intact.
Uses the same serialised publisher workflow as normal forecast updates.
"""
import gzip
import json
import os
from pathlib import Path
import sys
import boto3
from publish_explore_r2 import PREFIX, read_json
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'local-trial'))
from prepare_surface_cover import OUTPUT, PATH, bridge_nz_references, build
from prepare import write

client=boto3.client('s3',endpoint_url=os.environ['R2_ENDPOINT'],region_name='auto',aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'])
bucket=os.environ['R2_BUCKET']
latest=read_json(client,bucket,PREFIX+'latest.json')
meta=read_json(client,bucket,PREFIX+latest['manifest'])
steps=meta['steps'];info=meta['surface_cover'];raw=[info['nz_reference_km'][str(s)] for s in steps]
fixed=bridge_nz_references(raw,steps)
changed=[s for s,a,b in zip(steps,raw,fixed) if a!=b]
if not changed:
    print('Current run has no repairable isolated NZ snowline gaps.');sys.exit(0)
if info['path']==PATH:raise ValueError('Refusing to overwrite immutable cover namespace')
root=OUTPUT/meta['run'];root.mkdir(parents=True,exist_ok=True);write(root/'manifest.json',meta)
build(meta['run'],dict(zip(steps,fixed)),changed)
updated=json.loads((root/'manifest.json').read_text())
base=PREFIX+meta['run']+'/'
# Validate all rebuilt tiles before making any remote changes.
for step in changed:
    tiles=list((root/PATH/f'{step:03}').glob('*.bin.gz'))
    if len(tiles)!=649:raise ValueError('Incomplete rebuilt frame')
    for tile in tiles:
        count=361*181 if tile.name=='global.bin.gz' else 101*101
        if len(gzip.decompress(tile.read_bytes()))!=count*14:raise ValueError('Invalid rebuilt cover')
for step in steps:
    destination=base+PATH+f'/{step:03}/'
    if step not in changed:
        for name in ['tiles.bin','tiles.json']:
            client.copy_object(Bucket=bucket,Key=destination+name,CopySource={'Bucket':bucket,'Key':base+info['path']+f'/{step:03}/'+name})
    else:
        index={};body=bytearray()
        for tile in sorted((root/PATH/f'{step:03}').glob('*.bin.gz')):
            data=tile.read_bytes();index[tile.name]=[len(body),len(data)];body.extend(data)
        for name,data in [('tiles.bin',bytes(body)),('tiles.json',json.dumps(index,separators=(',',':')).encode())]:
            client.put_object(Bucket=bucket,Key=destination+name,Body=data,ContentType='application/json' if name.endswith('.json') else 'application/octet-stream',CacheControl='public, max-age=31536000, immutable')
# The normal publisher is serialised with this job; also guard unexpected pointer changes.
if read_json(client,bucket,PREFIX+'latest.json')!=latest:raise RuntimeError('Published run changed during repair')
manifest=meta['run']+'/manifest-snow-v6.json'
client.put_object(Bucket=bucket,Key=PREFIX+manifest,Body=json.dumps(updated).encode(),ContentType='application/json',CacheControl='public, max-age=31536000, immutable')
client.put_object(Bucket=bucket,Key=PREFIX+'latest.json',Body=json.dumps(dict(latest,manifest=manifest)).encode(),ContentType='application/json',CacheControl='no-store')
print(f'Repaired {meta["run"]} steps {changed}; references {dict(zip(steps,fixed))}')
