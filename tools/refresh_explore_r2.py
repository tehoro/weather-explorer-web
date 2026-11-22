"""Once-per-run shared preparation; never invoked by a browser request."""
import os
from pathlib import Path
import sys
import boto3
from publish_explore_r2 import PREFIX, read_json, publish
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'local-trial'))
import auto_refresh
from prepare import write

client = boto3.client('s3', endpoint_url=os.environ['R2_ENDPOINT'], region_name='auto',
    aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'], aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'])
bucket = os.environ['R2_BUCKET']
latest = read_json(client, bucket, PREFIX + 'latest.json')
if latest:
    write(auto_refresh.weather.OUTPUT / 'latest.json', latest)
auto_refresh.refresh()
run = auto_refresh.published()
if latest and run == latest['run']:
    print('No newer complete forecast available.')
else:
    source = auto_refresh.weather.OUTPUT / run
    publish(client, bucket, source, auto_refresh.validate(source))
