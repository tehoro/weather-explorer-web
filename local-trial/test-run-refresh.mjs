import assert from 'node:assert/strict';
import {RunRefresh,nearestTime} from './run-refresh.mjs';
const times=['2026-11-21T21:00:00Z','2026-11-22T00:00:00Z'];
assert.equal(nearestTime(times,Date.parse('2026-11-21T23:30Z')),1);
let active={meta:{run:'2026111918'},json:async()=>({run:'2026112118',manifest:'2026112118/manifest.json'})};
let key='a',applied=0,release,fail=false,calls=0;
const gate=new Promise(r=>release=r),initial=active;
const candidate={meta:{run:'2026112118',times},init:async()=>{},grid:async f=>{calls++;await gate;if(fail)throw Error('offline');return {frame:f};}};
const updater=new RunRefresh({active:()=>active,view:()=>({key,region:{},time:Date.parse(times[0])}),create:()=>candidate,report:()=>{},apply:(data,grids,k)=>{assert.equal(k,key);assert.equal(grids.size,2);active=data;applied++;}});
const running=updater.check();await new Promise(r=>setTimeout(r,0));assert.equal(active,initial);assert.equal(applied,0);release();await running;assert.equal(active,candidate);assert.equal(applied,1);
active=initial;fail=true;await updater.check();assert.equal(active,initial);assert.equal(applied,1);
fail=false;candidate.grid=async f=>{key='b';return {frame:f};};await updater.check();assert.equal(active,initial);assert.equal(applied,1);
console.log('Run refresh: old data retained during preparation/failure, complete atomic adoption, and stale-view cancellation passed.');
// An export may defer adoption after staging has finished; keep the candidate.
active=initial;key='a';candidate.grid=async f=>({frame:f});let defer=true;
const deferred=new RunRefresh({active:()=>active,view:()=>({key,region:{},time:Date.parse(times[0])}),create:()=>candidate,report:()=>{},apply:data=>{if(defer)return false;active=data;return true;}});
await deferred.check();assert.equal(active,initial);assert.equal(deferred.candidate,candidate);
defer=false;await deferred.check();assert.equal(active,candidate);assert.equal(deferred.candidate,null);
console.log('Forecast adoption deferred during export retains the staged run for retry.');
