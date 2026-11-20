"""Prepare browser-searchable GeoNames settlement names and aliases, CC BY 4.0."""
import json
import unicodedata
import zipfile
from pathlib import Path
from collections import defaultdict

def normal(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s.lower()) if not unicodedata.combining(c))

def build(source, out):
    shards = defaultdict(list)
    with zipfile.ZipFile(source) as z:
        for line in z.read('cities500.txt').decode().splitlines():
            c = line.split('\t')
            if c[7] not in {'PPL','PPLA','PPLA2','PPLA3','PPLA4','PPLA5','PPLC','PPLG'}:
                continue
            aliases = sorted(set(normal(n) for n in [c[1], c[2], *c[3].split(',')] if n))
            row = [c[1], float(c[4]), float(c[5]), c[8], c[10], int(c[14] or 0), aliases]
            for key in set(a[:2] for a in aliases if len(a) >= 2):
                shards[key].append(row)
    out.mkdir(parents=True, exist_ok=True)
    for key, rows in shards.items():
        name = '-'.join(f'{ord(c):x}' for c in key)
        (out / (name + '.json')).write_text(json.dumps(sorted(rows, key=lambda r: -r[5]), ensure_ascii=False, separators=(',', ':')))
    print(f'Prepared {len(shards)} search shards')

if __name__ == '__main__':
    build('/private/tmp/weather-explorer-cities500.zip', Path(__file__).parent / 'data/search')
