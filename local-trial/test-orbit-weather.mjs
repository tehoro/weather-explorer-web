import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./weather-view.mjs',import.meta.url),'utf8');
const block=source.slice(source.indexOf('  const oldBounds=this.particleRegion'),source.indexOf("  $('precipitationLegend')"));
const refresh=new Function('context','r','N',block);
const bounds={west:-10,east:10,north:-10,south:10},particle={history:[[1,2,3]]};
const owner={particleRegion:{},particleBounds:{...bounds},bounds:{west:-20,east:20,north:-20,south:20},particles:[particle],rain:[{}],streaks:{reset(){owner.resets++;}},resets:0,spawn:()=>({}),spawnRain:()=>({})};
refresh.call(owner,{bounds:()=>bounds},{},1);
assert.equal(owner.particles[0],particle);assert.equal(owner.resets,0);
// Refining the same region also preserves the complete history.
refresh.call(owner,{bounds:()=>owner.bounds},{},1);
assert.equal(owner.particles[0],particle);assert.equal(owner.resets,0);
refresh.call(owner,{bounds:()=>({...owner.bounds,west:-30})},{},1);
assert.notEqual(owner.particles[0],particle);assert.equal(owner.resets,1);
const camera=readFileSync(new URL('./global-test.js',import.meta.url),'utf8');
assert.match(camera,/xs=orbit\?\[-orbit.coverage,orbit.coverage\]/);
assert.match(camera,/zs=orbit\?\[-orbit.coverage,orbit.coverage\]/);
console.log('Orbit weather footprint stays fixed; refreshed regions retain wind history; rebasing resets safely.');
