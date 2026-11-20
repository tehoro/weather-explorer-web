"""Loopback-only preview. Serves static weather; caches existing static DEM tiles.

No forecast processing, backend credentials, live forecast proxies or POST routes.
Run with the web venv: python local-trial/serve.py --port 8091
"""
import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re
import subprocess
import threading
from urllib.parse import unquote, urlsplit

HERE=Path(__file__).resolve().parent
SITE=HERE.parent/'site'
locks={}
guard=threading.Lock()

class Handler(SimpleHTTPRequestHandler):
    def translate_path(self,path):
        path=unquote(urlsplit(path).path)
        if path.startswith('/explorer/'):
            base=SITE;relative=path[len('/explorer/'):]
        elif path.startswith('/terrain-assets/adaptive-v1/'):
            base=HERE/'data'/'terrain-assets';relative=path[len('/terrain-assets/'):]
        elif path.startswith('/terrain-assets/'):
            base=HERE/'assets';relative=path[len('/terrain-assets/'):]
        elif path.startswith('/data/'):
            base=HERE/'data';relative=path[len('/data/'):]
        elif path.startswith('/atmosphere/'):
            base=HERE/'data';relative=path.lstrip('/')
        elif path=='/manifest.json':
            return str(HERE/'data'/'manifest.json')
        else:
            base=HERE;relative=path.lstrip('/') or 'index.html'
        target=(base/relative).resolve()
        return str(target if target.is_relative_to(base.resolve()) else HERE/'not-found')

    def do_GET(self):
        host=self.headers.get('Host','').split(':')[0]
        if host not in ('127.0.0.1','localhost'):
            self.send_error(403);return
        path=urlsplit(self.path).path
        if re.fullmatch(r'/terrain-assets/adaptive-v1/(otaki|alps)/tiles/[0-6]/\d+-\d+\.bin',path):
            target=Path(self.translate_path(path))
            with guard: lock=locks.setdefault(path,threading.Lock())
            with lock:
                if not target.exists():
                    target.parent.mkdir(parents=True,exist_ok=True)
                    tmp=target.with_suffix('.part')
                    result=subprocess.run(['curl','-fsSL','--max-time','30','https://weather3d.neilgordon.me'+path,'-o',str(tmp)],capture_output=True)
                    if result.returncode:
                        tmp.unlink(missing_ok=True);self.send_error(502,'Static DEM tile unavailable');return
                    tmp.replace(target)
        return super().do_GET()

    def end_headers(self):
        self.send_header('Cache-Control','no-cache')
        self.send_header('X-Content-Type-Options','nosniff')
        super().end_headers()

    def list_directory(self,path):
        self.send_error(403,'Directory listings disabled')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--port',type=int,default=8091);args=p.parse_args()
    print(f'Private local trial: http://127.0.0.1:{args.port}',flush=True)
    ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
