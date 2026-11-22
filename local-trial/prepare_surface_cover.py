"""Static display cover from official IFS sd, sithick and lsm; conservative, model-terrain-based snowline depiction."""
import gzip,json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import numpy as np
import eccodes
from global_weather import OUTPUT,fetch_fields,index
from prepare import write
PATH='surface-cover-v4'
FIELDS=[{'name':n,'dtype':'<u2','scale':s} for n,s in [('snowCover',1/65534),('seaIce',1/65534),('snowlineWeighted',.0002),('snowlineWeight',1/65534),('snowlineRegionalWeighted',.0002),('snowlineRegionalWeight',1/65534),('snowlineModelHeight',.0002)]]
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
def neighbourhood(a, radius=4):
    """Box mean with roughly equal km widths, wrapping longitude, never poles."""
    ny,nx=a.shape
    lat=np.linspace(90,-90,ny)
    widths=np.minimum(nx//4,np.maximum(1,np.rint(radius/np.maximum(.08,np.cos(np.deg2rad(lat)))))).astype(int)
    # Latitude padding repeats the polar row; snowline inference excludes >85 degrees.
    padded=np.pad(a,((radius,radius),(0,0)),mode='edge')
    cs=np.concatenate([np.zeros((1,nx)),np.cumsum(padded,axis=0)],axis=0)
    vertical=(cs[2*radius+1:]-cs[:-2*radius-1])/(2*radius+1)
    out=np.empty_like(vertical);x=np.arange(nx)
    for j,w in enumerate(widths):
        row=np.pad(vertical[j],(w,w),mode='wrap');c=np.r_[0,np.cumsum(row)]
        out[j]=(c[x+2*w+1]-c[x])/(2*w+1)
    return out

def snowline(sd,land,z):
    # Actual IFS surface geopotential at step 0, converted to metres.
    valid=(land>=.5)&np.isfinite(z)&np.isfinite(sd)&(z>=0)&(z<7000)
    snowy=valid&(sd>=.005);bare=valid&(sd<=.0005)
    def moments(mask):
        n=neighbourhood(mask.astype(float));mean=neighbourhood(np.where(mask,z,0))/np.maximum(n,1e-9)
        variance=np.maximum(0,neighbourhood(np.where(mask,z*z,0))/np.maximum(n,1e-9)-mean*mean)
        return n,mean,np.sqrt(variance)
    ns,zs,ss=moments(snowy);nb,zb,sb=moments(bare)
    separation=zs-zb
    evidence=(ns>=.08)&(nb>=.08)&(separation>300)&(separation>ss+sb)&valid
    evidence &= (np.abs(np.linspace(90,-90,sd.shape[0]))[:,None]<85)
    weight=neighbourhood(evidence.astype(float))
    line=neighbourhood(np.where(evidence,(zs+zb)/2000,0)) # km, premultiplied
    # Keep adjustment local to supported neighbourhoods, fade uncertain edges.
    strength=np.clip(weight/.5,0,1)*valid
    return np.where(weight>0,line/np.maximum(weight,1e-9)*strength,0),strength

def regional_snowline(line, strength, land, stride=5):
    """Borrow agreeing local boundaries, never infer one from latitude alone.

    Half-degree donors prevent many correlated native cells masquerading as
    independent evidence. Great-circle distance handles poles and the dateline.
    Returns a coarse grid; interpolation of premultiplied values fades its edges.
    """
    ny,nx=line.shape
    yy=np.arange(0,ny,stride);xx=np.arange(0,nx,stride)
    lat=np.linspace(90,-90,ny)[yy];lon=xx*360/nx
    w=strength[np.ix_(yy,xx)];h=line[np.ix_(yy,xx)]/np.maximum(w,1e-9)
    donors=w>=.5
    dy,dx=np.nonzero(donors)
    dl=np.deg2rad(lat[dy]);do=np.deg2rad(lon[dx]);dh=h[dy,dx]
    output=np.zeros_like(w);confidence=np.zeros_like(w)
    target=land[np.ix_(yy,xx)]>=.5
    for row,latitude in enumerate(lat):
        if abs(latitude)>=85:continue
        candidates=np.abs(lat[dy]-latitude)<=2.71
        if not candidates.any():continue
        a=dl[candidates];b=do[candidates];heights=dh[candidates]
        columns=np.flatnonzero(target[row])
        phi=np.deg2rad(latitude);lam=np.deg2rad(lon[columns])[:,None]
        hav=np.sin((a-phi)/2)**2+np.cos(phi)*np.cos(a)*np.sin((b-lam)/2)**2
        distance=12742*np.arcsin(np.sqrt(np.clip(hav,0,1)))
        for radius,maximum in [(150,.7),(300,.5)]:
            inside=distance<=radius
            weights=inside*np.exp(-(distance/radius)**2*2)
            total=weights.sum(axis=1)
            mean=(weights@heights)/np.maximum(total,1e-9)
            variance=(weights@(heights*heights))/np.maximum(total,1e-9)-mean*mean
            # A 200 m standard deviation is roughly a 400 m central spread.
            good=(inside.sum(axis=1)>=3)&(variance<=.2**2)&(confidence[row,columns]==0)
            quality=maximum*np.clip(total/3,0,1)*np.clip(1-np.maximum(variance,0)/.08,.5,1)
            chosen=columns[good]
            confidence[row,chosen]=quality[good];output[row,chosen]=mean[good]*quality[good]
    # Interpolate back to native rows and wrapped longitude, without scipy.
    def expand(a):
        horizontal=np.array([np.interp(np.arange(nx),np.r_[xx,nx],np.r_[r,r[0]]) for r in a])
        lo=np.minimum(np.arange(ny)//stride,len(yy)-1);hi=np.minimum(lo+1,len(yy)-1)
        blend=(np.arange(ny)-yy[lo])/stride
        return horizontal[lo]*(1-blend[:,None])+horizontal[hi]*blend[:,None]
    return expand(output),expand(confidence)

def pack_cover(sd,ice,land,z):
    old=cover(sd,ice,land)
    line,strength=snowline(sd,land,z)
    regional,regional_weight=regional_snowline(line,strength,np.where(np.isfinite(z)&np.isfinite(sd),land,0))
    arrays=[]
    for a in old:
        valid=a!=255
        weight=neighbourhood(valid.astype(float),1)
        smooth=neighbourhood(np.where(valid,a.astype(float)/254,0),1)/np.maximum(weight,1e-9)
        arrays.append(np.where(valid,np.rint(np.clip(smooth,0,1)*65534),65535).astype('<u2'))
    arrays.extend([np.rint(np.clip(line,0,13)*5000).astype('<u2'),np.rint(strength*65534).astype('<u2')])
    arrays.extend([np.rint(np.clip(regional,0,13)*5000).astype('<u2'),np.rint(regional_weight*65534).astype('<u2'),np.rint(np.clip(np.nan_to_num(z)/1000,0,13)*5000).astype('<u2')])
    return arrays

def build(run=None):
    run=run or json.loads((OUTPUT/'latest.json').read_text())['run'];root=OUTPUT/run
    meta=json.loads((root/'manifest.json').read_text())
    if 'z' not in {r['param'] for r in index(run,0)[1] if r['levtype']=='sfc'}:raise ValueError('Official model orography unavailable')
    z=read(fetch_fields(run,0,['z'])[0][1])/9.80665
    for step in meta['steps']:
        available={r['param'] for r in index(run,step)[1]}
        if not {'sd','sithick','lsm'}<=available:raise ValueError(f'Official surface cover fields unavailable at {step}')
    def frame(step):
        out=root/PATH/f'{step:03}'
        if (out/'complete').exists():return
        f={p:read(path) for p,path,_ in fetch_fields(run,step,['sd','sithick','lsm'])};arrays=pack_cover(f['sd'],f['sithick'],f['lsm'],z);out.mkdir(parents=True,exist_ok=True)
        def save(name,iy,ix,source=None):
            source=arrays if source is None else source
            blob=gzip.compress(b''.join(a[np.ix_(iy,ix)].tobytes() for a in source),compresslevel=4,mtime=0)
            p=out/name;tmp=p.with_suffix('.part');tmp.write_bytes(blob);tmp.replace(p)
        for y in range(18):
            for x in range(36):save(f'{x:02}-{y:02}.bin.gz',np.arange(y*100,y*100+101),np.arange(x*100,x*100+101)%3600)
        # Anti-alias the coarse preview in geographic distance, especially near poles.
        preview=[]
        for i,a in enumerate(arrays):
            valid=a!=65535 if i<2 else np.ones(a.shape,dtype=bool)
            weight=neighbourhood(valid.astype(float),4)
            mean=neighbourhood(np.where(valid,a,0),4)/np.maximum(weight,1e-9)
            preview.append(np.where(weight>0,np.rint(mean),65535 if i<2 else 0).astype('<u2'))
        save('global.bin.gz',np.arange(0,1801,10),np.arange(0,3601,10)%3600,preview)
        (out/'complete').touch();print(f'Snow and sea ice +{step:03} h ready',flush=True)
    with ThreadPoolExecutor(max_workers=2) as pool:list(pool.map(frame,meta['steps']))
    meta['surface_cover']={'path':PATH,'fields':FIELDS,'format':3,'bytes_per_point':14,'missing':65535,'source':['sd','sithick','lsm','z (step 0)'],'snowline':'Illustrative elevation boundary from nearby snowy/bare points and actual model terrain heights; regional fallback uses agreeing boundaries within 150–300 km, gated by rendered terrain above model terrain'};write(root/'manifest.json',meta)
if __name__=='__main__':build()
