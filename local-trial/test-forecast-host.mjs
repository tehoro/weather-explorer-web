import assert from 'node:assert/strict';
import {packedTile} from './forecast-host.mjs';
const original=globalThis.fetch;
try{
 let calls=0;
 globalThis.fetch=async(url,options)=>{
  calls++;
  if(url.endsWith('tiles.json'))return Response.json({'a.bin.gz':[10,3]});
  assert.equal(options.headers.Range,'bytes=10-12');
  return new Response(new Uint8Array([1,2,3]),{status:206,headers:{'Content-Range':'bytes 10-12/30'}});
 };
 const indexes=new Map();
 assert.deepEqual([...new Uint8Array(await packedTile('https://example.test/003/a.bin.gz',indexes))],[1,2,3]);
 await packedTile('https://example.test/003/a.bin.gz',indexes);
 assert.equal(calls,3); // Index reused; each download remains bounded.
 globalThis.fetch=async()=>new Response(new Uint8Array(30),{status:200});
 await assert.rejects(packedTile('https://example.test/003/a.bin.gz',indexes),/honour tile range/);
 console.log('Forecast pack range tests passed');
}finally{globalThis.fetch=original;}
