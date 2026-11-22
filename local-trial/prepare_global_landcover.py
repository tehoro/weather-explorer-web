"""Build a compact WorldCover 2021 display raster from official COG overviews.
Run: uv run --with rasterio --no-project python local-trial/prepare_global_landcover.py
Only static preparation; no full-resolution tile downloads or runtime service.
"""
import gzip,json,time,urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import numpy as np
import rasterio
ROOT='https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021'
CACHE=Path('/private/tmp/weather-explorer-worldcover-overview');CACHE.mkdir(exist_ok=True)
OUT=Path(__file__).resolve().parent/'assets/worldcover-2021-5min.bin.gz'

def tile(feature):
    name=feature['properties']['ll_tile'];path=CACHE/(name+'.bin')
    if path.exists() and path.stat().st_size==36*36:return feature,np.frombuffer(path.read_bytes(),dtype='u1').reshape(36,36)
    for attempt in range(4):
        try:
            with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR',CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif',GDAL_HTTP_TIMEOUT='30',GDAL_HTTP_MAX_RETRY='2'):
                with rasterio.open(f'{ROOT}/map/ESA_WorldCover_10m_2021_v200_{name}_Map.tif') as ds:
                    a=ds.read(1,out_shape=(36,36),resampling=rasterio.enums.Resampling.nearest)
            if not np.isin(a,[0,10,20,30,40,50,60,70,80,90,95,100]).all():raise ValueError('Unknown class')
            path.write_bytes(a.tobytes());return feature,a
        except Exception:
            if attempt==3:raise
            time.sleep(attempt+1)

def build():
    inventory=CACHE/'grid.json'
    if not inventory.exists():urllib.request.urlretrieve(ROOT+'/esa_worldcover_grid.geojson',inventory)
    features=json.loads(inventory.read_text())['features'];world=np.zeros((2160,4320),dtype='u1')
    with ThreadPoolExecutor(max_workers=12) as pool:
        for n,(feature,a) in enumerate(pool.map(tile,features),1):
            coords=feature['geometry']['coordinates'][0];west=min(p[0] for p in coords);north=max(p[1] for p in coords)
            x=round((west+180)*12);y=round((90-north)*12);world[y:y+36,x:x+36]=a
            if n%100==0:print(f'{n}/{len(features)} land-cover tiles ready',flush=True)
    blob=gzip.compress(world.tobytes(),compresslevel=9,mtime=0);OUT.write_bytes(blob)
    print(f'{OUT.name}: {len(blob)} bytes; {len(features)} source tiles',flush=True)
if __name__=='__main__':build()
