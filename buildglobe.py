"""Forecast cloud for the globe of highlights, built straight from ECMWF Open Data.

The globe the site opens on shows the forecast's cloud tops turning with it, like an infrared
satellite loop: cold, high cloud bright, low cloud faint. The field is outgoing longwave radiation
(OLR, from the accumulated `ttr` of IFS HRES 0.25 deg, the mean over the 3 h before each frame),
averaged to 0.5 deg (plenty for a globe a few hundred pixels across) and written as

  data/globe/meta.json            run, times, grid and scale; the viewer reads this first
  data/globe/<run>/NNN.webp        one frame per time, 720 x 361, north row first, from 180 W

Pixel values: 0 = OLR at or above HI (clear sky or low cloud), 255 = OLR at or below LO (the
coldest tops); value / 255 = (HI - OLR) / (HI - LO). Lossy WebP: the frames are for looking at,
not for reading values, and lossy is about a fifth of the size.

The run is the latest 00 or 12 UTC one (they go to +144 h 3-hourly). Frames start a few hours
before the time of the build and run 3-hourly for four days, so the loop still covers the next
three days when the next run replaces it. A run already built is kept.

  uv run buildglobe.py [--data site/data]

Exit codes as build3d.py: 0 if the site changed (deploy again), 3 if not.
"""
from __future__ import annotations

import argparse
import io
import json
import shutil
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from PIL import Image

from build3d import ROOTS, UA, _get, index_rows, rel_path

HERE = Path(__file__).parent
FORMAT = 1
LO, HI = 100.0, 290.0            # W/m2, as the olr layer's colours fade out by 275
STEP_H = 3
LEAD_BEFORE_H = 6                # frames from a little before the build
SPAN_H = 96                      # four days of frames
QUALITY = 80
H = timedelta(hours=1)


def latest_main_run() -> datetime:
    """The newest 00 or 12 UTC run whose 0.25 deg files reach +144 h."""
    t = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    t -= (t.hour % 12) * H
    for back in range(6):
        run = t - back * 12 * H
        for root in ROOTS:
            try:
                req = urllib.request.Request(f"{root}/{rel_path(run, 144)}.index", method="HEAD", headers=UA)
                with urllib.request.urlopen(req, timeout=15) as r:
                    if r.status == 200:
                        return run
            except Exception:
                continue
    raise RuntimeError("no recent 00 or 12 UTC run found on ECMWF Open Data")


def ttr(run: datetime, step: int) -> np.ndarray:
    """The global ttr message (J/m2, accumulated, negative outgoing): [lat north->south][lon from 180 W]."""
    import eccodes
    if step == 0:
        return np.zeros((721, 1440), np.float32)
    rel = rel_path(run, step)
    root, rows = index_rows(rel)
    row = next(r for r in rows if r.get("param") == "ttr" and str(r.get("step")) == str(step))
    rng = {"Range": f"bytes={row['_offset']}-{row['_offset'] + row['_length'] - 1}"}
    mirrors = [root] + [r for r in ROOTS if r != root]
    for k, r0 in enumerate(mirrors):
        try:
            data = _get(f"{r0}/{rel}.grib2", rng)
            break
        except Exception:
            if k == len(mirrors) - 1:
                raise
    gid = eccodes.codes_new_from_message(data)
    try:
        ni, nj = eccodes.codes_get(gid, "Ni"), eccodes.codes_get(gid, "Nj")
        lon0 = eccodes.codes_get(gid, "longitudeOfFirstGridPointInDegrees")
        vals = eccodes.codes_get_values(gid).reshape(nj, ni).astype(np.float32)
    finally:
        eccodes.codes_release(gid)
    if nj != 721 or ni != 1440:
        raise RuntimeError(f"unexpected ttr grid {ni} x {nj}")
    # Columns from 180 W, whatever longitude the file starts at (0 or -180).
    shift = int(round(((lon0 + 180) % 360) / 0.25))
    return np.roll(vals, shift, axis=1)


def to_half_degree(a: np.ndarray) -> np.ndarray:
    """0.25 -> 0.5 deg: 721 x 1440 -> 361 x 720, each point the mean of its neighbours."""
    lat = a[::2]                                         # 90, 89.5, ..., -90 (361 rows)
    near = (lat + np.roll(lat, -1, axis=1)) / 2          # each 0.5 deg column and the next 0.25
    return near[:, ::2]


def encode(olr: np.ndarray) -> bytes:
    v = np.clip((HI - olr) / (HI - LO), 0, 1)
    img = Image.fromarray(np.rint(v * 255).astype(np.uint8), "L")
    b = io.BytesIO()
    img.save(b, "WEBP", quality=QUALITY, method=6)
    return b.getvalue()


def build(data: Path, resolution: float = 0.5) -> bool:
    run = latest_main_run()
    out_root = data / "globe"
    tag = f"{run:%Y%m%d%H}" + ("-025" if resolution == 0.25 else "")
    meta_path = out_root / "meta.json"
    if meta_path.exists():
        try:
            if json.loads(meta_path.read_text()).get("tag") == tag:
                print(f"globe: run {tag} already built")
                return False
        except ValueError:
            pass
    now = datetime.now(timezone.utc)
    first = max(STEP_H, int((now - run) / H - LEAD_BEFORE_H) // STEP_H * STEP_H)
    steps = list(range(first, min(144, first + SPAN_H) + 1, STEP_H))
    need = sorted({s - STEP_H for s in steps} | set(steps))
    print(f"globe: run {tag}, steps {steps[0]}-{steps[-1]} h, {len(need)} ttr messages")
    with ThreadPoolExecutor(6) as ex:
        acc = dict(zip(need, ex.map(lambda s: ttr(run, s), need)))
    out = out_root / tag
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    frames, total = [], 0
    for i, s in enumerate(steps):
        olr = np.maximum(-(acc[s] - acc[s - STEP_H]) / (STEP_H * 3600.0), 0)
        b = encode(olr if resolution == 0.25 else to_half_degree(olr))
        (out / f"{i:03d}.webp").write_bytes(b)
        total += len(b)
        frames.append({"valid_time": f"{run + s * H:%Y-%m-%dT%H:%MZ}", "step": s})
    meta = {
        "format": FORMAT, "tag": tag, "path": f"globe/{tag}", "run": f"{run:%Y-%m-%dT%H:%MZ}",
        "layer": "olr", "units": "W/m²", "lo": LO, "hi": HI, "nx": int(360 / resolution), "ny": int(180 / resolution) + 1,
        "grid": "latlon", "west": -180, "north": 90, "step_deg": resolution,
        "model": "IFS HRES (Open Data)", "frames": frames,
        "attribution": f"Data: © {now.year} ECMWF, CC BY 4.0. Regridded and unit-converted.",
    }
    meta_path.write_text(json.dumps(meta, indent=1))
    for old in out_root.iterdir():                       # earlier runs are no longer needed
        if old.is_dir() and old.name != tag:
            shutil.rmtree(old)
    print(f"globe: {len(frames)} frames, {total / 1e6:.1f} MB")
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--data", type=Path, default=HERE / "site" / "data")
    ap.add_argument("--resolution", type=float, choices=(0.25, 0.5), default=0.5)
    args = ap.parse_args()
    return 0 if build(args.data, args.resolution) else 3


if __name__ == "__main__":
    sys.exit(main())
