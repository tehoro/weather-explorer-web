"""Build site/relief/{z}/{x}/{y}.webp, the shaded-relief map background, from NOAA ETOPO 2022.

The inputs are the 60 arc-second surface and bedrock grids (public domain, NOAA NCEI); where the
surface stands well above the bedrock, the ground is ice:
https://www.ngdc.noaa.gov/thredds/fileServer/global/ETOPO2022/60s/60s_surface_elev_netcdf/ETOPO_2022_v1_60s_N90W180_surface.nc
https://www.ngdc.noaa.gov/thredds/fileServer/global/ETOPO2022/60s/60s_bed_elev_netcdf/ETOPO_2022_v1_60s_N90W180_bed.nc
Run once; the output is committed.

  uv run --no-project --with h5py --with scipy --with numpy --with pillow python tools/make_relief.py \
      ETOPO_2022_v1_60s_N90W180_surface.nc ETOPO_2022_v1_60s_N90W180_bed.nc site/relief

Output: Web Mercator tiles (256 px, zooms 0-6, the same tiling as the satellite imagery). Land is
coloured by height (greens low, browns high, pale grey for the highest), ice in blue-white,
the sea by depth, and both are shaded as if lit from the north-west.
"""
import math
import sys
from pathlib import Path

import h5py
import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates

MAX_ZOOM = 6
R = 6371008.8
# Height (m) → colour, muted so the weather colours and white lines stay readable on top.
LAND = [(0, "#4f6a48"), (150, "#62784e"), (400, "#7d8456"), (800, "#97895e"), (1400, "#9a7a58"),
        (2200, "#8a6a55"), (3200, "#8f8178"), (4500, "#a99f97"), (6000, "#d6d2ce")]
ICE = [(0, "#8797a4"), (1500, "#9eacb8"), (3000, "#b3bfc9"), (4000, "#c0cad2")]
ICE_M = 30                                          # this much ice over the bedrock counts as ice
SEA = [(-8000, "#0a1626"), (-5000, "#0f2034"), (-3000, "#142a42"), (-1000, "#1b3753"), (-200, "#24455f"),
       (0, "#2d5068")]


def ramp(stops, v):
    xs = [s for s, _ in stops]
    rgb = [[int(c[i:i + 2], 16) for i in (1, 3, 5)] for _, c in stops]
    return np.stack([np.interp(v, xs, [c[k] for c in rgb]) for k in range(3)], axis=-1)


def load(path):
    with h5py.File(path, "r") as f:
        z = f["z"][:].astype(np.float32)
        lat = f["lat"][:]
    return z if lat[0] < lat[-1] else z[::-1]          # rows from the south, columns from 180° W


def wrap(a):
    return np.concatenate([a[:, -1:], a, a[:, :1]], axis=1)


def coarsen(z, f):
    """Block mean over f × f cells (f divides both sides)."""
    if f == 1:
        return z
    ny, nx = z.shape
    return z.reshape(ny // f, f, nx // f, f).mean(axis=(1, 3), dtype=np.float32)


def strip(srcs, f, zoom, ty):
    """Each grid sampled for one row of tiles, with a pixel of margin all round: (258, N + 2)."""
    n = 256 * 2 ** zoom
    py = np.arange(ty * 256 - 1, ty * 256 + 257) + 0.5
    lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * py / n))))
    lon = (np.arange(-1, n + 1) + 0.5) / n * 360 - 180
    i = (lat + 90) * 60 / f - 0.5
    j = (lon + 180) * 60 / f - 0.5 + 1                  # +1: the source has a wrapped column each side
    ii, jj = np.meshgrid(i, j, indexing="ij")
    return [map_coordinates(s, [ii, jj], order=1, mode="nearest") for s in srcs], lat


def shade(e, lat, zoom):
    """Hill shading, 1 on flat ground; light from the north-west, 45° up."""
    n = 256 * 2 ** zoom
    d = 2 * math.pi * R * np.cos(np.radians(lat[1:-1]))[:, None] / n      # pixel size in metres
    ve = 2.0 * 2 ** ((MAX_ZOOM - zoom) * 0.55)       # coarser zooms smooth slopes away; exaggerate more
    dzdx = (e[1:-1, 2:] - e[1:-1, :-2]) / (2 * d) * ve
    dzdy = (e[:-2, 1:-1] - e[2:, 1:-1]) / (2 * d) * ve                   # row 0 is the north
    alt, az = math.radians(45), math.radians(315)
    lx, ly, lz = math.cos(alt) * math.sin(az), math.cos(alt) * math.cos(az), math.sin(alt)
    s = (-dzdx * lx - dzdy * ly + lz) / np.sqrt(dzdx ** 2 + dzdy ** 2 + 1)
    return s / lz


def main(surface_path, bed_path, out, upto=MAX_ZOOM):
    out = Path(out)
    z = load(surface_path)
    ice = (z - load(bed_path) > ICE_M).astype(np.float32)
    divisors = [d for d in range(1, 10801) if 10800 % d == 0]
    for zoom in range(int(upto) + 1):
        n = 256 * 2 ** zoom
        f = max(d for d in divisors if d <= max(1, 360 / n * 60))
        srcs = [wrap(coarsen(z, f)), wrap(coarsen(ice, f))]
        for ty in range(2 ** zoom):
            (e, c), lat = strip(srcs, f, zoom, ty)
            s = shade(e, lat, zoom)
            e, c = e[1:-1, 1:-1], np.clip(c[1:-1, 1:-1], 0, 1)[..., None]
            land = e > 0
            k = np.where(land, 0.35 + 0.65 * s, 0.75 + 0.25 * s)           # the sea floor is shaded gently
            ground = ramp(LAND, e) * (1 - c) + ramp(ICE, e) * c              # ice shelves stay ice
            rgb = np.where(land[..., None], ground, ramp(SEA, e)) * np.clip(k, 0.3, 1.3)[..., None]
            img = np.clip(rgb, 0, 255).astype(np.uint8)
            for tx in range(2 ** zoom):
                p = out / str(zoom) / str(tx)
                p.mkdir(parents=True, exist_ok=True)
                Image.fromarray(img[:, tx * 256:(tx + 1) * 256]).save(p / f"{ty}.webp", quality=78, method=6)
        print(f"zoom {zoom}: {4 ** zoom} tiles (source cells {f}′)", file=sys.stderr, flush=True)


if __name__ == "__main__":
    main(*sys.argv[1:5])
