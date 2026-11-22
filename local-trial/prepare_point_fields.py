"""Prepare optional dew point, gust and total-cloud fields for point meteograms."""
import gzip,json
import eccodes
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from global_weather import OUTPUT,decode,fetch_fields,index
PARAMS={'2d':('dewpoint','<i2',.1),'10fg':('gust','<u2',.1),'tcc':('totalCloud','u1',1/255)}
def build(run=None):
    run=run or json.loads((OUTPUT/'latest.json').read_text())['run']
    root=OUTPUT/run;meta=json.loads((root/'manifest.json').read_text())
    available=set.intersection(*[{r.get('param') for r in index(run,s)[1]} for s in meta['steps']])
    params=[p for p in PARAMS if p in available]
    if not params:return
    gust_periods={}
    fields=[dict(name=PARAMS[p][0],dtype=PARAMS[p][1],scale=PARAMS[p][2]) for p in params]
    def frame(step):
        out=root/'point-v1'/f'{step:03}'
        inputs=fetch_fields(run,step,params)
        for p,path,_ in inputs:
            if p=='10fg':
                g=eccodes.codes_new_from_message(path.read_bytes())
                try:gust_periods[step]=eccodes.codes_get(g,'endStep')-eccodes.codes_get(g,'startStep')
                finally:eccodes.codes_release(g)
        if (out/'complete').exists():return
        arrays={}
        for p,path,_ in inputs:
            a=decode(path)-(273.15 if p=='2d' else 0)
            arrays[p]=np.rint(a/PARAMS[p][2]).astype(PARAMS[p][1])
        out.mkdir(parents=True,exist_ok=True)
        for y in range(18):
            for x in range(36):
                ix=np.arange(x*100,x*100+101)%3600;iy=np.arange(y*100,y*100+101)
                raw=b''.join(arrays[p][np.ix_(iy,ix)].tobytes() for p in params)
                (out/f'{x:02}-{y:02}.bin.gz').write_bytes(gzip.compress(raw,compresslevel=4,mtime=0))
        (out/'complete').touch();print(f'Point fields +{step:03} h ready',flush=True)
    with ThreadPoolExecutor(max_workers=2) as pool:list(pool.map(frame,meta['steps']))
    meta['point_fields']={'path':'point-v1','fields':fields,'gust_period_hours':[gust_periods.get(s) for s in meta['steps']]}
    tmp=root/'manifest.point.tmp';tmp.write_text(json.dumps(meta));tmp.replace(root/'manifest.json')
if __name__=='__main__':build()
