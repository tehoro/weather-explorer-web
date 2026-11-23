import assert from 'node:assert/strict';
import {readView,viewURL} from './share-view.mjs';
const state={anchor:{lat:-39.3,lon:174.1},eye:[1,3,5],target:[0,2,0],focus:{lat:-39.3,lon:174.1,name:'Taranaki & peak'},settings:{windLayer:false,cloudOpacity:'25'},playing:false,orbit:true};
const url=new URL(viewURL('http://localhost:8090/explore/global-test.html?approach=1&searchFlight=1',state,'2026-11-23T00:00:00.000Z'));
assert.deepEqual(readView(url.hash),{...state,v:1});
assert.equal(url.searchParams.has('approach'),false);
assert.equal(url.searchParams.get('time'),'2026-11-23T00:00:00.000Z');
for(const hash of ['','#view=bad','#view=null','#view='+encodeURIComponent(JSON.stringify({...state,v:1,eye:[null,0,0]})),'#view='+encodeURIComponent(JSON.stringify({...state,v:2}))])assert.equal(readView(hash),null);
console.log('View URL round trip, exact time, travel cleanup and malformed state checks passed.');
