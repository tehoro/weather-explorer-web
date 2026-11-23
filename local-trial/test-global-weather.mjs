import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {WeatherData,decodeTile} from './weather-engine.mjs';
const root='/private/tmp/weather-explorer-global',latest=JSON.parse(readFileSync(root+'/latest.json')),meta=JSON.parse(readFileSync(root+'/'+latest.manifest));
const data=new WeatherData();data.meta=meta;let reads=0;
data.bytes=async url=>{reads++;const b=gunzipSync(readFileSync(root+url.replace('/global-data','')));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
await data.preload();assert.equal(reads,meta.times.length*(1+Number(!!meta.ptype_path)+Number(!!meta.surface_cover)));
for(const region of [{west:359,north:90,lonSpan:2,latSpan:1},{west:179,north:-89,lonSpan:2,latSpan:1},{west:20,north:62,lonSpan:2,latSpan:2}]){
 const grid=await data.coarseGrid(0,region,3);assert.equal(grid.quality,'coarse');assert.ok(Object.values(grid.fields).every(a=>a.every(Number.isFinite)));
}
assert.equal(reads,meta.times.length*(1+Number(!!meta.ptype_path)+Number(!!meta.surface_cover)),'new areas need no download after global preload');
const native=await data.tile(0,2,2);assert.ok(native.pressure.every(Number.isFinite),'native pressure decoded');
const global=await data.globalFrame(0),fine=decodeTile(await data.bytes(`/global-data/${meta.run}/003/fine/02-02.bin.gz`),meta);
for(const k of Object.keys(fine))assert.equal(global[k][20*361+20],fine[k][0],'preview preserves native grid point '+k);
console.log('All global times preloaded; dateline/poles valid; revisits need no requests; coarse/native values match.');
