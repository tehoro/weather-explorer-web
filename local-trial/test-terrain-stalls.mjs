import test from 'node:test';
import assert from 'node:assert/strict';
import {TerrainCache} from './terrain-cache.mjs';
import {terrainRange} from './terrain-raster.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('terrain continues when storage open hangs; a late database is closed',async()=>{
 const old=globalThis.indexedDB,request={};globalThis.indexedDB={open:()=>request};
 try{const cache=new TerrainCache('test',1024,{timeoutMs:5});assert.equal(await cache.get('a'),null);let closed=false;request.result={close(){closed=true;}};request.onsuccess();assert.equal(closed,true);}finally{globalThis.indexedDB=old;}
});
test('a hung cache read disables caching and aborts the transaction',async()=>{
 const old=globalThis.indexedDB;let aborted=false;
 const tx={objectStore:()=>({get:()=>({})}),abort(){aborted=true;this.onabort?.();}};
 globalThis.indexedDB={open:()=>{const r={result:{transaction:()=>tx}};queueMicrotask(()=>r.onsuccess());return r;}};
 try{const c=new TerrainCache('test',1024,{timeoutMs:5});assert.equal(await c.get('a'),null);assert.equal(aborted,true);assert.equal(c.disabled,true);assert.equal(await c.get('b'),null);}finally{globalThis.indexedDB=old;}
});
test('a hung cache write releases the queue and disables further writes',async()=>{
 const old=globalThis.indexedDB;globalThis.indexedDB=undefined;
 try{const c=new TerrainCache('test',1024,{timeoutMs:5}),tx={abort(){this.onabort?.();}};await c.write({transaction:()=>tx},()=>{});assert.equal(c.disabled,true);await c.write({transaction:()=>{throw Error('must not open');}},()=>{});}finally{globalThis.indexedDB=old;}
});
test('storage unavailable synchronously is a cache miss',async()=>{
 const old=globalThis.indexedDB;globalThis.indexedDB={open(){throw Error('SecurityError');}};
 try{assert.equal(await new TerrainCache().get('a'),null);}finally{globalThis.indexedDB=old;}
});
test('a stalled range body is aborted and becomes retryable',async()=>{
 const old=globalThis.fetch;let aborted=false;
 globalThis.fetch=async(url,{signal})=>({status:206,arrayBuffer:()=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Error('aborted'));}))});
 try{await assert.rejects(terrainRange('test',0,10,5),/timed out/);assert.equal(aborted,true);}finally{globalThis.fetch=old;}
});
test('successful range keeps its bytes and clears the timeout',async()=>{
 const old=globalThis.fetch;let signal;
 globalThis.fetch=async(url,o)=>{signal=o.signal;assert.equal(o.headers.Range,'bytes=2-5');return {status:206,arrayBuffer:async()=>new Uint8Array([1,2,3,4]).buffer};};
 try{assert.deepEqual(new Uint8Array(await terrainRange('test',2,5,5)),new Uint8Array([1,2,3,4]));await sleep(10);assert.equal(signal.aborted,false);}finally{globalThis.fetch=old;}
});
