"""Validate worldwide tile seams, polar coverage and samples against native GRIB."""
import gzip
import json
import unittest
import numpy as np
import eccodes
from global_weather import OUTPUT,CACHE_ROOT,FIELDS

class GlobalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        latest=json.loads((OUTPUT/'latest.json').read_text());cls.run_id=latest['run'];cls.root=OUTPUT/cls.run_id
        cls.meta=json.loads((cls.root/'manifest.json').read_text())

    def tile(self,step,x,y):
        raw=gzip.decompress((self.root/f'{step:03}'/'fine'/f'{x:02}-{y:02}.bin.gz').read_bytes());result={};offset=0
        for name,dtype,scale in FIELDS:
            size=np.dtype(dtype).itemsize*10201
            result[name]=np.frombuffer(raw[offset:offset+size],dtype=dtype).reshape(101,101);offset+=size
        self.assertEqual(offset,len(raw));return result

    def test_complete_and_edges(self):
        for step in self.meta['steps']:
            for res in ('fine','coarse'):self.assertEqual(len(list((self.root/f'{step:03}'/res).glob('*.bin.gz'))),648)
        for x,y in [(0,0),(17,8),(35,17)]:
            a=self.tile(self.meta['steps'][0],x,y);b=self.tile(self.meta['steps'][0],(x+1)%36,y)
            for key in a:np.testing.assert_array_equal(a[key][:,-1],b[key][:,0])
            if y<17:
                c=self.tile(self.meta['steps'][0],x,y+1)
                for key in a:np.testing.assert_array_equal(a[key][-1],c[key][0])

    def sample(self,step,param,lat,lon):
        gid=eccodes.codes_new_from_message((CACHE_ROOT/self.run_id/f'{step}-{param}-0.grib2').read_bytes())
        try:
            # Use ecCodes' coordinate lookup independently of our grid rotation.
            return eccodes.codes_grib_find_nearest(gid,lat,lon)[0]['value']
        finally:eccodes.codes_release(gid)

    def test_native_values_worldwide(self):
        step=self.meta['steps'][0]
        for lat,lon in [(45.8,6.9),(-43.6,170.1),(28.,86.9),(-32.7,-70.),(78.2,15.7),(-16.8,-179.9),(89.9,179.9),(-89.9,-.1)]:
            longitude=lon%360;x=int(longitude//10);y=min(17,int((90-lat)//10));row=round((90-y*10-lat)*10);col=round((longitude-x*10)*10)
            tile=self.tile(step,x,y)
            for key,param,convert in [('u','10u',lambda v:v),('v','10v',lambda v:v),('temperature','2t',lambda v:v-273.15),('pressure','msl',lambda v:v/100),('low','lcc',lambda v:v),('middle','mcc',lambda v:v),('high','hcc',lambda v:v)]:
                scale=next(s for n,d,s in FIELDS if n==key)
                self.assertAlmostEqual(float(tile[key][row,col])*scale,convert(self.sample(step,param,lat,lon)),delta=scale/2+.0001,msg=f'{key} at {lat},{lon}')
            rain=max(0,(self.sample(step,'tp',lat,lon)-self.sample(step-3,'tp',lat,lon))*1000/3)
            self.assertAlmostEqual(float(tile['rain'][row,col])*.001,np.sqrt(rain),delta=.0006)

if __name__=='__main__':unittest.main()
