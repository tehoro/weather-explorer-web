"""Copy the current highlights from the backend into a static web viewer site.

The public viewer is separate from the app and the backend: this script reads the backend's
existing endpoints with the app key, exactly as one more app would, and writes plain files that
any static host can serve. The backend is never changed and never serves viewer traffic.

  uv run sync.py [--out site/data]

Environment:
  BACKEND_URL   default https://weather-explorer-backend.replit.app
  APP_KEY       the key built into the app (falls back to ../backend/data/.app_key)

Each scene's gzipped JSON (uint16 values, base64) becomes a folder of lossless WebP frames at
8 bits, about a third of the size, which the browser decodes natively:

  data/feed.json                  highlights and requested events, scene data paths rewritten
  data/items/<tag>/<id>.json      each highlight as shown, kept 7 days for shared links
  data/archive.json               when each kept highlight expires
  data/p/<tag>/<item>-<n>/meta.json
  data/p/<tag>/<item>-<n>/<role>/000.webp ...     role: fill, contours or vectors
                              000.uv.webp         wind u/v (red/green), when the layer has vectors
                              000.c12.webp        12-bit values (red/green), when it is contoured

Scene files never change once built, so a package already on disk is kept and not fetched again.
Exit status 0 = the site changed, 3 = nothing new (the caller can skip deploying).
"""
from __future__ import annotations

import argparse
import base64
import gzip
import io
import json
import os
import re
import shutil
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).parent
BACKEND = os.environ.get("BACKEND_URL", "https://weather-explorer-backend.replit.app").rstrip("/")
UNCHANGED = 3
FORMAT = 3             # package layout version; older packages are rebuilt
KEEP_DAYS = 7          # how long a highlight stays available to shared links after it was last listed
MISSING = 255          # u8 value for no data; real values use 0..254
SQRT_LAYERS = {"precip"}   # wide-range fields kept on a square-root scale so light rain keeps detail
# Feed fields the viewer shows. Requested events are listed by their researched item only: the
# anonymous request text is not published.
REQUEST_FIELDS = ("id", "requested_utc", "expires_utc")


def app_key() -> str:
    key = os.environ.get("APP_KEY", "").strip()
    if not key:
        f = HERE.parent / "backend" / "data" / ".app_key"
        key = f.read_text().strip() if f.exists() else ""
    if not key:
        sys.exit("APP_KEY is not set")
    return key


