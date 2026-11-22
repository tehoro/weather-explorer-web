import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
const source=(await readFile(new URL('./global-relief.mjs?v=20261123b',import.meta.url),'utf8')).replace("'three'",JSON.stringify(new URL('./assets/three.module.js',import.meta.url).href));
const {decodeRelief,reliefHeight}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const raw=gunzipSync(await readFile(new URL('./assets/etopo1-5min.bin.gz',import.meta.url)));
const heights=decodeRelief(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));
assert.throws(()=>decodeRelief(new ArrayBuffer(2)));
assert.ok(reliefHeight(heights,30,85)>3000,'Tibetan plateau has real height');
assert.ok(reliefHeight(heights,46.5,8)>1000,'Alps have real height');
assert.equal(reliefHeight(heights,0,-140),0,'ocean is at display sea level');
for(const lat of [-90,-45,0,45,90]){
 assert.ok(Number.isFinite(reliefHeight(heights,lat,179.99)));
 assert.equal(reliefHeight(heights,lat,-180),reliefHeight(heights,lat,180));
 assert.equal(reliefHeight(heights,lat,10),reliefHeight(heights,lat,370));
}
console.log('Global relief: actual mountain heights, ocean, poles, dateline and corrupt-file checks passed.');
