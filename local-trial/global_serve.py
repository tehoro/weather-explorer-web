"""Loopback terrain byte cache and static trial server. No geospatial processing."""
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
import re
import subprocess
import tempfile
import sys
import signal
import threading
from urllib.parse import unquote,urlsplit
from serve import Handler,HERE

REMOTE_CACHE=Path('/private/tmp/weather-explorer-range-cache')
REMOTE_CACHE.mkdir(exist_ok=True)
download_slots=threading.BoundedSemaphore(4)
remote_locks={}
lock_guard=threading.Lock()

def remote_url(path):
    """Only immutable public DEM and land-cover objects, never arbitrary URLs."""
    m=re.fullmatch(r'/remote/dem/(Copernicus_DSM_COG_30_[NS]\d{2}_00_[EW]\d{3}_00_DEM)\.tif',path)
    if m:return f'https://copernicus-dem-90m.s3.amazonaws.com/{m[1]}/{m[1]}.tif',m[1]
    m=re.fullmatch(r'/remote/water/(ESA_WorldCover_10m_2021_v200_[NS]\d{2}[EW]\d{3}_Map)\.tif',path)
    if m:return f'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/{m[1]}.tif',m[1]
    return None

class GlobalHandler(Handler):
    def end_headers(self):
        if self.command=='GET' and remote_url(urlsplit(self.path).path) and getattr(self,'range_success',False):
            self.send_header('Cache-Control','public, max-age=31536000, immutable')
            self.send_header('X-Content-Type-Options','nosniff')
            SimpleHTTPRequestHandler.end_headers(self)
        else:super().end_headers()
    def translate_path(self,path):
        path=unquote(urlsplit(path).path)
        for prefix,root in [('/global-data/',Path('/private/tmp/weather-explorer-global')),('/dem/',Path('/private/tmp/weather-explorer-dem'))]:
            if path.startswith(prefix):
                target=(root/path[len(prefix):]).resolve()
                return str(target if target.is_relative_to(root) else HERE/'not-found')
        return super().translate_path(path)

    def do_GET(self):
        if self.headers.get('Host','').split(':')[0] not in ('127.0.0.1','localhost'):
            self.send_error(403);return
        remote=remote_url(urlsplit(self.path).path)
        if remote:
            return self.remote_range(*remote)
        path=Path(self.translate_path(self.path));r=self.headers.get('Range')
        if r and path.is_file():
            m=re.fullmatch(r'bytes=(\d+)-(\d*)',r)
            size=path.stat().st_size
            if not m or int(m[1])>=size:
                self.send_error(416);return
            start=int(m[1]);end=min(int(m[2]) if m[2] else size-1,size-1)
            if end<start:self.send_error(416);return
            self.send_response(206);self.send_header('Content-Type',self.guess_type(str(path)))
            self.send_header('Content-Length',str(end-start+1));self.send_header('Content-Range',f'bytes {start}-{end}/{size}')
            self.send_header('Accept-Ranges','bytes');self.end_headers()
            with path.open('rb') as f:
                f.seek(start);self.wfile.write(f.read(end-start+1))
            return
        return super().do_GET()

    def remote_range(self,url,name):
        # Cache HTTP byte ranges only. All TIFF decoding and terrain work is in the browser.
        m=re.fullmatch(r'bytes=(\d+)-(\d+)',self.headers.get('Range',''))
        if not m or int(m[2])<int(m[1]) or int(m[2])-int(m[1])>16*1024*1024:
            self.send_error(400,'A bounded byte range is required');return
        key=f'{name}-{m[1]}-{m[2]}'
        payload=REMOTE_CACHE/(key+'.bin');header=REMOTE_CACHE/(key+'.range')
        with lock_guard:lock=remote_locks.setdefault(key,threading.Lock())
        with lock:
            if not payload.exists() or not header.exists():
                with download_slots,tempfile.TemporaryDirectory(dir=REMOTE_CACHE) as temp:
                    temp=Path(temp)
                    result=subprocess.run(['curl','-fsSL','--retry','2','--max-time','60','-H',f'Range: bytes={m[1]}-{m[2]}','-D',str(temp/'headers'),url,'-o',str(temp/'body')],capture_output=True)
                    if result.returncode:self.send_error(502,'Public terrain source unavailable');return
                    headers=(temp/'headers').read_text()
                    ranges=re.findall(r'(?im)^content-range:\s*(bytes \d+-\d+/\d+)\s*$',headers)
                    if not ranges:self.send_error(502,'Upstream did not honour byte range');return
                    match=re.fullmatch(r'bytes (\d+)-(\d+)/(\d+)',ranges[-1])
                    if int(match[1])!=int(m[1]) or (temp/'body').stat().st_size!=int(match[2])-int(match[1])+1:
                        self.send_error(502,'Upstream range mismatch');return
                    (temp/'body').replace(payload);header.write_text(ranges[-1])
            self.range_success=True
            self.send_response(206);self.send_header('Content-Type','image/tiff')
            self.send_header('Content-Length',str(payload.stat().st_size));self.send_header('Content-Range',header.read_text())
            self.send_header('Accept-Ranges','bytes');self.end_headers()
            try:self.wfile.write(payload.read_bytes())
            except (BrokenPipeError,ConnectionResetError):pass

if __name__=='__main__':
    from prepare_dem import OUT,ROOT,fetch
    OUT.mkdir(exist_ok=True)
    fetch(ROOT+'/tileList.txt',OUT/'tileList.txt')
    print('Worldwide terrain: http://127.0.0.1:8092/global-test.html',flush=True)
    # Independent low-priority global preparation; HTTP requests only serve files.
    log=(HERE/'global-refresh.log').open('a')
    updater=subprocess.Popen([sys.executable,str(HERE/'auto_refresh.py'),'--watch'],stdout=log,stderr=subprocess.STDOUT)
    def stop(signum,frame):raise KeyboardInterrupt
    signal.signal(signal.SIGTERM,stop)
    try:ThreadingHTTPServer(('127.0.0.1',8092),GlobalHandler).serve_forever()
    finally:
        updater.terminate();updater.wait(timeout=10);log.close()
