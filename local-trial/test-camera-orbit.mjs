import assert from 'node:assert/strict';
import {orbitStep,orbitOffset} from './camera-orbit.mjs';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
close(orbitStep(0,30),Math.PI/2);close(Math.sin(orbitStep(0,120)),0);close(Math.cos(orbitStep(0,120)),1);close(orbitStep(0,30,60),Math.PI);
for(const fps of [30,60,120]){let angle=0;for(let i=0;i<fps*30;i++)angle=orbitStep(angle,1/fps);close(angle,Math.PI/2);}
for(const angle of [0,1,2,3,4,5]){const p=orbitOffset(12,3,angle);close(Math.hypot(p.x,p.z),12);close(p.y,3);}
console.log('Orbit: 120-second circuit, adjustable period, frame-rate independence, fixed radius and tilt.');
