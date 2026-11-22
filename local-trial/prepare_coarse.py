"""Pack existing 1-degree preview tiles into one global file per forecast time."""
import gzip
import json
import numpy as np
from global_weather import OUTPUT,FIELDS
from prepare import write

def build(run):
    root=OUTPUT/run;meta=json.loads((root/'manifest.json').read_text())
    dest=root/'global';dest.mkdir(exist_ok=True)
    for step in meta['steps']:
        arrays=[np.zeros((181,361),dtype=dtype) for _,dtype,_ in FIELDS]
        for y in range(18):
            for x in range(36):
                raw=gzip.decompress((root/f'{step:03}'/'coarse'/f'{x:02}-{y:02}.bin.gz').read_bytes());offset=0
                for a,(_,dtype,_) in zip(arrays,FIELDS):
                    size=121*np.dtype(dtype).itemsize
                    a[y*10:y*10+11,x*10:x*10+11]=np.frombuffer(raw[offset:offset+size],dtype=dtype).reshape(11,11);offset+=size
        for a in arrays:a[:,-1]=a[:,0]
        path=dest/f'{step:03}.bin.gz';tmp=path.with_suffix('.tmp')
        tmp.write_bytes(gzip.compress(b''.join(a.tobytes() for a in arrays),compresslevel=6));tmp.replace(path)
    meta['global_preview']={'path':'global','width':361,'height':181,'spacing':1}
    write(root/'manifest.json',meta)

if __name__=='__main__':
    import sys
    build(sys.argv[1] if len(sys.argv)>1 else json.loads((OUTPUT/'latest.json').read_text())['run'])
