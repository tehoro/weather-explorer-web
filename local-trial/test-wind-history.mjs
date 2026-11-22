import assert from 'node:assert/strict';
import {advanceWindHistory} from './wind-history.mjs';
function run(fps){
 const p={x:0,z:0,history:Array.from({length:24},()=>[0,0,0])};let phase=0;
 for(let i=0;i<fps;i++){const dt=1/fps,first=1/30-phase;phase=(phase+dt)%(1/30);p.x+=dt;advanceWindHistory(p,dt,first,()=>0);assert.equal(p.history[0][0],p.x);}
 return p;
}
for(const fps of [30,60,120]){const p=run(fps);assert.ok(Math.abs(p.x-1)<1e-10);assert.ok(Math.abs(p.history.at(-1)[0]-.2666667)<.034);assert.equal(new Set(p.history).size,24);}
console.log('Wind heads move each render; history duration stays consistent at 30, 60 and 120 Hz.');
