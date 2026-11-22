"""Prepare native-resolution OLR clouds for the private static preview.

No forecast computation or publication. Run manually when refreshing the trial.
"""
import argparse
import sys
import json
import subprocess
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

ROOT = Path(__file__).parent / 'data'
SOURCE = 'https://weatherexplorer.neilgordon.me/data/'

def fetch(remote, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(['curl', '-fsSL', '--retry', '2', SOURCE + remote, '-o', str(path)], check=True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--public-cache', action='store_true', help='Use the smaller published 0.5-degree frames')
    args = parser.parse_args()
    if not args.public_cache:
        result = subprocess.run([sys.executable, str(Path(__file__).resolve().parents[1] / 'buildglobe.py'),
                        '--data', str(ROOT), '--resolution', '0.25'], check=False)
        sys.exit(0 if result.returncode in (0, 3) else result.returncode)
    meta_path = ROOT / 'globe/meta.next.json'
    fetch('globe/meta.json', meta_path)
    meta = json.loads(meta_path.read_text())
    directory = Path(meta['path'])
    if directory.is_absolute() or '..' in directory.parts or directory.parts[0] != 'globe':
        raise ValueError('Unexpected public cloud path')
    def frame(i):
        relative = directory / f'{i:03}.webp'
        fetch(str(relative), ROOT / relative)
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(frame, range(len(meta['frames']))))
    meta_path.replace(ROOT / 'globe/meta.json')
    print(f"Cached {len(meta['frames'])} cloud frames from {meta['run']}")
