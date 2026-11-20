import assert from 'node:assert/strict';
import {isWater,pixelTransform,sample,sourceName,RasterReader} from './terrain-raster.mjs';
assert.equal(isWater(0,0),true,'Zero-filled offshore pixels must not become land');
assert.equal(isWater(10,0),false,'Known land at sea level remains land');
assert.equal(isWater(0,500),false,'Missing classification on mountains is not water');
assert.equal(isWater(80,450),true,'An elevated lake remains blue');
assert.equal(sourceName('dem',-41,175),'Copernicus_DSM_COG_30_S42_00_E175_00_DEM');
assert.deepEqual(pixelTransform([10,20],[1,-1],100,100,50,50,true),{x:10.5,y:19.5,dx:2,dy:-2});
assert.deepEqual(pixelTransform([10,20],[1,-1],100,100,50,50,false),{x:11,y:19,dx:2,dy:-2});
assert.equal(sample(new Float32Array([0,10,20,30]),2,2,.5,.5),15);
console.log('Water classification and pixel-centre checks passed.');
if(process.argv.includes('--live')){
 globalThis.Worker=class {};await import('./assets/geotiff-2.1.3.js');
 const root='http://127.0.0.1:8092',catalogue=new Set((await(await fetch(root+'/dem/tileList.txt')).text()).trim().split(/\s+/).map(s=>s.replace(/\/$/,'')));
 const reader=new RasterReader(globalThis.GeoTIFF,root,catalogue),size=76,h=size+2;
 const a=await reader.grid('dem',{west:174.75,south:-41.25,span:.25},size,{halo:1});
 const b=await reader.grid('dem',{west:175,south:-41.25,span:.25},size,{halo:1});
 for(let y=1;y<=size;y++){
  assert.equal(a[y*h+size],b[y*h+1],'Shared source-tile edge must be identical');
  assert.equal(a[y*h+size+1]-a[y*h+size-1],b[y*h+2]-b[y*h],'Normal halo must match');
 }
 const north=await reader.grid('dem',{west:174.75,south:-41,span:.25},size,{halo:1});
 for(let x=1;x<=size;x++){
  assert.equal(a[h+x],north[size*h+x],'Shared latitude edge must be identical');
  assert.equal(a[2*h+x]-a[x],north[(size+1)*h+x]-north[(size-1)*h+x],'North/south normals must match');
 }
 const start=performance.now();await reader.grid('dem',{west:175,south:-41.25,span:.25},size,{halo:1});
 console.log('Actual Copernicus cross-file heights and normal halos match; repeat grid '+(performance.now()-start).toFixed(1)+' ms.');
 const p={west:174.5,south:-40.5,span:.01},water=await reader.grid('water',p,2,{centres:true}),dem=await reader.grid('dem',p,2);
 assert.ok([...water].every((c,i)=>isWater(c,dem[i])),'Reported offshore area is water');
 console.log('Reported offshore pixels verified as water.');
}
