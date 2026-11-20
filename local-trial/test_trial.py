"""Check real prepared fields against cached native IFS GRIB messages."""
import json
from pathlib import Path
import unittest
import numpy as np
import eccodes
from prepare import CACHE_ROOT

ROOT=Path(__file__).resolve().parent

class PreparedForecastTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest=json.loads((ROOT/'data/manifest.json').read_text())['published']
        cls.cycle=cls.manifest['cycle'];cls.step=cls.manifest['timing']['start_hour']

    def native(self,param,step,level=0):
        path=CACHE_ROOT/f'{self.cycle}/{step}-{param}-{level}.grib2'
        gid=eccodes.codes_new_from_message(path.read_bytes())
        try:
            self.assertAlmostEqual(eccodes.codes_get(gid,'iDirectionIncrementInDegrees'),.1)
            ni=eccodes.codes_get(gid,'Ni');nj=eccodes.codes_get(gid,'Nj')
            values=eccodes.codes_get_values(gid).reshape(nj,ni)
            lat=eccodes.codes_get(gid,'latitudeOfFirstGridPointInDegrees')
            lon=eccodes.codes_get(gid,'longitudeOfFirstGridPointInDegrees')
            # Cook Strait's northern-western cell; catches reversed latitude and shifted longitude.
            return values[round((lat-(-39.8))/.1),round((173.8-lon)/.1)%ni]
        finally:eccodes.codes_release(gid)

    def test_native_wind_temperature_and_three_hour_precipitation(self):
        s=json.loads((ROOT/f'data/ifs/{self.cycle}/otaki/hour-{self.step:03}.json').read_text())
        for field,param,offset in [('u','10u',0),('v','10v',0),('temperature','2t',-273.15)]:
            self.assertAlmostEqual(s[field][0],self.native(param,self.step)+offset,delta=.011)
        for field,param in [('precip','tp'),('snow_water','sf')]:
            expected=max(0,(self.native(param,self.step)-self.native(param,self.step-3))*1000/3)
            self.assertAlmostEqual(s[field][0],expected,delta=.0011)

    def test_shapes_masks_and_physical_ranges(self):
        for region in ['otaki','alps']:
            t=json.loads((ROOT/f'data/ifs/{self.cycle}/{region}/terrain.json').read_text());n=t['nx']*t['ny']
            for step in range(self.step,self.manifest['timing']['display_lead_hours']+1,3):
                s=json.loads((ROOT/f'data/ifs/{self.cycle}/{region}/hour-{step:03}.json').read_text())
                a=json.loads((ROOT/f'data/atmosphere/ifs/{self.cycle}/{region}/hour-{step:03}.json').read_text())
                for key in ['u','v','temperature','precip','snow_water']:
                    self.assertEqual(len(s[key]),n);self.assertTrue(np.isfinite(s[key]).all())
                self.assertTrue(np.all(np.array(s['precip'])>=0))
                self.assertTrue(np.all(np.array(s['snow_water'])<=np.array(s['precip'])+.001))
                for values in a['cloud_cover'].values():
                    self.assertEqual(len(values),n);self.assertTrue(np.all((np.array(values)>=0)&(np.array(values)<=1)))
                self.assertEqual([x['level'] for x in a['layers']],[1000,925,850,700,600,500,400,300,250,200,150,100,50])
                for layer in a['layers']:
                    self.assertEqual(len(layer['height']),n);self.assertEqual(len(layer['rh']),n)
                self.assertTrue(any(v is None for v in a['layers'][0]['rh']), 'Mountain cells must mask 1000 hPa')

    def test_pressure_mask_and_height_from_forecast(self):
        a=json.loads((ROOT/f'data/atmosphere/ifs/{self.cycle}/otaki/hour-{self.step:03}.json').read_text())
        sp=self.native('sp',self.step)
        for layer in a['layers']:
            level=layer['level']
            self.assertAlmostEqual(layer['height'][0],self.native('gh',self.step,level),delta=.51)
            if sp<100*level:self.assertIsNone(layer['rh'][0])
            else:self.assertAlmostEqual(layer['rh'][0],self.native('r',self.step,level),delta=.051)

if __name__=='__main__':unittest.main()
