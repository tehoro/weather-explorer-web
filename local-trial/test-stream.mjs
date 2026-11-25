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
const {distantDetail}=await import('./terrain-stream.mjs');
const flat={min:0,max:.05},mountain={min:0,max:4};
const distant=[-55,-1555,55,-1445],low={eye:[0,1,0],focal:1000,scale:1};
assert.equal(distantDetail(distant,low,flat),0,'Subpixel distant flat ground uses global relief');
assert.equal(distantDetail(distant,low,mountain),25,'Visible mountain relief retains full background detail');
assert.equal(distantDetail([-55,-100,55,0],low,flat),25,'Nearby ground retains detail');
assert.ok(distantDetail(distant,{...low,focal:5000},flat)>0,'Larger output requests more detail');
const poly=[[-5000,-8000],[5000,-8000],[80,40],[-80,40]];
const original=viewTiles(43.65,-79.38,53,poly),adaptive=viewTiles(43.65,-79.38,53,poly,{...low,eye:[0,5,50],relief:()=>flat});
assert.deepEqual(adaptive.filter(p=>!p.background),original.filter(p=>!p.background),'Near terrain is unchanged');
assert.deepEqual(adaptive.filter(p=>p.transition),original.filter(p=>p.transition),'Transition patches keep continuous coverage');
assert.ok(adaptive.length<original.length);
assert.ok(adaptive.reduce((n,p)=>n+p.cells*p.cells,0)<original.reduce((n,p)=>n+p.cells*p.cells,0));
// Around a threshold the current detail is retained, avoiding orbit churn.
let boundary;
for(let d=150;d<1500;d++){
 const r=[-55,-d-55,55,-d+55],v={eye:[0,18,0],focal:1000,scale:1};
 if(distantDetail(r,v,flat)===12&&distantDetail(r,v,flat,25)===25){boundary=true;break;}
}
assert.ok(boundary,'Detail hysteresis preserves a patch near a threshold');
console.log(`Screen-space LOD: flat oblique test ${original.length} → ${adaptive.length} patches; near detail, skyline, viewport sizing and hysteresis passed.`);

assert.equal(distantDetail(distant,{...low,eye:[0,18,0]},flat,25),25,'Reuse an existing finer patch instead of downloading a coarser duplicate');
const THREE=await import('./assets/three.module.js');
const {projectedTerrain}=await import('./terrain-stream.mjs');
function screenView(height){
 const camera=new THREE.PerspectiveCamera(42,1440/830,.01,12000);camera.position.set(0,height,50);camera.lookAt(0,.25,0);camera.updateMatrixWorld();
 return {eye:[0,height,50],matrix:new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).elements,width:2880,height:1660,focal:1660/(2*Math.tan(21*Math.PI/180)),scale:1,relief:()=>({min:.2,max:.3})};
}
const horizonView=screenView(.27),highView=screenView(18.25);
assert.equal(projectedTerrain([-10,100,10,120],flat,horizonView).width,0,'Behind-camera ground is rejected');
const lowPatches=viewTiles(44.4001,-79.6663,50,poly,horizonView),highPatches=viewTiles(44.4001,-79.6663,53,poly,highView);
assert.ok(lowPatches.length<highPatches.length,'A horizon-level view requests fewer patches than an elevated view');
assert.equal(distantDetail([-55,-800,55,-700],horizonView,{min:.2,max:4}),25,'A projected mountain skyline retains detail');
console.log(`Camera-projected test: elevated ${highPatches.length}, horizon-level ${lowPatches.length} patches (synthetic flat relief).`);
