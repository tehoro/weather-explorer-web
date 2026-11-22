"""Add categorical surface precipitation type from indexed IFS Open Data."""
import gzip,json
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from global_weather import OUTPUT,decode,fetch_fields,index
def build(run=None):
    run=run or json.loads((OUTPUT/'latest.json').read_text())['run']
    root=OUTPUT/run;meta=json.loads((root/'manifest.json').read_text())
    if not all(any(r.get('param')=='ptype' for r in index(run,s)[1]) for s in meta['steps']):
        print('Surface precipitation type unavailable for this run',flush=True);return
    def frame(step):
        out=root/'ptype-v1'/f'{step:03}'
        if (out/'complete').exists():return
        result=fetch_fields(run,step,['ptype'])
        a=np.rint(decode(result[0][1])).astype('u1')
        if not np.isin(a,[0,1,3,5,6,7,8,12]).all():raise ValueError('Unknown precipitation type')
        out.mkdir(parents=True,exist_ok=True)
        for y in range(18):
            for x in range(36):
                ix=np.arange(x*100,x*100+101)%3600;iy=np.arange(y*100,y*100+101)
                (out/f'{x:02}-{y:02}.bin.gz').write_bytes(gzip.compress(a[np.ix_(iy,ix)].tobytes(),mtime=0))
        (out/'global.bin.gz').write_bytes(gzip.compress(a[np.ix_(np.arange(0,1801,10),np.arange(0,3601,10)%3600)].tobytes(),mtime=0))
        (out/'complete').touch();print(f'Precipitation type +{step:03} h ready',flush=True)
    with ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(frame,meta['steps']))
    meta['ptype_path']='ptype-v1'
    tmp=root/'manifest.ptype.tmp';tmp.write_text(json.dumps(meta));tmp.replace(root/'manifest.json')
if __name__=='__main__':build()
