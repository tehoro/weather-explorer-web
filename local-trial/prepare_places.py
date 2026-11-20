"""Build static five-degree label tiles from the GeoNames cities500 export.

Download cities500.zip from https://download.geonames.org/export/dump/ first.
No runtime service, API key or location upload. Data: GeoNames, CC BY 4.0.
"""
import argparse
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import zipfile


def build(source: Path, out: Path):
    groups = defaultdict(list)
    with zipfile.ZipFile(source) as archive:
        for raw in archive.read('cities500.txt').decode('utf-8').splitlines():
            c = raw.split('\t')
            # Exclude city sections and historical/abandoned settlements.
            if c[7] not in {'PPL', 'PPLA', 'PPLA2', 'PPLA3', 'PPLA4', 'PPLA5', 'PPLC', 'PPLG'}:
                continue
            lat, lon = float(c[4]), float(c[5])
            lon = (lon + 180) % 360 - 180
            x, y = int((lon + 180) // 5), min(35, int((90 - lat) // 5))
            height = int(c[15] or c[16] or 0)
            groups[f'{x:02}-{y:02}'].append([int(c[0]), c[1], lat, lon, int(c[14] or 0), height, c[7] == 'PPLC'])
    out.mkdir(parents=True, exist_ok=True)
    for key, places in groups.items():
        (out / f'{key}.json').write_text(json.dumps(sorted(places, key=lambda p: -p[4]), ensure_ascii=False, separators=(',', ':')))
    # A small worldwide seed catalogue; closer globe views use the full tiles.
    overview = [p for rows in groups.values() for i, p in enumerate(sorted(rows, key=lambda p: -p[4]))
                if i < 2 or p[4] >= 100000 or p[6]]
    (out / 'overview.json').write_text(json.dumps(overview, ensure_ascii=False, separators=(',', ':')))
    meta = {'format': 1, 'tile_degrees': 5, 'count': sum(map(len, groups.values())),
            'tiles': sorted(groups), 'fields': ['id', 'name', 'lat', 'lon', 'population', 'elevation_m', 'capital'],
            'source': 'https://download.geonames.org/export/dump/cities500.zip',
            'prepared_utc': datetime.now(timezone.utc).isoformat(), 'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
            'attribution': 'Place names: GeoNames, CC BY 4.0. Filtered and tiled.'}
    (out / 'manifest.json').write_text(json.dumps(meta, separators=(',', ':')))
    print(f"Prepared {meta['count']:,} places in {len(groups)} static tiles")


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('--out', type=Path, default=Path(__file__).parent / 'data' / 'places')
    args = parser.parse_args()
    build(args.source, args.out)
