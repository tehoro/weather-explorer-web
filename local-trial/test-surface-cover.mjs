import assert from 'node:assert/strict';
import {WeatherData} from './weather-engine.mjs';
const data=new WeatherData();data.meta={run:'test',steps:[3]};
let fields=await data.surfaceCover(0,'test',2);assert.deepEqual([...fields.seaIce],[-1,-1]);
data.meta.surface_cover={path:'surface-cover-v1'};data.bytes=async()=>new Uint8Array([0,127,254,255]).buffer;
fields=await data.surfaceCover(0,'test',2);assert.deepEqual([...fields.snowCover],[0,.5]);assert.deepEqual([...fields.seaIce],[1,-1]);
data.bytes=async()=>new Uint8Array([255]).buffer;await assert.rejects(data.surfaceCover(0,'test',2),/Invalid/);
console.log('Surface cover decoding preserves missing values and validates payload size.');
// V2 stores a premultiplied elevation boundary and its evidence weight.
data.meta.surface_cover.format=2;
const packed=new Uint16Array([0,65535,65534,0,5000,0,32767,0]);
data.bytes=async()=>packed.buffer;fields=await data.surfaceCover(0,'test',2);
assert.deepEqual([...fields.snowCover],[0,-1]);assert.deepEqual([...fields.snowlineWeighted],[1,0]);assert.deepEqual([...fields.snowlineWeight],[.5,0]);
const {sampleField}=await import('./weather-engine.mjs');
assert.equal(sampleField('seaIce',new Float32Array([0,1,0,1]),2,.5,.5),.5);
assert.equal(sampleField('seaIce',new Float32Array([-1,1,-1,1]),2,.5,.5),1);
assert.equal(sampleField('seaIce',new Float32Array(4).fill(-1),2,.5,.5),-1);
assert.equal(sampleField('snowlineWeight',undefined,2,.5,.5),0);
