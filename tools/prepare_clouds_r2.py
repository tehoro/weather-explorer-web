"""Build and atomically publish optional cloud volumes for the current Explore run.
Ordinary forecasts do not depend on this job. Run-scoped manifest appears last.
"""
import concurrent.futures as cf
import gzip,json,os,sys,tempfile
from pathlib import Path
import numpy as np
import boto3
sys.path.insert(0,str(Path(__file__).parent/'clouds'))
from sources import CACHE,index,field,LEVELS
from cloud_model import build_frame
from regimes import morphology
import build_tiles
from publish_explore_r2 import PREFIX,read_json
VERSION=1

def prepare(run,meta,root):
    build_tiles.HERE=root;build_tiles.OUT=root/'tiles-v1'
    rel,rows=index(run,0,True)
    z=[r for r in rows if r['param']=='z' and str(r['step'])=='0']
    if len(z)!=1:raise ValueError('Model orography unavailable')
    field((run,0,'z',0,rel,z[0]))
    def precip(step):
        if step==0:return np.zeros((361,720)),np.zeros((361,720))
        rel,rows=index(run,step,True);out=[]
        for p in ['cp','tp']:
            r=[r for r in rows if r['param']==p and str(r['step'])==str(step)]
            if len(r)!=1:raise ValueError(f'Missing {p} step {step}')
            out.append(field((run,step,p,0,rel,r[0]))[2]*1000)
        return out
    stats=[]
    for step in meta['steps']:
        jobs=[]
        for surface,specs in [(False,[(p,l) for p in ['r','t','gh'] for l in LEVELS]),(True,[(p,0) for p in ['lcc','mcc','hcc','sp','2t','2d']])]:
            rel,rows=index(run,step,surface)
            for p,l in specs:
                match=[r for r in rows if r['param']==p and (surface or str(r.get('levelist'))==str(l)) and str(r['step'])==str(step)]
                if len(match)!=1:raise ValueError(f'Missing {p}/{l} at {step}')
                jobs.append((run,step,p,l,rel,match[0]))
        with cf.ThreadPoolExecutor(max_workers=6) as pool:values={(p,l):a for p,l,a in pool.map(field,jobs)}
        arrays={p:np.stack([values[p,l] for l in LEVELS]) for p in ['r','t','gh']}
        arrays.update({p:values[p,0] for p in ['lcc','mcc','hcc','sp','2t','2d']})
        source=root/'input.npz';np.savez(source,**arrays);build_frame(run,step,source,root)
        cp,tp=precip(step);pc,pt=precip(step-3)
        regime=morphology(arrays['t'],arrays['gh'],arrays['sp'],np.maximum(0,cp-pc),np.maximum(0,tp-pt))
        (root/'data'/run/f'{step:03}.regime.gz').write_bytes(gzip.compress(np.rint(regime*255).astype('u1').tobytes()))
        stats.append(build_tiles.write_frame(run,step))
        # Validate every output before it can be uploaded.
        for lod,res in enumerate(build_tiles.LEVELS):
            side=round(20/res)+1
            for p in (build_tiles.OUT/run/f'{step:03}'/str(lod)).glob('*.bin.gz'):
                if len(gzip.decompress(p.read_bytes()))!=side*side*128*4:raise ValueError(f'Invalid cloud tile {p}')
    return stats

def publish(client,bucket,run,meta,root):
    prefix=PREFIX+run+'/cloud-v1/'
    # Pack each LOD/frame: hundreds of HTTP objects become three range-addressable packs.
    for step in meta['steps']:
        for lod in range(3):
            folder=root/'tiles-v1'/run/f'{step:03}'/str(lod);entries={};pack=bytearray()
            for p in sorted(folder.glob('*.bin.gz')):
                raw=p.read_bytes();entries[p.name]=[len(pack),len(raw)];pack.extend(raw)
            if len(entries)!=162:raise ValueError('Incomplete cloud frame')
            for name,body in [('tiles.bin',bytes(pack)),('tiles.json',json.dumps(entries).encode())]:
                client.put_object(Bucket=bucket,Key=prefix+f'{step:03}/{lod}/'+name,Body=body,ContentType='application/json' if name.endswith('json') else 'application/octet-stream',CacheControl='public, max-age=31536000, immutable')
    latest=read_json(client,bucket,PREFIX+'latest.json')
    if run not in {latest['run'],latest.get('previous_run')}:raise RuntimeError('Run expired during cloud preparation; not publishing its manifest')
    manifest={'version':VERSION,'run':run,'steps':meta['steps'],'levels':[.5,1,2],'vertical':128,'topKm':20,'channels':4,'packed':True}
    client.put_object(Bucket=bucket,Key=prefix+'manifest.json',Body=json.dumps(manifest).encode(),ContentType='application/json',CacheControl='no-store')

def main():
    client=boto3.client('s3',endpoint_url=os.environ['R2_ENDPOINT'],region_name='auto',aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY']);bucket=os.environ['R2_BUCKET']
    latest=read_json(client,bucket,PREFIX+'latest.json');run=latest['run']
    existing=read_json(client,bucket,PREFIX+run+'/cloud-v1/manifest.json')
    if existing and existing.get('version')==VERSION:print('Current cloud volume already complete.');return
    meta=read_json(client,bucket,PREFIX+run+'/manifest.json')
    if not meta or meta['run']!=run:raise ValueError('Forecast manifest mismatch')
    with tempfile.TemporaryDirectory(prefix='explore-clouds-') as temp:
        root=Path(temp);stats=prepare(run,meta,root);publish(client,bucket,run,meta,root)
        print(f'Published cloud volumes for {run}: {sum(s["bytes"] for s in stats)} compressed bytes')
if __name__=='__main__':main()
