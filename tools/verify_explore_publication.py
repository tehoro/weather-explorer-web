"""Verify the forecast pointer and manifest served to public Explore clients."""
import json
import os
from pathlib import Path
import time
from urllib.request import Request, urlopen

BASE = 'https://weatherdata.neilgordon.me/global-data/'


def public_json(path):
    request = Request(BASE + path + '?check=' + str(time.time_ns()),
                      headers={'Cache-Control': 'no-cache'})
    with urlopen(request, timeout=30) as response:
        return json.load(response)


def verify_publication(expected, fetch=public_json, sleep=time.sleep, attempts=6):
    for attempt in range(attempts):
        try:
            pointer = fetch('latest.json')
            run = pointer['run']
            if run != expected or pointer['manifest'] != run + '/manifest.json':
                raise ValueError(f'Public forecast is {run}; expected {expected}')
            manifest = fetch(pointer['manifest'])
            if manifest['run'] != run or manifest['steps'] != list(range(3, 85, 3)):
                raise ValueError('Public forecast manifest is incomplete or mismatched')
            message = f'Public Explore forecast verified: {run}, +3 to +84 hours.'
            print(message)
            if summary := os.environ.get('GITHUB_STEP_SUMMARY'):
                with Path(summary).open('a') as out:
                    out.write(message + '\n')
            return run
        except Exception:
            if attempt + 1 == attempts:
                raise
            sleep(10)
