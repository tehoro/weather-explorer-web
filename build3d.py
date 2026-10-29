"""3D view data for tropical-cyclone highlights, built straight from ECMWF Open Data.

The 3D view (site/3d/) is a three.js model of one highlight's box: clouds and the warm core
ray-marched from humidity and temperature on pressure levels, wind particles at 925 and 200 hPa,
rain, and the sea coloured by 10 m wind with isobars. This script fetches IFS HRES 0.25 deg fields
for the box (AWS mirror first, only the needed messages via the .index files and HTTP range
requests), cuts and packs them, and writes

  data/3d/<item id>-<run>/meta.json      times, box, grid, scales, coastlines, places
  data/3d/<item id>-<run>/bundle.bin.gz  uint8/int8 arrays back to back (offsets in meta.json)

Volumes are resampled from pressure levels to evenly spaced heights (standard atmosphere):
  rh    relative humidity, value / 2 = %                          [frame][z][y][x]
  warm  temperature minus the box mean at that height, value / 255 * 20 - 5 = K
  wind  u, v at 925, 500, 200 hPa, int8 m/s                       [frame][6][y][x]
  wind10, msl (value / 2 + 900 = hPa), rain ((value / 255)^2 * 100 = mm/h), lsm

A bundle depends only on the item and the run, so one already on disk is kept.

  uv run build3d.py [--data site/data] [--feed site/data/feed.json]    (sync.py calls build())
"""
from __future__ import annotations

import argparse
import gzip
import json
import math
import shutil
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

try:  # use the operating system's certificate store (works behind TLS-inspecting proxies)
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass

HERE = Path(__file__).parent
ROOTS = ["https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com", "https://data.ecmwf.int/forecasts"]
UA = {"User-Agent": "weather-explorer-web-3d/0.1"}
FORMAT = 1
HAZARD = "tropical-cyclone"
LEVELS = [1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150, 100]
WIND_LEVELS = [925, 500, 200]
TOP_KM, NZ = 16.0, 24
MAX_FRAMES = 32           # 3-hourly, so about four days
H = timedelta(hours=1)


# --------------------------------------------------------------------------------------------
# Open Data access
# --------------------------------------------------------------------------------------------

def _get(url: str, headers: dict | None = None, timeout: int = 60, attempts: int = 6) -> bytes:
    """GET with retries: S3 answers bursts of range requests with 503 Slow Down."""
    for i in range(attempts):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={**UA, **(headers or {})}), timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504) or i == attempts - 1:
                raise
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if i == attempts - 1:
                raise
        time.sleep(0.4 * 2 ** i)
    raise IOError("unreachable")


def rel_path(run: datetime, step: int) -> str:
    return f"{run:%Y%m%d}/{run:%H}z/ifs/0p25/oper/{run:%Y%m%d%H}0000-{step}h-oper-fc"


def latest_run() -> datetime:
    t = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    t -= (t.hour % 6) * H
    for back in range(8):
        run = t - back * 6 * H
        for root in ROOTS:
            try:
                req = urllib.request.Request(f"{root}/{rel_path(run, 144)}.index", method="HEAD", headers=UA)
                with urllib.request.urlopen(req, timeout=15) as r:
                    if r.status == 200:
                        return run
            except Exception:
                continue
    raise RuntimeError("no recent run found on ECMWF Open Data")


_index: dict[str, tuple[str, list[dict]]] = {}
_index_lock = threading.Lock()


def index_rows(rel: str) -> tuple[str, list[dict]]:
    with _index_lock:
        if rel in _index:
            return _index[rel]
    for root in ROOTS:
        try:
            rows = [json.loads(l) for l in _get(f"{root}/{rel}.index", timeout=30).decode().splitlines() if l.strip()]
            with _index_lock:
                _index[rel] = (root, rows)
            return root, rows
        except Exception:
            continue
    raise RuntimeError(f"no index for {rel}")


_decode_lock = threading.Lock()


def field(run: datetime, step: int, param: str, level: int | None, box) -> np.ndarray:
    """One message, cut to the box: [lat south->north][lon west->east]."""
    import eccodes
    rel = rel_path(run, step)
    root, rows = index_rows(rel)
    row = next(r for r in rows if r.get("param") == param and str(r.get("step")) == str(step)
               and (level is None or str(r.get("levelist")) == str(level)))
    rng = {"Range": f"bytes={row['_offset']}-{row['_offset'] + row['_length'] - 1}"}
    mirrors = [root] + [r for r in ROOTS if r != root]   # the same file on the other mirror if one refuses
    for k, r0 in enumerate(mirrors):
        try:
            data = _get(f"{r0}/{rel}.grib2", rng)
            break
        except Exception:
            if k == len(mirrors) - 1:
                raise
    with _decode_lock:
        gid = eccodes.codes_new_from_message(data)
        try:
            ni, nj = eccodes.codes_get(gid, "Ni"), eccodes.codes_get(gid, "Nj")
            lat0 = eccodes.codes_get(gid, "latitudeOfFirstGridPointInDegrees")
            lon0 = eccodes.codes_get(gid, "longitudeOfFirstGridPointInDegrees")
            d = eccodes.codes_get(gid, "iDirectionIncrementInDegrees")
            vals = eccodes.codes_get_values(gid).reshape(nj, ni).astype(np.float32)
        finally:
            eccodes.codes_release(gid)
    lons, lats = box["lons"], box["lats"]
    ix = np.rint((lons - lon0) / d).astype(int) % ni
    iy = np.clip(np.rint((lat0 - lats) / d).astype(int), 0, nj - 1)
    return vals[np.ix_(iy, ix)]


