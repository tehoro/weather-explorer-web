"""Verify the forecast pointer and manifest served to public Explore clients."""
import json
import os
from pathlib import Path
import time
import subprocess

BASE = 'https://weatherdata.neilgordon.me/global-data/'


def public_json(path):
    # Match the project's existing public-data downloader; urllib receives 403 here.
    response = subprocess.run(
        ['curl', '-fsSL', '--connect-timeout', '10', '--max-time', '30',
         '-H', 'Cache-Control: no-cache', BASE + path + '?check=' + str(time.time_ns())],
        check=True, capture_output=True, text=True)
    return json.loads(response.stdout)


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
