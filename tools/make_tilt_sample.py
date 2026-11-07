"""Sample data for the tilted terrain view prototype (site/tilt/): hourly ERA5 10 m wind and gusts
for one box at 0.25 deg, as JSON. Run with the backend's environment (it uses era5.py):

  ../backend/.venv/bin/python tools/make_tilt_sample.py --name wahine-cook-strait \
      --bbox 171.5,-43.5,177.5,-38.5 --start 1968-04-09T12:00Z --end 1968-04-10T07:00Z \
      --tz Pacific/Auckland --title "The Wahine storm: Cook Strait" \
      --places "Wellington:-41.29:174.78;Nelson:-41.27:173.28;Kaikōura:-42.4:173.68;Palmerston North:-40.35:175.61"

  site/tilt/samples/<name>.json   {title, tz, bbox [w, s, e, n], nx, ny, res, times[], places[],
                                   stops, frames: [{u, v, gust (m/s), rain (mm in
                                   the hour ending then), t2m (deg C)}] row-major, north row first;
                                   stops: the viewer's colours for gust, precip and t2m;
                                   orog: ERA5's own terrain height (m), for adjusting t2m to the
                                   display terrain}
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE.parent / "backend"))
import numpy as np   # noqa: E402
import era5          # noqa: E402
import fields        # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    for k in ("name", "bbox", "start", "end", "tz", "title"):
        ap.add_argument(f"--{k}", required=True)
    ap.add_argument("--places", default="")
    a = ap.parse_args()
    w, s, e, n = (float(x) for x in a.bbox.split(","))
    lons = np.arange(w, e + 1e-6, 0.25)
    lats = np.arange(n, s - 1e-6, -0.25)
    ix = np.rint((lons + 180) / 0.25).astype(int) % 1440
    iy = np.rint((90 - lats) / 0.25).astype(int)
    cut = lambda f: f[np.ix_(iy, ix)]
    t0, t1 = fields.parse_time(a.start), fields.parse_time(a.end)
    times = [t0 + k * fields.H for k in range(int((t1 - t0) / fields.H) + 1)]
    frames = []
    for t in times:
        f = {k: [round(float(x), 1) for x in cut(era5.field(p, t)).ravel()]
             for k, p in (("u", "10u"), ("v", "10v"), ("gust", "10fg"))}
        f["rain"] = [round(float(max(0.0, x)) * 1000, 2) for x in cut(era5.field("tp", t)).ravel()]   # mm in the hour
        f["t2m"] = [round(float(x) - 273.15, 1) for x in cut(era5.field("2t", t)).ravel()]           # deg C
        frames.append(f)
        print(fields.iso(t), flush=True)
    orog = [round(float(x) / era5.G) for x in cut(era5.field("zs", times[0])).ravel()]   # ERA5's own terrain (m)
    places = []
    for p in filter(None, a.places.split(";")):
        name, lat, lon = p.rsplit(":", 2)
        places.append({"label": name, "lat": float(lat), "lon": float(lon)})
    out = {"title": a.title, "tz": a.tz, "bbox": [w, s, e, n], "nx": len(lons), "ny": len(lats), "res": 0.25,
           "times": [fields.iso(t) for t in times], "places": places, "units": "m/s", "orog": orog,
           "stops": {k: fields.LAYERS[k].stops for k in ("gust", "precip", "t2m")}, "source": "ERA5 reanalysis",
           "attribution": "Contains modified Copernicus Climate Change Service information. ERA5: Hersbach et al. (2020).",
           "frames": frames}
    path = HERE / "site" / "tilt" / "samples" / f"{a.name}.json"
    path.write_text(json.dumps(out, separators=(",", ":")))
    print(f"written {path} ({path.stat().st_size / 1e3:.0f} kB)")


if __name__ == "__main__":
    main()
