import assert from 'node:assert/strict';
import {wrap,demName,waterName,detail,wantedTiles} from './terrain-stream.mjs';
assert.equal(wrap(181),-179);assert.equal(wrap(-181),179);
assert.equal(waterName(-41.1,174.8),'ESA_WorldCover_10m_2021_v200_S42E174_Map');
assert.equal(demName(-41.1,174.8),'Copernicus_DSM_COG_30_S42_00_E174_00_DEM');
assert.ok(detail(300).span/detail(300).cells>detail(10).span/detail(10).cells);
assert.ok(detail(10).span*111200/detail(10).cells<94);
for(const lat of [-89.8,-41.1,0,46,89.8])for(const lon of [-179.9,0,179.9])for(const d of [10,80,300]){
 const a=wantedTiles(lat,lon,d);assert.ok(a.length>0&&a.length<=64);
 assert.equal(new Set(a.map(p=>p.key)).size,a.length);
 assert.ok(a.every(p=>p.west>=-180&&p.west<180&&p.south>=-90&&p.south+p.span<=90));
}
const west=new Set(wantedTiles(-41,174,40).map(p=>p.key)),east=wantedTiles(-41,176,40);
assert.ok(east.some(p=>!west.has(p.key)),'Panning must request new geography');
const dateLine=wantedTiles(0,179.99,80);
assert.ok(dateLine.some(p=>p.west<0)&&dateLine.some(p=>p.west>0));
console.log('Wrapping, tile boundaries, automatic LOD and bounded working set passed.');
const {viewTiles,intersectsFootprint}=await import('./terrain-stream.mjs');
const footprint=[[-380,-550],[380,-550],[90,80],[-90,80]];
assert.equal(intersectsFootprint([-10,-500,10,-480],footprint),true);
assert.equal(intersectsFootprint([800,800,810,810],footprint),false);
const expanded=viewTiles(-38.3826,175.6192,220,footprint);
assert.ok(expanded.some(p=>p.background&&p.south>-35),'Distant visible ground must be requested beyond the old radius');
assert.ok(expanded.length<=256);
assert.ok(expanded.filter(p=>p.background).every(p=>p.cells===25));
console.log('Tilted-view footprint and coarse-background coverage checks passed.');
// Every quarter-degree cell in this visible Bay Area footprint must have a
// terrain patch, including partially occupied parents at the LOD boundary.
for(const lon of [-122.5,179.8])for(const distance of [20,60,80]){
 const lat=37.8,poly=[[-100,-210],[100,-210],[55,40],[-55,40]],patches=viewTiles(lat,lon,distance,poly),c=Math.cos(lat*Math.PI/180);
 for(let z=-205;z<35;z+=4)for(let x=-95;x<95;x+=4){
  if(!intersectsFootprint([x,z,x+.01,z+.01],poly))continue;
  const plon=wrap(lon+x/(111.2*c)),plat=lat-z/111.2;
  assert.ok(patches.some(p=>wrap(plon-p.west)>=0&&wrap(plon-p.west)<=p.span&&plat>=p.south&&plat<=p.south+p.span),`Uncovered ground ${plat},${plon}, distance ${distance}`);
 }
 assert.equal(new Set(patches.map(p=>p.key)).size,patches.length);
 assert.ok(patches.length<=256);
}
console.log('Continuous fine/coarse terrain coverage near San Francisco and the date line passed.');
