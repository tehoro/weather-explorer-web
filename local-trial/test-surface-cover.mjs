import assert from 'node:assert/strict';
import {WeatherData} from './weather-engine.mjs';
const data=new WeatherData();data.meta={run:'test',steps:[3]};
let fields=await data.surfaceCover(0,'test',2);assert.deepEqual([...fields.seaIce],[-1,-1]);
data.meta.surface_cover={path:'surface-cover-v1'};data.bytes=async()=>new Uint8Array([0,127,254,255]).buffer;
fields=await data.surfaceCover(0,'test',2);assert.deepEqual([...fields.snowCover],[0,.5]);assert.deepEqual([...fields.seaIce],[1,-1]);
data.bytes=async()=>new Uint8Array([255]).buffer;await assert.rejects(data.surfaceCover(0,'test',2),/Invalid/);
console.log('Surface cover decoding preserves missing values and validates payload size.');
