import io,json,tempfile,unittest
from pathlib import Path
from prepare_clouds_r2 import publish
class Client:
 class exceptions:
  class NoSuchKey(Exception):pass
 def __init__(self,fail=False):self.calls=[];self.fail=fail
 def get_object(self,**kw):return {'Body':io.BytesIO(json.dumps({'run':'2026112312'}).encode())}
 def put_object(self,**kw):
  if self.fail and kw['Key'].endswith('/1/tiles.bin'):raise RuntimeError('upload failed')
  self.calls.append(kw)
class Publication(unittest.TestCase):
 def fixture(self,root):
  for lod in range(3):
   p=root/'tiles-v1/2026112312/003'/str(lod);p.mkdir(parents=True)
   for y in range(9):
    for x in range(18):(p/f'{x}-{y}.bin.gz').write_bytes(b'fixture')
 def test_manifest_last_and_ranges(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);self.fixture(root);c=Client();publish(c,'test','2026112312',{'steps':[3]},root)
   self.assertTrue(c.calls[-1]['Key'].endswith('manifest.json'));self.assertEqual(len(c.calls),7)
   index=json.loads(c.calls[1]['Body']);self.assertEqual(len(index),162)
   self.assertEqual(sorted(index.values()),[[i*7,7] for i in range(162)])
 def test_failure_does_not_advertise(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);self.fixture(root);c=Client(True)
   with self.assertRaises(RuntimeError):publish(c,'test','2026112312',{'steps':[3]},root)
   self.assertFalse(any(x['Key'].endswith('manifest.json') for x in c.calls))
if __name__=='__main__':unittest.main()
