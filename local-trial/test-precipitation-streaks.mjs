import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from './assets/three.module.js';
globalThis.matchMedia=()=>({matches:false});globalThis.devicePixelRatio=1;
const source=(await readFile(new URL('./precipitation-streaks.mjs',import.meta.url),'utf8')).replace("'three'",JSON.stringify(new URL('./assets/three.module.js',import.meta.url).href));
const {PrecipitationStreaks}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const particles=new PrecipitationStreaks(new THREE.Group());particles.visible(true);
let rain=8,snow=0;
const view={liveContext:{distance:50,target:{x:0,z:0}},bounds:{west:-100,east:100,north:-100,south:100},ground:()=>.3,sample:k=>k==='rain'?rain:k==='snow'?snow:0};
particles.update(view,1/30);assert.ok(particles.rainGeometry.instanceCount>1000);assert.equal(particles.snowGeometry.drawRange.count,0);
snow=8;particles.update(view,1/30);assert.equal(particles.rainGeometry.instanceCount,0);assert.ok(particles.snowGeometry.drawRange.count>1000);
for(let i=0;i<particles.snowGeometry.drawRange.count;i++)assert.ok(particles.snowGeometry.attributes.position.getY(i)>=.325-1e-6);
// Identical particle falls more slowly as snow than rain.
particles.particles[0]={x:0,z:0,y:1,seed:0,phase:0};snow=8;particles.update(view,.1);const snowY=particles.particles[0].y;
particles.particles[0]={x:0,z:0,y:1,seed:0,phase:0};snow=0;particles.update(view,.1);assert.ok(snowY>particles.particles[0].y);
// Both phases follow east/north wind; reversing wind reverses their drift.
for(const amount of [0,8])for(const sign of [-1,1]){
 rain=8;snow=amount;particles.particles[0]={x:0,z:0,y:1,seed:0,phase:0};
 view.sample=k=>k==='rain'?rain:k==='snow'?snow:sign*10;
 particles.update(view,.1);
 assert.ok(particles.particles[0].x*sign>0);assert.ok(particles.particles[0].z*sign<0);
 if(!amount){assert.ok((particles.rainGeometry.attributes.start.getX(0)-particles.rainGeometry.attributes.end.getX(0))*sign>0);}
}
rain=snow=0;particles.update(view,1/30);assert.equal(particles.rainGeometry.instanceCount,0);assert.equal(particles.snowGeometry.drawRange.count,0);
particles.visible(false);assert.equal(particles.rain.visible,false);assert.equal(particles.snow.visible,false);
console.log('Rain-only, snow-only, dry conditions, terrain clearance and visibility passed.');
