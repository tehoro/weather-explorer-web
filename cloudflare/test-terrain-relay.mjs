import assert from 'node:assert/strict';
import relay from './terrain-relay.mjs';
const real=globalThis.fetch;let called=0;
try{
 globalThis.fetch=async(url,options)=>{called++;assert.match(url,/^https:\/\/copernicus-dem-90m.s3.amazonaws.com\/Copernicus_/);assert.equal(options.headers.Range,'bytes=0-1023');return new Response(new Uint8Array(1024),{status:206,headers:{'Content-Range':'bytes 0-1023/2000','Content-Length':'1024'}});};
 let r=await relay.fetch(new Request('https://relay/dem/Copernicus_DSM_COG_30_N46_00_E007_00_DEM.tif',{headers:{Range:'bytes=0-1023'}}));assert.equal(r.status,206);assert.equal(r.headers.get('Access-Control-Allow-Origin'),'*');assert.equal((await r.arrayBuffer()).byteLength,1024);
 for(const path of ['/https://private.test/','/dem/bad.tif'])assert.equal((await relay.fetch(new Request('https://relay'+path))).status,404);
 r=await relay.fetch(new Request('https://relay/dem/Copernicus_DSM_COG_30_N46_00_E007_00_DEM.tif'));assert.equal(r.status,400);assert.equal(called,1);
 console.log('Terrain relay: allowed source, range and rejected paths passed');
}finally{globalThis.fetch=real;}
