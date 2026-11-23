import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from './assets/three.module.js';
globalThis.matchMedia=()=>({matches:false});globalThis.devicePixelRatio=1;
const source=(await readFile(new URL('./precipitation-streaks.mjs',import.meta.url),'utf8')).replace("'three'",JSON.stringify(new URL('./assets/three.module.js',import.meta.url).href)).replace("'./particle-budget.mjs'",JSON.stringify(new URL('./particle-budget.mjs',import.meta.url).href));
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
// Snow wafts even in calm wind.
particles.particles[0]={x:0,z:0,y:1,seed:0,phase:0};snow=8;
particles.update(view,.1);assert.ok(Math.hypot(particles.particles[0].x,particles.particles[0].z)>0);
// Both phases follow east/north wind; reversing wind reverses their drift.
for(const amount of [0,8])for(const sign of [-1,1]){
 rain=8;snow=amount;particles.particles[0]={x:0,z:0,y:1,seed:0,phase:0};
 view.sample=k=>k==='rain'?rain:k==='snow'?snow:sign*10;
 particles.update(view,.1);
 assert.ok(particles.particles[0].x*sign>0);assert.ok(particles.particles[0].z*sign<0);
 if(!amount){assert.ok((particles.rainGeometry.attributes.start.getX(0)-particles.rainGeometry.attributes.end.getX(0))*sign>0);}
}
// Project the actual precipitation displacement through rotated cameras.
// Compare horizontal drift at equal height: falling adds a separate screen motion.
particles.count=1;
let projections=0;
for(const amount of [0,8])for(let windAngle=0;windAngle<360;windAngle+=45){
 const u=10*Math.cos(windAngle*Math.PI/180),v=10*Math.sin(windAngle*Math.PI/180);
 rain=8;snow=amount;view.sample=k=>k==='rain'?rain:k==='snow'?snow:k==='u'?u:v;
 particles.particles[0]={x:0,z:0,y:1,seed:0,phase:0};particles.update(view,.1);
 const p=particles.particles[0],drift=new THREE.Vector3(p.x,0,p.z);
 // Wind trails use x += u * step * speed; z -= v * step * speed.
 const wind=new THREE.Vector3(u,0,-v).multiplyScalar(.1*.08);
 assert.ok(drift.dot(wind)>0,'horizontal precipitation follows wind');
 for(const tilt of [0,30,60])for(let azimuth=0;azimuth<360;azimuth+=22.5){
  const a=azimuth*Math.PI/180,t=tilt*Math.PI/180,camera=new THREE.PerspectiveCamera(42,1.7,.03,12000);
  camera.position.set(50*Math.sin(t)*Math.sin(a),50*Math.cos(t),50*Math.sin(t)*Math.cos(a));
  camera.up.set(0,0,-1);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  const origin=new THREE.Vector3().project(camera),screenWind=wind.clone().project(camera).sub(origin),screenDrift=drift.clone().project(camera).sub(origin);
  assert.ok(screenWind.x*screenDrift.x+screenWind.y*screenDrift.y>0,`drift reversed: snow ${amount}, wind ${windAngle}, tilt ${tilt}, camera ${azimuth}`);projections++;
 }
}
console.log(`${projections} rotated-camera rain/snow direction checks passed (horizontal drift, excluding fall).`);
rain=snow=0;particles.update(view,1/30);assert.equal(particles.rainGeometry.instanceCount,0);assert.equal(particles.snowGeometry.drawRange.count,0);
particles.visible(false);assert.equal(particles.rain.visible,false);assert.equal(particles.snow.visible,false);
console.log('Rain-only, snow-only, dry conditions, terrain clearance and visibility passed.');

// Calm-air flakes wander independently, with slower, varied descent.
particles.visible(true);particles.count=2;rain=snow=8;
view.sample=k=>k==='rain'||k==='snow'?8:0;
particles.particles=[{x:0,z:0,y:2,seed:0,phase:0},{x:0,z:0,y:2,seed:.8,phase:2}];
for(let i=0;i<30;i++)particles.update(view,1/30);
const [a,b]=particles.particles;
assert.ok(Math.hypot(a.x-b.x,a.z-b.z)>.05,'flakes do not sway in formation');
assert.ok(a.y<b.y&&a.y>1.5,'fall speed varies gently between flakes');
const oldX=a.x;
for(let i=0;i<90;i++)particles.update(view,1/30);
assert.ok(a.x<oldX,'calm-air sway changes direction smoothly');
console.log('Independent snow sway, changing direction and varied slow descent passed.');
