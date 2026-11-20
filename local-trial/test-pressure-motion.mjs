import assert from 'node:assert/strict';
import {pressureCentres,matchCentres,blendPressure,nearestContour} from './pressure-motion.mjs';
import {decodePressure} from './weather-data.mjs';
const n=65,field=(cx,cy,high=false)=>Float32Array.from({length:n*n},(_,i)=>high?1040-.01*((i%n-cx)**2+(Math.floor(i/n)-cy)**2):990+.01*((i%n-cx)**2+(Math.floor(i/n)-cy)**2));
const a=field(28.2,31.3),b=field(35.2,31.3),ca=pressureCentres(a,n),cb=pressureCentres(b,n);
assert.equal(ca.length,1);assert.ok(Math.abs(ca[0].x-28.2)<.01);assert.ok(Math.abs(ca[0].y-31.3)<.01);
const pairs=matchCentres(ca,cb,10,10);assert.equal(pairs.length,1);
assert.equal(blendPressure(a,b,n,0,pairs,10,10),a);assert.equal(blendPressure(a,b,n,1,pairs,10,10),b);
let previous=ca[0].x;
for(let t=.1;t<1;t+=.1){const f=blendPressure(a,b,n,t,pairs,10,10),centres=pressureCentres(f,n);assert.equal(centres.length,1);assert.ok(Math.abs(centres[0].x-(28.2+7*t))<.03);assert.ok(centres[0].x>previous);assert.ok(Math.abs(centres[0].value-990)<.02);previous=centres[0].x;}
assert.equal(pressureCentres(field(30.2,30.3,true),n)[0].high,true);
assert.equal(pressureCentres(new Float32Array(n*n).fill(990),n).length,0);
assert.equal(matchCentres(ca,[...cb,{...cb[0],x:34}],10,10).length,0);
assert.equal(matchCentres(ca,[{...cb[0],x:100}],10,10).length,0);
const anchor={level:1000,x:4,y:5},segments=[{level:1000,start:[0,6],end:[10,6]}];
assert.deepEqual(nearestContour(segments,anchor),{level:1000,x:4,y:6});assert.equal(nearestContour(segments,{...anchor,level:1002}),null);
const bytes=new ArrayBuffer(10201*4),dv=new DataView(bytes);for(let i=0;i<10201;i++)dv.setFloat32(i*4,990.836,true);
assert.ok(Math.abs(decodePressure(bytes)[0]-990.836)<.0001);assert.throws(()=>decodePressure(new ArrayBuffer(4)));
console.log('Sub-grid centres, translating low depth/position, exact endpoints, ambiguous matches, label anchoring and native pressure decoding passed.');