def get(path: str, key: str) -> bytes:
    req = urllib.request.Request(f"{BACKEND}{path}", headers={
        "Authorization": f"Bearer {key}", "User-Agent": "weather-explorer-web-sync/0.1",
        "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
        if r.headers.get("Content-Encoding") == "gzip" or data[:2] == b"\x1f\x8b":
            data = gzip.decompress(data)
        return data


def get_json(path: str, key: str):
    return json.loads(get(path, key))


def webp(arr: np.ndarray) -> bytes:
    b = io.BytesIO()
    Image.fromarray(arr).save(b, "WEBP", lossless=True, quality=100, method=6)
    return b.getvalue()


def to_u8(b64: str, n: int, sqrt: bool) -> np.ndarray:
    """Backend uint16 (0..65534 between lo and hi, 65535 missing) to u8 (0..254, 255 missing)."""
    q = np.frombuffer(base64.b64decode(b64), dtype="<u2")[:n]
    if q.size < n:
        q = np.concatenate([q, np.full(n - q.size, 65535, "<u2")])
    t = q.astype(np.float32) / 65534
    if sqrt:
        t = np.sqrt(t)
    out = np.round(t * 254).astype(np.uint8)
    out[q == 65535] = MISSING
    return out


def to_u12_rg(b64: str, nx: int, ny: int) -> np.ndarray:
    """12-bit values (0..4094, 4095 missing) split into red (high) and green (low byte), for smooth
    contours: 0.02 hPa steps for pressure, at half the size of 16 bits."""
    q = np.frombuffer(base64.b64decode(b64), dtype="<u2")[:nx * ny]
    if q.size < nx * ny:
        q = np.concatenate([q, np.full(nx * ny - q.size, 65535, "<u2")])
    q12 = np.round(q.astype(np.float32) * 4094 / 65534).astype(np.uint16)
    q12[q == 65535] = 4095
    q12 = q12.reshape(ny, nx)
    return np.dstack([(q12 >> 8).astype(np.uint8), (q12 & 255).astype(np.uint8), np.zeros((ny, nx), np.uint8)])


def convert(src: dict, out: Path) -> dict:
    """Write one role's frames as WebP; returns its part of meta.json."""
    nx, ny, n = src["nx"], src["ny"], src["nx"] * src["ny"]
    sqrt = src["layer"] in SQRT_LAYERS
    vec = src.get("vectors")
    out.mkdir(parents=True, exist_ok=True)
    frames = []
    for i, f in enumerate(src["frames"]):
        (out / f"{i:03d}.webp").write_bytes(webp(to_u8(f["data"], n, sqrt).reshape(ny, nx)))
        if src.get("contour_interval"):
            # 8 bits makes isobars wobble in flat areas, so contoured layers keep 12 bits too.
            (out / f"{i:03d}.c12.webp").write_bytes(webp(to_u12_rg(f["data"], nx, ny)))
        if vec and f.get("u") and f.get("v"):
            vn = vec["nx"] * vec["ny"]
            u = to_u8(f["u"], vn, False).reshape(vec["ny"], vec["nx"])
            v = to_u8(f["v"], vn, False).reshape(vec["ny"], vec["nx"])
            (out / f"{i:03d}.uv.webp").write_bytes(webp(np.dstack([u, v, np.zeros_like(u)])))
        frames.append({"valid_time": f["valid_time"], "run": f.get("run"), "step": f.get("step")})
    return {k: src.get(k) for k in ("layer", "title", "units", "model", "resolution", "run", "box", "nx", "ny",
                                    "projection", "lo", "hi", "stops", "contour_interval", "vectors", "attribution")} | {
        "scale": "sqrt" if sqrt else "linear", "frames": frames}


def package(scene: dict, key: str, root: Path) -> str | None:
    """Build (or reuse) the package for a scene; returns its path relative to the data folder."""
    files = scene.get("data") or {}
    fill = files.get("fill")
    if not fill or not re.fullmatch(r"[0-9A-Za-z]+/[0-9A-Za-z_.\-]+-fill\.json\.gz", fill):
        return None
    rel = "p/" + fill.removesuffix("-fill.json.gz")
    folder = root / rel
    try:
        if json.loads((folder / "meta.json").read_text()).get("format") == FORMAT:
            return rel
    except (OSError, ValueError):
        pass
    tmp = folder.with_name(folder.name + ".part")
    shutil.rmtree(tmp, ignore_errors=True)
    meta = {}
    for role, name in files.items():
        if role not in ("fill", "contours", "vectors"):
            continue
        try:
            meta[role] = convert(json.loads(get(f"/scenes/{name}", key)), tmp / role)
        except Exception as e:
            print(f"[sync] {name}: {e}", file=sys.stderr, flush=True)
            if role == "fill":
                shutil.rmtree(tmp, ignore_errors=True)
                return None
    (tmp / "meta.json").write_text(json.dumps(meta | {"format": FORMAT}, separators=(",", ":")))
    shutil.rmtree(folder, ignore_errors=True)
    tmp.rename(folder)
    print(f"[sync] built {rel}", flush=True)
    return rel


def scenes_of(item: dict, key: str, root: Path, used: set[str]) -> dict | None:
    out = []
    for scene in item.get("scenes", []):
        rel = package(scene, key, root)
        if rel:
            used.add(rel)
            out.append({k: v for k, v in scene.items() if k != "data"} | {"package": rel})
    if not out:
        return None
    # The item's permanent reference, used by shared links: its package tag and id.
    return item | {"scenes": out, "ref": f"{out[0]['package'].split('/')[1]}/{item['id']}"}


def keep_archive(root: Path, current: list[dict], now: datetime, used: set[str]) -> bool:
    """Keep each highlight for KEEP_DAYS after it was last listed, so shared links keep working.

      data/items/<tag>/<id>.json      the item as it was shown (with its packages)
      data/archive.json               {"<tag>/<id>": {"until": ...}}

    Adds the packages of kept items to `used`. Returns True if anything was added or removed."""
    path = root / "archive.json"
    try:
        archive = json.loads(path.read_text())
    except (OSError, ValueError):
        archive = {}
    changed = False
    until = (now + timedelta(days=KEEP_DAYS)).strftime("%Y-%m-%dT%H:%MZ")
    for item in current:
        ref = item["ref"]
        f = root / "items" / f"{ref}.json"
        if ref not in archive or not f.exists():
            changed = True
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps(item, ensure_ascii=False, separators=(",", ":")))
        archive[ref] = {"until": until}
    stamp = now.strftime("%Y-%m-%dT%H:%MZ")
    for ref in list(archive):
        f = root / "items" / f"{ref}.json"
        if archive[ref]["until"] < stamp or not f.exists():
            f.unlink(missing_ok=True)
            del archive[ref]
            changed = True
            continue
        try:
            used.update(s["package"] for s in json.loads(f.read_text())["scenes"])
        except (OSError, ValueError, KeyError):
            pass
    for d in (root / "items").glob("*"):
        if d.is_dir() and not any(d.iterdir()):
            d.rmdir()
    path.write_text(json.dumps(archive, separators=(",", ":")))
    return changed


def package_bytes(root: Path, rel: str) -> int:
    return sum(p.stat().st_size for p in (root / rel).rglob("*") if p.is_file())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(HERE / "site" / "data"))
    root = Path(ap.parse_args().out)
    root.mkdir(parents=True, exist_ok=True)
    key = app_key()

    feed = get_json("/api/highlights", key)
    requests = get_json("/api/requests", key).get("requests", [])
    used: set[str] = set()
    items = [i for i in (scenes_of(i, key, root, used) for i in feed.get("items", [])) if i]
    requested = []
    for r in requests:
        if r.get("status") == "ready" and r.get("item"):
            item = scenes_of(r["item"], key, root, used)
            if item:
                requested.append({k: r[k] for k in REQUEST_FIELDS if k in r} | {"item": item})

    # Size of each scene, so the viewer can say how big a download will be.
    for item in items + [r["item"] for r in requested]:
        for s in item["scenes"]:
            s["bytes"] = package_bytes(root, s["package"])

    site = {"generated_utc": feed.get("generated_utc"), "runs": feed.get("runs"),
            "attribution": feed.get("attribution"), "items": sorted(items, key=lambda i: i.get("rank", 99)),
            "requested": requested}
    body = json.dumps(site, ensure_ascii=False, separators=(",", ":"))
    path = root / "feed.json"
    old = path.read_text() if path.exists() else None
    old_body = json.dumps({k: v for k, v in json.loads(old).items() if k != "synced_utc"},
                          ensure_ascii=False, separators=(",", ":")) if old else None
    archived = keep_archive(root, items + [r["item"] for r in requested], datetime.now(timezone.utc), used)

    # Remove packages neither listed nor kept for shared links.
    pdir = root / "p"
    for tag in (pdir.iterdir() if pdir.exists() else []):
        for pkg in tag.iterdir():
            if f"p/{tag.name}/{pkg.name}" not in used:
                shutil.rmtree(pkg, ignore_errors=True)
        if not any(tag.iterdir()):
            tag.rmdir()

    if body == old_body and not archived:
        print("[sync] nothing new", flush=True)
        return UNCHANGED
    site["synced_utc"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(site, ensure_ascii=False, separators=(",", ":")))
    tmp.replace(path)
    print(f"[sync] feed {site['generated_utc']}: {len(items)} highlights, {len(requested)} requested", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
