import assert from 'node:assert/strict';
import {exportFrame,frameTiming,cancellable} from './video-export.mjs';
assert.equal(exportFrame(2.25,3,1,27,true),3.25);
assert.equal(exportFrame(2.25,3,2,27,true),4.25);
assert.equal(exportFrame(2.25,90,1,27,false),2.25);
assert.equal(exportFrame(26,120,1,27,true),27);
let end=0;for(let i=0;i<3600;i++){const f=frameTiming(i);assert.equal(f.timestamp,end);end=f.timestamp+f.duration;}
assert.equal(end,120000000,'Full two-minute orbit has exactly 3600 evenly timed frames');
const abort=new AbortController(),pending=cancellable(new Promise(()=>{}),abort.signal);abort.abort();await assert.rejects(pending,{name:'AbortError'});
assert.equal(await cancellable(Promise.resolve(12),new AbortController().signal),12);
console.log('Fixed 30 fps timing, forecast progression, paused export, end hold and cancellation passed.');
