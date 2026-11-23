"""Validate and publish immutable Explore forecast packs, then advance latest.

Run with uv run --with boto3 tools/publish_explore_r2.py RUN_DIRECTORY.
Only forecast objects under global-data/ are managed. No credentials in output.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import shutil

PREFIX = 'global-data/'
RUN = re.compile(r'^\d{10}$')


def pack(source, target, meta):
    """Pack gzip members per directory; a browser requests only a tile's range."""
    directories = {source / f'{s:03}' / res for s in meta['steps'] for res in ('fine', 'coarse')}
    directories.add(source / meta['global_preview']['path'])
    for field in ('pressure_path', 'ptype_path'):
        if meta.get(field):
            directories.update(source / meta[field] / f'{s:03}' for s in meta['steps'])
    for field in ('point_fields', 'surface_cover'):
        if meta.get(field):
            directories.update(source / meta[field]['path'] / f'{s:03}' for s in meta['steps'])
    for directory in sorted(directories):
        dest = target / directory.relative_to(source)
        dest.mkdir(parents=True, exist_ok=True)
        index = {}
        with (dest / 'tiles.bin').open('wb') as out:
            for tile in sorted(directory.glob('*.bin.gz')):
                raw = tile.read_bytes()
                index[tile.name] = [out.tell(), len(raw)]
                out.write(raw)
        if not index:
            raise ValueError(f'Empty tile directory: {directory}')
        (dest / 'tiles.json').write_text(json.dumps(index, separators=(',', ':')))
    if meta.get('place_temperatures'):
        shutil.copytree(source / meta['place_temperatures'], target / meta['place_temperatures'])
    manifest = dict(meta, packed_tiles=True)
    (target / 'manifest.json').write_text(json.dumps(manifest, separators=(',', ':')))
    return manifest


def read_json(client, bucket, key):
    try:
        return json.loads(client.get_object(Bucket=bucket, Key=key)['Body'].read())
    except client.exceptions.NoSuchKey:
        return None


def publish(client, bucket, source, meta):
    run = source.name
    if not RUN.fullmatch(run):
        raise ValueError('Run directory must be YYYYMMDDHH')
    latest = read_json(client, bucket, PREFIX + 'latest.json')
    if latest and latest['run'] > run:
        raise ValueError('Refusing to replace a newer published forecast')
    if latest and latest['run'] == run:
        prune(client, bucket, {run, latest.get('previous_run')})
        print('Run already published; retention checked.')
        return
    with tempfile.TemporaryDirectory(prefix='explore-r2-') as temporary:
        target = Path(temporary)
        pack(source, target, meta)
        files = sorted(target.rglob('*'))
        files = [p for p in files if p.is_file()]
        def upload(path):
            key = PREFIX + run + '/' + path.relative_to(target).as_posix()
            raw = path.read_bytes()
            client.put_object(Bucket=bucket, Key=key, Body=raw,
                ContentType='application/json' if path.suffix == '.json' else 'application/octet-stream',
                CacheControl='public, max-age=31536000, immutable',
                Metadata={'sha256': hashlib.sha256(raw).hexdigest()})
        with ThreadPoolExecutor(max_workers=6) as pool:
            list(pool.map(upload, files))
        # All uploads succeeded before the discoverable pointer changes.
        pointer = {'run': run, 'manifest': run + '/manifest.json'}
        if latest:
            pointer['previous_run'] = latest['run']
        client.put_object(Bucket=bucket, Key=PREFIX + 'latest.json',
            Body=json.dumps(pointer).encode(), ContentType='application/json', CacheControl='no-store')
    prune(client, bucket, {run, pointer.get('previous_run')})
    print(f'Published {run}; retained current and previous complete runs.')


def prune(client, bucket, keep):
    obsolete = []
    for page in client.get_paginator('list_objects_v2').paginate(Bucket=bucket, Prefix=PREFIX):
        for obj in page.get('Contents', []):
            parts = obj['Key'][len(PREFIX):].split('/')
            if len(parts) > 1 and RUN.fullmatch(parts[0]) and parts[0] not in keep:
                obsolete.append({'Key': obj['Key']})
    for start in range(0, len(obsolete), 1000):
        result = client.delete_objects(Bucket=bucket, Delete={'Objects': obsolete[start:start+1000], 'Quiet': True})
        if result.get('Errors'):
            raise RuntimeError('Forecast published, but retention deletion failed')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    args = parser.parse_args()
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'local-trial'))
    from auto_refresh import validate
    meta = validate(args.source)  # Full decompression/shape check before remote writes.
    import boto3
    client = boto3.client('s3', endpoint_url=os.environ['R2_ENDPOINT'], region_name='auto',
        aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'], aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'])
    publish(client, os.environ['R2_BUCKET'], args.source, meta)
