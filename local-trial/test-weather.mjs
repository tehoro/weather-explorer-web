import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {decodeTile,tilePoint,bilinear,WeatherData} from './weather-data.mjs';
assert.deepEqual(tilePoint(-90,360),{x:0,y:17,col:0,row:100});
assert.equal(tilePoint(0,-.1).x,35);assert.equal(tilePoint(-16.8,-179.9).x,18);
assert.equal(bilinear(new Float32Array([0,10,20,30]),2,.5,.5),15);
const root='/private/tmp/weather-explorer-global',latest=JSON.parse(readFileSync(root+'/latest.json')),meta=JSON.parse(readFileSync(root+'/'+latest.manifest));
function tile(x,y){const bytes=gunzipSync(readFileSync(`${root}/${meta.run}/${String(meta.steps[0]).padStart(3,'0')}/fine/${String(x).padStart(2,'0')}-${String(y).padStart(2,'0')}.bin.gz`));return decodeTile(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),meta);}
for(const [x,y]of [[17,13],[35,8]]){const a=tile(x,y),b=tile((x+1)%36,y);for(const k of Object.keys(a))for(let row=0;row<101;row++)assert.equal(a[k][row*101+100],b[k][row*101]);}
const data=new WeatherData();data.meta=meta;data.tile=async(frame,x,y)=>tile(x,y);
const grid=await data.grid(0,{west:179.5,north:-16,lonSpan:1,latSpan:1},11);
assert.ok(Object.values(grid.fields).every(a=>a.every(Number.isFinite)));
assert.ok(grid.fields.low.every(v=>v>=0&&v<=1));assert.ok(grid.fields.rain.every(v=>v>=0));
await assert.rejects(data.grid(0,{west:0,north:0,lonSpan:1,latSpan:1},3,()=>false),/Superseded/);
console.log('Weather decoding, interpolation, actual tile seams, dateline grid and superseded requests passed.');
