"""Build site/basemap.json (land outlines and country borders) from Natural Earth 1:50m.

The input is the world-atlas TopoJSON (https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/), which is
public-domain Natural Earth data. Run once; the output is committed.

  python3 tools/make_basemap.py land-50m.json countries-50m.json > site/basemap.json

Output: {"scale": 100, "land": [ring, ...], "borders": [line, ...]}, each a flat list of
delta-encoded integer lon/lat pairs in hundredths of a degree.
"""
import json
import sys
from collections import Counter


def arcs_of(topo):
    sx, sy = topo["transform"]["scale"]
    tx, ty = topo["transform"]["translate"]
    out = []
    for arc in topo["arcs"]:
        x = y = 0
        pts = []
        for dx, dy in arc:
            x += dx
            y += dy
            pts.append((x * sx + tx, y * sy + ty))
        out.append(pts)
    return out


def line(arcs, ids):
    pts = []
    for i in ids:
        a = arcs[i] if i >= 0 else arcs[~i][::-1]
        pts.extend(a if not pts else a[1:])
    return pts


def polygons(geom):
    if geom["type"] == "Polygon":
        return [geom["arcs"]]
    if geom["type"] == "MultiPolygon":
        return geom["arcs"]
    return []


def encode(pts):
    out, px, py = [], 0, 0
    prev = None
    for lon, lat in pts:
        # Keep each line continuous across the antimeridian (the viewer draws copies at ±360).
        if prev is not None:
            while lon - prev > 180:
                lon -= 360
            while lon - prev < -180:
                lon += 360
        prev = lon
        x, y = round(lon * 100), round(lat * 100)
        if out and x == px and y == py:
            continue
        out += [x - px, y - py]
        px, py = x, y
    return out


def main(land_path, countries_path):
    land = json.load(open(land_path))
    la = arcs_of(land)
    rings = []
    for g in land["objects"]["land"]["geometries"]:
        for poly in polygons(g):
            rings += [encode(line(la, r)) for r in poly]

    countries = json.load(open(countries_path))
    ca = arcs_of(countries)
    uses = Counter()
    for g in countries["objects"]["countries"]["geometries"]:
        for poly in polygons(g):
            for ring in poly:
                uses.update(i if i >= 0 else ~i for i in ring)
    borders = [encode(ca[i]) for i, n in uses.items() if n >= 2]

    json.dump({"scale": 100, "land": [r for r in rings if len(r) >= 6], "borders": borders},
              sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main(*sys.argv[1:3])
