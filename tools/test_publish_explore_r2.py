"""Publication failure ordering and retention, using an in-memory S3 stand-in."""
import gzip
import io
import json
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from publish_explore_r2 import pack, publish, PREFIX

class Missing(Exception):
    pass

class Store:
    exceptions = SimpleNamespace(NoSuchKey=Missing)
    def __init__(self, fail=False):
        self.objects = {}
        self.fail = fail
    def get_object(self, Bucket, Key):
        if Key not in self.objects: raise Missing()
        return {'Body': io.BytesIO(self.objects[Key])}
    def put_object(self, Bucket, Key, Body, **kwargs):
        if self.fail and Key.endswith('tiles.bin'): raise RuntimeError('Upload interrupted')
        self.objects[Key] = Body
    def get_paginator(self, name): return self
    def paginate(self, **kwargs):
        yield {'Contents': [{'Key': k} for k in self.objects if k.startswith(PREFIX)]}
    def delete_objects(self, Bucket, Delete):
        for item in Delete['Objects']: del self.objects[item['Key']]
        return {}

class Publishing(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / '2026112312'
        self.root.mkdir()
        self.meta = {'run': self.root.name, 'steps': [3], 'global_preview': {'path': 'global'}}
        for directory in ('003/fine', '003/coarse', 'global'):
            p = self.root / directory
            p.mkdir(parents=True)
            for n in ('a', 'b'):
                (p / (n + '.bin.gz')).write_bytes(gzip.compress((directory+n).encode()))
    def store(self, fail=False):
        s = Store(fail)
        s.objects[PREFIX+'latest.json'] = json.dumps({'run': '2026112306', 'previous_run': '2026112300'}).encode()
        for run in ('2026112306', '2026112300'):
            s.objects[PREFIX+run+'/manifest.json'] = b'{}'
        s.objects[PREFIX+'other/keep.txt'] = b'keep'
        return s
    def test_pack_ranges_recover_original_gzip(self):
        dest = Path(self.temp.name) / 'packed'
        pack(self.root, dest, self.meta)
        for index in dest.rglob('tiles.json'):
            raw = index.with_name('tiles.bin').read_bytes()
            for name, (offset, length) in json.loads(index.read_text()).items():
                original = self.root / index.parent.relative_to(dest) / name
                self.assertEqual(raw[offset:offset+length], original.read_bytes())
    def test_failed_upload_preserves_pointer_and_previous(self):
        s = self.store(True)
        before = s.objects[PREFIX+'latest.json']
        with self.assertRaises(RuntimeError): publish(s, 'bucket', self.root, self.meta)
        self.assertEqual(s.objects[PREFIX+'latest.json'], before)
        self.assertIn(PREFIX+'2026112300/manifest.json', s.objects)
    def test_success_and_retry_keep_two_and_unrelated_objects(self):
        s = self.store()
        publish(s, 'bucket', self.root, self.meta)
        pointer = json.loads(s.objects[PREFIX+'latest.json'])
        self.assertEqual(pointer['previous_run'], '2026112306')
        self.assertNotIn(PREFIX+'2026112300/manifest.json', s.objects)
        self.assertIn(PREFIX+'2026112306/manifest.json', s.objects)
        self.assertIn(PREFIX+'other/keep.txt', s.objects)
        publish(s, 'bucket', self.root, self.meta)
        self.assertEqual(json.loads(s.objects[PREFIX+'latest.json']), pointer)
    def test_reject_rollback(self):
        s = self.store()
        s.objects[PREFIX+'latest.json'] = b'{"run":"2026112318"}'
        with self.assertRaises(ValueError): publish(s, 'bucket', self.root, self.meta)

if __name__ == '__main__': unittest.main()
