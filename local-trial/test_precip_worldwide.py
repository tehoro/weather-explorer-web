"""Audit displayed global precipitation against independent ecCodes point lookup."""
import unittest
from test_global import GlobalTests


class PrecipitationAudit(GlobalTests):
    def test_precipitation_across_regions_and_times(self):
        places = [('Frankfurt',50.1,8.7),('Stuttgart',48.8,9.2),('Cologne',50.9,7),
                  ('Geneva',46.2,6.1),('Mumbai',19.1,72.9),('Sao Paulo',-23.5,-46.6),
                  ('Nairobi',-1.3,36.8),('New York',40.7,-74),('Fiji',-16.8,-179.9),
                  ('Cook Strait',-41.1,174.8)]
        wet = 0
        for step in [12,27,48]:
            for name,lat,lon in places:
                x=int((lon%360)//10);y=min(17,int((90-lat)//10))
                col=round(((lon%360)-x*10)*10);row=round((90-y*10-lat)*10)
                tile=self.tile(step,x,y)
                for field,param in [('rain','tp'),('snow','sf')]:
                    native=max(0,(self.sample(step,param,lat,lon)-self.sample(step-3,param,lat,lon))*1000/3)
                    value=(float(tile[field][row,col])*.001)**2
                    self.assertAlmostEqual(value,native,delta=.01,msg=f'{name} +{step}h {field}')
                    wet += field=='rain' and native>.05
        self.assertGreater(wet,5,'Audit must include wet samples, not only dry zeros')

if __name__=='__main__':unittest.main()
