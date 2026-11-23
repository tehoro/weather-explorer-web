import assert from 'node:assert/strict';
import {temperatureText} from './place-temperatures.mjs';
const c={convert:x=>x},f={convert:x=>x*1.8+32};
assert.equal(temperatureText('Dublin',7,10,.5,c),'Dublin 9°');
assert.equal(temperatureText('Dublin',7,10,.5,f),'Dublin 47°');
assert.equal(temperatureText('Dublin',null,10,.5,c),'Dublin');
assert.equal(temperatureText('Dublin',7,undefined,0,c),'Dublin');
assert.equal(temperatureText('Peak',-3,-1,.5,c),'Peak -2°');
console.log('Temporal interpolation, whole-degree Celsius/Fahrenheit and missing data passed.');
