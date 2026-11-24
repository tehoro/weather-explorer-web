"""Package Explore and shared globe assets for static Pages."""
import argparse
import json
import re
import hashlib
from pathlib import Path
import shutil
import subprocess
import sys
from urllib.parse import urlparse

ROOT=Path(__file__).resolve().parent
TRIAL=ROOT/'local-trial'

def build(site, relay):
    endpoint=urlparse(relay)
    if endpoint.scheme!='https' or not endpoint.netloc or endpoint.query or endpoint.fragment:
        raise ValueError('A public HTTPS terrain relay URL is required')
    dest=site/'explore';dest.mkdir(parents=True,exist_ok=True)
    for p in TRIAL.iterdir():
        if p.suffix in {'.js','.mjs','.css'} and not p.name.startswith('test-'):
            shutil.copy2(p,dest/p.name)
    for name in ('index.html','global-test.html'):
        shutil.copy2(TRIAL/name,dest/name)
    shutil.copytree(TRIAL/'assets',dest/'assets',dirs_exist_ok=True)
    for p in dest.iterdir():
        if p.suffix not in {'.html','.mjs','.js'}:continue
        s=p.read_text()
        s=s.replace('/terrain-assets/','./assets/').replace('/explorer/','../').replace('/data/places/','./data/places/')
        s=s.replace("'http://127.0.0.1:8092'",'location.origin').replace("'http://127.0.0.1:8091'",'location.origin')
        s=s.replace('http://127.0.0.1:8092/global-test.html','global-test.html').replace('http://127.0.0.1:8091/','./')
        s=s.replace("fetch('/dem/tileList.txt')","fetch('./data/tileList.txt')")
        if p.name=='globe.js':s=s.replace("else $('viewer').src='../#'+tab;","else location.href='../#'+tab;")
        if p.name=='globe-clouds.mjs':s=s.replace("fetch('data/globe/meta.json')","fetch('../data/globe/meta.json')").replace('`data/${this.meta.path}', '`../data/${this.meta.path}')
        if p.name=='shared-units.mjs':s='// Display units already share the Highlights origin.\nexport function syncUnits(){}\n'
        if p.name=='terrain-raster.mjs':s=s.replace('this.base+`/remote/${kind}/${name}.tif`',json.dumps(relay.rstrip('/'))+'+`/${kind}/${name}.tif`')
        if p.name.endswith('.html'):s=s.replace('<span class="private">Private trial</span>','').replace('Explore preview','Explore').replace('EXPLORE PREVIEW','EXPLORE')
        p.write_text(s)
    (dest/'forecast-host.json').write_text(json.dumps({'baseUrl':'https://weatherdata.neilgordon.me/global-data'}))
    # One content fingerprint invalidates cached imports after any Explore change.
    scripts=sorted(p for p in dest.iterdir() if p.suffix in {'.html','.mjs','.js','.css'})
    version=hashlib.sha256(b''.join(p.read_bytes() for p in scripts)).hexdigest()[:12]
    for p in scripts:
        s=re.sub(r'\?v=[A-Za-z0-9_-]+', '?v='+version, p.read_text())
        # Version every local import and worker, including newly added modules.
        # Mixing cached controls with new renderers can otherwise break saved views.
        s=re.sub(r"(['\"])(\./[^'\"\s?]+\.(?:mjs|js|css))(?:\?v=[A-Za-z0-9_-]+)?\1",
                 lambda m:m[1]+m[2]+'?v='+version+m[1],s)
        p.write_text(s)
    data=dest/'data';data.mkdir(exist_ok=True)
    archive=Path('/tmp/weather-explorer-cities500.zip')
    if not archive.exists():
        subprocess.run(['curl','-fL','--retry','3','--max-time','180','https://download.geonames.org/export/dump/cities500.zip','-o',str(archive)],check=True)
    sys.path.insert(0,str(TRIAL))
    from prepare_places import build as places
    from prepare_search import build as search
    if not (data/'places/manifest.json').exists():places(archive,data/'places')
    if not (data/'search').exists():search(archive,data/'search')
    catalogue=data/'tileList.txt'
    if not catalogue.exists():subprocess.run(['curl','-fL','--retry','3','--max-time','60','https://copernicus-dem-90m.s3.amazonaws.com/tileList.txt','-o',str(catalogue)],check=True)
    print('Packaged Explore at /explore/')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--site',type=Path,default=ROOT/'site');p.add_argument('--relay',required=True);a=p.parse_args();build(a.site,a.relay)
