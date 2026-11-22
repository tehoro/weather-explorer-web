"""One-off static global terrain fallback. No per-user server processing.

Usage: backend/.venv/bin/python web/local-trial/prepare_global_relief.py input.nc
Source: NOAA ETOPO1 ice-surface, public domain, via Marine Institute ERDDAP:
https://erddap3.marine.ie/erddap/griddap/etopo180.nc?altitude[0:5:10800][0:5:21600]
Output: little-endian int16 metres, 4321 columns (-180..180), 2161 rows (90..-90).
5 arc-minute sampling is about 9.3 km north-south; it is only a coarse fallback.
"""
import gzip
import sys
from pathlib import Path
import numpy as np
from netCDF4 import Dataset

def build(source, destination):
    with Dataset(source) as data:
        lat, lon = data['latitude'][:], data['longitude'][:]
        heights = np.asarray(data['altitude'][:])
        if lat[0] < lat[-1]:
            heights = heights[::-1]
        assert heights.shape == (2161, 4321) and lon[0] == -180 and lon[-1] == 180
        assert np.isfinite(heights).all()
    Path(destination).write_bytes(gzip.compress(heights.astype('<i2').tobytes(), compresslevel=9, mtime=0))

if __name__ == '__main__':
    build(sys.argv[1], Path(__file__).parent/'assets/etopo1-5min.bin.gz')
