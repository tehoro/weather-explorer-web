"""Turn historical events built by the backend (its history.py, from ERA5) into viewer packages.

  uv run history.py <backend history folder>/<item id> [--out site/data]
  uv run history.py <backend history folder>/<item id> --out .        (published: history/ in the repo)

Each event becomes a permanent folder, unlike live highlights, which are kept only for a week:

  <out>/history/index.json                  every past event, in date order, scene data paths rewritten
  <out>/history/<item id>/<n>/meta.json     one package per scene, in the same layout as data/p/
  <out>/history/<item id>/<n>/<role>/...

Published events live in the repository's history/ folder; the deploy workflow copies it to
site/data/history. The private history repository pushes them there after review.

The viewer lists past events only behind the unlisted link #past (or a shared link to one) while
they are being tried out. sync.py never touches data/history.
"""
from __future__ import annotations

import argparse
import gzip
import json
import shutil
import sys
from pathlib import Path

from sync import FORMAT, convert, package_bytes

HERE = Path(__file__).parent


def build(src: Path, root: Path) -> dict:
    item = json.loads((src / "item.json").read_text())
    if item.get("kind") != "historical":
        raise SystemExit(f"{src}: not a historical item")
    base = root / "history" / item["id"]
    out = []
    for n, scene in enumerate(item.get("scenes", [])):
        files = {r: src / name.split("/", 1)[1] for r, name in (scene.get("data") or scene.get("web_data") or {}).items()
                 if r in ("fill", "contours", "vectors")}
        if "fill" not in files:
            continue
        folder = base / str(n)
        try:   # frames already converted from these same files: only the text or track changed
            meta = json.loads((folder / "meta.json").read_text())
            fresh = meta.get("format") == FORMAT and meta.get("sources") == {r: f.name for r, f in files.items()} \
                and all(f.stat().st_mtime < (folder / "meta.json").stat().st_mtime for f in files.values())
        except (OSError, ValueError):
            fresh = False
        if not fresh:
            shutil.rmtree(folder, ignore_errors=True)
            meta = {role: convert(json.loads(gzip.decompress(f.read_bytes())), folder / role) for role, f in files.items()}
            meta |= {"format": FORMAT, "sources": {r: f.name for r, f in files.items()}}
            (folder / "meta.json").write_text(json.dumps(meta, separators=(",", ":")))
        rel = f"history/{item['id']}/{n}"
        out.append({k: v for k, v in scene.items() if k not in ("data", "web_data")}
                   | {"package": rel, "bytes": package_bytes(root, rel)})
    print(f"[history] {item['id']}: {len(out)} scenes", flush=True)
    return item | {"scenes": out, "ref": f"history/{item['id']}"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("src", type=Path, nargs="+")
    ap.add_argument("--out", type=Path, default=HERE / "site" / "data")
    a = ap.parse_args()
    index_path = a.out / "history" / "index.json"
    try:
        index = json.loads(index_path.read_text())
    except (OSError, ValueError):
        index = {"items": []}
    for src in a.src:
        item = build(src, a.out)
        index["items"] = [i for i in index["items"] if i["id"] != item["id"]] + [item]
    index["items"].sort(key=lambda i: i.get("when", {}).get("peak") or i.get("when", {}).get("start") or "")
    index["attribution"] = ("Contains modified Copernicus Climate Change Service information. "
                            "ERA5: Hersbach et al. (2020). Regridded and unit-converted.")
    index_path.parent.mkdir(parents=True, exist_ok=True)
    index_path.write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
