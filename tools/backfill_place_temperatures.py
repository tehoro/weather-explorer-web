"""Add place timelines to the current R2 run without replacing forecast objects."""
import json
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import tempfile
import boto3
from publish_explore_r2 import PREFIX, read_json
from prepare_place_temperatures import build

client=boto3.client('s3',endpoint_url=os.environ['R2_ENDPOINT'],region_name='auto',aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'])
bucket=os.environ['R2_BUCKET']
latest=read_json(client,bucket,PREFIX+'latest.json')
meta=read_json(client,bucket,PREFIX+latest['manifest'])
with tempfile.TemporaryDirectory(prefix='place-temperatures-') as tmp:
    source=Path(tmp)/meta['run'];source.mkdir()
    def download(step):
        directory=f'{meta["run"]}/{step:03}/fine/'
        index=read_json(client,bucket,PREFIX+directory+'tiles.json')
        body=client.get_object(Bucket=bucket,Key=PREFIX+directory+'tiles.bin')['Body'].read()
        target=source/f'{step:03}/fine';target.mkdir(parents=True)
        for name,(offset,length) in index.items():
            if Path(name).name!=name:raise ValueError('Invalid tile name')
            (target/name).write_bytes(body[offset:offset+length])
    with ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(download,meta['steps']))
    build(source,meta)
    # Do not add files for a run that expired while this job was preparing them.
    current=read_json(client,bucket,PREFIX+'latest.json')
    if meta['run'] not in {current['run'],current.get('previous_run')}:raise RuntimeError('Run has expired')
    def upload(path):
        client.put_object(Bucket=bucket,Key=PREFIX+meta['run']+'/'+path.relative_to(source).as_posix(),Body=path.read_bytes(),ContentType='application/json',CacheControl='public, max-age=31536000, immutable')
    with ThreadPoolExecutor(max_workers=6) as pool:list(pool.map(upload,(source/'place-temperatures-v1').glob('*.json')))
    print('Published place timelines for '+meta['run'])
