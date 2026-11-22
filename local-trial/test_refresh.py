"""Offline tests of run selection and atomic publication; no external calls."""
import json
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase, main
from unittest.mock import patch
import auto_refresh as refresh
from prepare import write

class RefreshTests(TestCase):
    def test_candidates_use_utc_cycles(self):
        self.assertEqual(refresh.candidates(datetime(2026,11,22,3,20,tzinfo=timezone.utc))[:2],['2026112200','2026112118'])
    def test_partial_newer_run_is_not_selected(self):
        def probe(run,step,params):return run!='2026112200' or step!=15
        with patch.object(refresh,'probe',side_effect=probe):
            self.assertEqual(refresh.discover('2026111918',datetime(2026,11,22,3,tzinfo=timezone.utc)),'2026112118')
    def run_publication(self,fail=False):
        with TemporaryDirectory() as tmp:
            root=Path(tmp);old='2026111918';new='2026112118'
            write(root/'latest.json',{'run':old,'manifest':old+'/manifest.json'})
            def build(args):
                self.assertFalse(args.publish)
                self.assertEqual(json.loads((root/'latest.json').read_text())['run'],old)
            def validate(path):
                self.assertEqual(path.name,new)
                self.assertEqual(json.loads((root/'latest.json').read_text())['run'],old)
                if fail:raise ValueError('Missing pressure tile')
            with patch.object(refresh.weather,'OUTPUT',root),patch.object(refresh,'STATUS',root/'status.json'),patch.object(refresh,'discover',return_value=new),patch.object(refresh.weather,'build',side_effect=build),patch.object(refresh,'pressure_build') as pressure,patch.object(refresh,'coarse_build'),patch.object(refresh,'ptype_build'),patch.object(refresh,'point_build'),patch.object(refresh,'validate',side_effect=validate),patch.object(refresh,'prune_runs'),patch.object(refresh.shutil,'disk_usage') as disk:
                disk.return_value.free=10*1024**3
                if fail:
                    with self.assertRaises(ValueError):refresh.refresh()
                else:refresh.refresh()
                pressure.assert_called_once_with(new)
            self.assertEqual(json.loads((root/'latest.json').read_text())['run'],old if fail else new)
    def test_publish_after_weather_pressure_and_validation(self):self.run_publication()
    def test_failure_keeps_previous_pointer(self):self.run_publication(True)

if __name__=='__main__':main()
