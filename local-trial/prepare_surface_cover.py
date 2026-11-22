"""Static display cover from official IFS sd, sithick and lsm; no snowline downscaling."""
import gzip,json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import numpy as np
import eccodes
from global_weather import OUTPUT,fetch_fields,index
from prepare import write
PATH='surface-cover-v1'
FIELDS=[{'name':'snowCover','dtype':'u1','scale':1/254},{'name':'seaIce','dtype':'u1','scale':1/254}]
def read(path):
    g=eccodes.codes_new_from_message(path.read_bytes())
    try:
        assert (eccodes.codes_get(g,'Ni'),eccodes.codes_get(g,'Nj'))==(3600,1801)
        assert eccodes.codes_get(g,'latitudeOfFirstGridPointInDegrees')==90
        assert abs(eccodes.codes_get(g,'iDirectionIncrementInDegrees')-.1)<1e-6
        assert not eccodes.codes_get(g,'jScansPositively') and not eccodes.codes_get(g,'iScansNegatively')
        a=eccodes.codes_get_values(g).reshape(1801,3600)
        a[a==eccodes.codes_get(g,'missingValue')]=np.nan
        return np.roll(a,round(eccodes.codes_get(g,'longitudeOfFirstGridPointInDegrees')*10)%3600,axis=1)
    finally:eccodes.codes_release(g)
def cover(sd,ice,land):
    # 20 mm SWE gives full display whitening, not an inferred physical snow depth.
    snow=np.where(land>=.5,np.clip(np.sqrt(np.maximum(sd,0)/.02),0,1),0)
    sea=np.where(land<.5,(ice>0).astype(float),0)
    snow=np.where(np.isfinite(sd)&np.isfinite(land),snow,np.nan)
    sea=np.where(np.isfinite(ice)&np.isfinite(land),sea,np.nan)
    return [np.where(np.isfinite(a),np.rint(np.nan_to_num(a)*254),255).astype('u1') for a in (snow,sea)]
def build(run=None):
    run=run or json.loads((OUTPUT/'latest.json').read_text())['run'];root=OUTPUT/run
    meta=json.loads((root/'manifest.json').read_text())
    for step in meta['steps']:
        available={r['param'] for r in index(run,step)[1]}
        if not {'sd','sithick','lsm'}<=available:raise ValueError(f'Official surface cover fields unavailable at {step}')
    def frame(step):
        out=root/PATH/f'{step:03}'
        if (out/'complete').exists():return
        f={p:read(path) for p,path,_ in fetch_fields(run,step,['sd','sithick','lsm'])};arrays=cover(f['sd'],f['sithick'],f['lsm']);out.mkdir(parents=True,exist_ok=True)
        def save(name,iy,ix):
            blob=gzip.compress(b''.join(a[np.ix_(iy,ix)].tobytes() for a in arrays),compresslevel=4,mtime=0)
            p=out/name;tmp=p.with_suffix('.part');tmp.write_bytes(blob);tmp.replace(p)
        for y in range(18):
            for x in range(36):save(f'{x:02}-{y:02}.bin.gz',np.arange(y*100,y*100+101),np.arange(x*100,x*100+101)%3600)
        save('global.bin.gz',np.arange(0,1801,10),np.arange(0,3601,10)%3600)
        (out/'complete').touch();print(f'Snow and sea ice +{step:03} h ready',flush=True)
    with ThreadPoolExecutor(max_workers=2) as pool:list(pool.map(frame,meta['steps']))
    meta['surface_cover']={'path':PATH,'fields':FIELDS,'missing':255,'source':['sd','sithick','lsm']};write(root/'manifest.json',meta)
if __name__=='__main__':build()
