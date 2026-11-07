"""Lakes for the terrain view (site/tilt/): Natural Earth 1:10m lakes (public domain), simplified.

  python3 tools/make_lakes.py ne_10m_lakes.geojson

The input is https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_lakes.geojson.
Writes site/tilt/lakes.json: {"lakes": [{"name", "bbox": [w, s, e, n], "rings": [[lon, lat, lon, lat, ...], ...]}]},
outer ring first, then holes (islands), coordinates rounded to 0.005 degree.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent


def ring(coords: list) -> list[float]:
    out, last = [], None
    for lon, lat in coords:
        p = (round(lon / 0.005) * 0.005, round(lat / 0.005) * 0.005)
        if p != last:
            out += [round(p[0], 3), round(p[1], 3)]
            last = p
    return out


def main() -> None:
    lakes = []
    for f in json.loads(Path(sys.argv[1]).read_text())["features"]:
        g = f["geometry"]
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        for poly in polys:
            rings = [r for r in (ring(r) for r in poly) if len(r) >= 8]
            if not rings:
                continue
            lons, lats = rings[0][0::2], rings[0][1::2]
            lakes.append({"name": f["properties"].get("name") or "", "bbox": [min(lons), min(lats), max(lons), max(lats)],
                          "rings": rings})
    out = HERE / "site" / "tilt" / "lakes.json"
    out.write_text(json.dumps({"source": "Natural Earth 1:10m lakes (public domain)", "lakes": lakes}, separators=(",", ":")))
    print(f"{len(lakes)} lakes, {out.stat().st_size / 1e3:.0f} kB")


if __name__ == "__main__":
    main()
