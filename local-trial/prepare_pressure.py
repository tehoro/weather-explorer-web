"""Add native-precision pressure tiles from cached Open Data GRIB, without refetching."""
import gzip,json
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from global_weather import OUTPUT,CACHE_ROOT,decode

def build(run=None):
    run=run or json.loads((OUTPUT/'latest.json').read_text())['run'];root=OUTPUT/run;meta=json.loads((root/'manifest.json').read_text())
    for step in meta['steps']:
        out=root/'pressure'/f'{step:03}';out.mkdir(parents=True,exist_ok=True)
        pressure=decode(CACHE_ROOT/meta['run']/f'{step}-msl-0.grib2')/100
        def save(xy):
            x,y=xy;ix=np.arange(x*100,x*100+101)%3600;iy=np.arange(y*100,y*100+101)
            raw=np.ascontiguousarray(pressure[np.ix_(iy,ix)],dtype='<f4').tobytes()
            path=out/f'{x:02}-{y:02}.bin.gz';tmp=path.with_suffix('.part');tmp.write_bytes(gzip.compress(raw,compresslevel=4,mtime=0));tmp.replace(path)
        with ThreadPoolExecutor(max_workers=6) as pool:list(pool.map(save,[(x,y) for y in range(18) for x in range(36)]))
        print(f'Pressure +{step:03} h ready',flush=True)
    meta['pressure_path']='pressure';meta['pressure_dtype']='<f4';meta['pressure_units']='hPa'
    tmp=root/'manifest.pressure.tmp';tmp.write_text(json.dumps(meta));tmp.replace(root/'manifest.json')
if __name__=='__main__':build()