# --------------------------------------------------------------------------------------------
# Building one bundle
# --------------------------------------------------------------------------------------------

def std_height_km(p_hpa: float) -> float:
    return 44.3308 * (1 - (p_hpa / 1013.25) ** 0.190263)


def coastlines(west, south, east, north):
    b = json.loads((HERE / "site" / "basemap.json").read_text())
    out = []
    for ring in b["land"]:
        x = y = 0
        seg = []
        for i in range(0, len(ring), 2):
            x += ring[i]; y += ring[i + 1]
            lon, lat = x / b["scale"], y / b["scale"]
            if west - 1 <= lon <= east + 1 and south - 1 <= lat <= north + 1:
                seg.append([round(lon, 2), round(lat, 2)])
            elif seg:
                if len(seg) > 1:
                    out.append(seg)
                seg = []
        if len(seg) > 1:
            out.append(seg)
    return out


def parse_time(s: str) -> datetime:
    return datetime.strptime(s, "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc)


def iso(t: datetime) -> str:
    return t.strftime("%Y-%m-%dT%H:%MZ")


def steps_for(item: dict, run: datetime) -> list[int]:
    """3-hourly steps of this run covering the highlight's window (at most MAX_FRAMES)."""
    when = item.get("when") or {}
    start = parse_time(when["start"]) if when.get("start") else run
    end = parse_time(when["end"]) if when.get("end") else run + 72 * H
    s0 = max(0, math.ceil((start - run) / H / 3) * 3)
    s1 = min(144, int((end - run) / H) // 3 * 3, s0 + 3 * (MAX_FRAMES - 1))
    if s1 - s0 < 24:   # too short (or already over) to be worth a 3D view: show the next day anyway
        s1 = min(144, s0 + 24)
    return list(range(s0, s1 + 1, 3))


def build_one(item: dict, run: datetime, out: Path) -> None:
    west, south, east, north = (item.get("scenes") or [{}])[0].get("bbox") or item["where"]["bbox"]
    res = 0.25 if (east - west) <= 40 and (north - south) <= 30 else 0.5
    box = {"lons": np.arange(west, east + 1e-6, res), "lats": np.arange(south, north + 1e-6, res)}
    steps = steps_for(item, run)
    print(f"[3d] {item['id']}: box {[west, south, east, north]} at {res} deg, run {run:%d %HZ}, "
          f"steps {steps[0]}-{steps[-1]} h", flush=True)

    jobs = [(s, p, l) for s in steps for p in ("r", "t") for l in LEVELS]
    jobs += [(s, p, l) for s in steps for p in ("u", "v") for l in WIND_LEVELS]
    jobs += [(s, p, None) for s in steps for p in ("msl", "10u", "10v", "tp")]
    jobs += [(0, "lsm", None)]
    with ThreadPoolExecutor(8) as ex:
        got = dict(zip(jobs, ex.map(lambda j: field(run, j[0], j[1], j[2], box), jobs)))

    heights = [std_height_km(p) for p in LEVELS]
    zs = (np.arange(NZ) + 0.5) * TOP_KM / NZ

    def to_heights(stack):  # [level][y][x] -> [z][y][x], linear in height
        out = np.empty((NZ,) + stack.shape[1:], np.float32)
        for k, z in enumerate(zs):
            j = int(np.clip(np.searchsorted(heights, z) - 1, 0, len(heights) - 2))
            w = float(np.clip((z - heights[j]) / (heights[j + 1] - heights[j]), 0, 1))
            out[k] = stack[j] * (1 - w) + stack[j + 1] * w
        return out

    rh, warm, wind, wind10, msl, rain = [], [], [], [], [], []
    prev_tp, prev_s = None, None
    for s in steps:
        rz = to_heights(np.stack([got[(s, "r", l)] for l in LEVELS]))
        tz = to_heights(np.stack([got[(s, "t", l)] for l in LEVELS]))
        rh.append(np.clip(rz * 2, 0, 255).astype(np.uint8))
        warm.append(np.clip((tz - tz.mean(axis=(1, 2), keepdims=True) + 5) / 20 * 255, 0, 255).astype(np.uint8))
        uv = [got[(s, c, l)] for l in WIND_LEVELS for c in ("u", "v")]
        wind.append(np.clip(np.round(np.stack(uv)), -127, 127).astype(np.int8))
        wind10.append(np.clip(np.round(np.stack([got[(s, "10u", None)], got[(s, "10v", None)]])), -127, 127).astype(np.int8))
        msl.append(np.clip((got[(s, "msl", None)] / 100 - 900) * 2, 0, 255).astype(np.uint8))
        tp = got[(s, "tp", None)] * 1000   # mm since the run started
        rate = np.zeros_like(tp) if prev_tp is None or s == 0 else np.maximum(tp - prev_tp, 0) / (s - prev_s)
        prev_tp, prev_s = tp, s
        rain.append(np.clip(np.sqrt(rate / 100) * 255, 0, 255).astype(np.uint8))
    if len(rain) > 1:
        rain[0] = rain[1]   # no rate for the first frame: reuse the next interval's
    lsm = (got[(0, "lsm", None)] * 255).astype(np.uint8)

    arrays = {"rh": np.stack(rh), "warm": np.stack(warm), "wind": np.stack(wind),
              "wind10": np.stack(wind10), "msl": np.stack(msl), "rain": np.stack(rain), "lsm": lsm}
    index, blob, off = {}, bytearray(), 0
    for k, a in arrays.items():
        b = np.ascontiguousarray(a).tobytes()
        index[k] = {"offset": off, "shape": list(a.shape), "dtype": str(a.dtype)}
        blob += b
        off += len(b)
    tmp = out.with_name(out.name + ".part")
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    (tmp / "bundle.bin.gz").write_bytes(gzip.compress(bytes(blob), 6))
    places = {p["label"]: p for sc in item.get("scenes", []) for p in sc.get("focus") or []
              if p.get("label") and west <= p["lon"] <= east and south <= p["lat"] <= north}
    meta = {
        "format": FORMAT, "id": item["id"], "title": item["title"], "label": item["where"].get("label", ""),
        "bbox": [west, south, east, north], "res": res, "nx": len(box["lons"]), "ny": len(box["lats"]),
        "nz": NZ, "top_km": TOP_KM, "run": iso(run), "times": [iso(run + s * H) for s in steps],
        "wind_levels": WIND_LEVELS, "arrays": index, "bytes": (tmp / "bundle.bin.gz").stat().st_size,
        "coast": coastlines(west, south, east, north), "places": list(places.values()),
        "attribution": f"Data: © {run:%Y} ECMWF, CC BY 4.0 (IFS HRES Open Data). Regridded.",
    }
    (tmp / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, separators=(",", ":")))
    shutil.rmtree(out, ignore_errors=True)
    tmp.rename(out)
    print(f"[3d] built {out.name} ({meta['bytes'] / 1e6:.1f} MB)", flush=True)


def build(items: list[dict], data: Path, run: datetime | None = None) -> set[str]:
    """Make sure each tropical-cyclone item has a 3D bundle for `run` (the highlights' run, so the
    3D view matches them; the latest on Open Data if not given); set item["view3d"]
    to its folder (relative to the data folder). Returns the folders in use; others are removed.
    A failure only means that item has no 3D view this time."""
    wanted = [i for i in items if HAZARD in (i.get("hazards") or [])]
    used: set[str] = set()
    if wanted:
        try:
            run = run or latest_run()
        except Exception as e:
            print(f"[3d] {e}", file=sys.stderr, flush=True)
            run = None
        for item in wanted:
            if run is None:
                break
            rel = f"3d/{item['id']}-{run:%Y%m%d%H}"
            try:
                if json.loads((data / rel / "meta.json").read_text()).get("format") != FORMAT:
                    raise ValueError
            except (OSError, ValueError):
                try:
                    build_one(item, run, data / rel)
                except Exception as e:
                    print(f"[3d] {item['id']}: {e}", file=sys.stderr, flush=True)
                    shutil.rmtree(data / f"{rel}.part", ignore_errors=True)
                    continue
            item["view3d"] = rel
            used.add(rel)
    for d in (data / "3d").glob("*") if (data / "3d").exists() else []:
        if f"3d/{d.name}" not in used:
            shutil.rmtree(d, ignore_errors=True)
    return used


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=str(HERE / "site" / "data"))
    ap.add_argument("--feed", default="https://tehoro.github.io/weather-explorer-web/data/feed.json",
                    help="feed to read the highlights from (URL or file)")
    a = ap.parse_args()
    src = a.feed
    feed = json.loads(_get(src) if src.startswith("http") else Path(src).read_text())
    items = feed.get("items", []) + [r["item"] for r in feed.get("requested", []) if r.get("item")]
    hres = (feed.get("runs") or {}).get("hres")
    used = build(items, Path(a.data), parse_time(hres) if hres else None)
    print(f"[3d] {len(used)} bundle(s): {', '.join(sorted(used)) or 'none'}")
