import {TerrainIndex} from './terrain-index.mjs';
import {shadeWaterConsistently} from './water-material.mjs';
import {prepareSceneDepth} from './scene-depth.mjs';
import {terrainReadiness} from './terrain-readiness.mjs?v=20261122f';
import {GlobalRelief} from './global-relief.mjs?v=20261122l';
import {setupSearch} from './location-search.mjs?v=20261120j';
import {paintLand} from './basemap-texture.mjs?v=20261120g';
import * as THREE from 'three';
import {OrbitControls} from './assets/OrbitControls.js';
import {wrap,demName,detail,viewTiles} from './terrain-stream.mjs?v=20261120l';
import {sample} from './terrain-raster.mjs?v=20261122l';
import {TerrainWorker} from './terrain-worker-client.mjs';
import {WeatherView} from './weather-view.mjs?v=20261122y';
import {setupUI} from './global-ui.mjs?v=20261122o';
import {PlaceLabels} from './place-labels.mjs?v=20261122y';
setupUI();
const $=id=>document.getElementById(id),scene=new THREE.Scene();scene.background=new THREE.Color('#234557');
const renderer=new THREE.WebGLRenderer({antialias:true,logarithmicDepthBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));document.body.prepend(renderer.domElement);
const camera=new THREE.PerspectiveCamera(42,innerWidth/innerHeight,.03,12000),controls=new OrbitControls(camera,renderer.domElement);
controls.mouseButtons={LEFT:THREE.MOUSE.ROTATE,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.PAN};controls.touches={ONE:THREE.TOUCH.ROTATE,TWO:THREE.TOUCH.DOLLY_PAN};
controls.screenSpacePanning=false;controls.minDistance=4;controls.maxDistance=3200;controls.maxPolarAngle=1.35;controls.minPolarAngle=0;
scene.add(new THREE.HemisphereLight(0xc2eaff,0x293a22,2.2));const sun=new THREE.DirectionalLight(0xffefd8,2.6);sun.position.set(-200,400,-150);scene.add(sun);
let anchor={lat:-41.1,lon:174.8},serial=0,catalogue,active=0,timer,rebasing=false,lastWeather='',failures=new Map();
const tiles=new Map(),needed=new Map(),pending=new Set();let queue=[],waterQueue=[],waterActive=0,reader,terrainKey='',terrainRevision=0;
const waterMissing=new Set(),waterSize=512,globalRelief=new GlobalRelief();
globalRelief.load(scene).then(()=>{terrainRevision++;}).catch(e=>console.warn(e.message));
function resize(){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();queueMicrotask(update);}resize();addEventListener('resize',resize);
let weatherView,placeLabels,lastRender=performance.now(),approachStart=null,readySent=false;
const approaching=new URLSearchParams(location.search).has('approach'),approachLoadStart=performance.now();
addEventListener('message',event=>{if(event.origin==='http://127.0.0.1:8091'&&event.source===parent&&event.data?.type==='local-terrain-approach')approachStart=performance.now();});
renderer.setAnimationLoop(now=>{const dt=Math.min(.1,(now-lastRender)/1000);lastRender=now;weatherView?.tick(dt);placeLabels?.tick(dt);if(approaching&&!readySent&&needed.size&&backdrop){const near=[...needed.values()].filter(p=>!p.background).sort((a,b)=>a.distance-b.distance),central=near.slice(0,3),waited=now-approachLoadStart;if((central.length&&central.every(p=>tiles.has(p.key)))||(waited>12000&&near.some(p=>tiles.has(p.key)))){readySent=true;parent.postMessage({type:'local-terrain-ready'},'http://127.0.0.1:8091');}}
 if(approachStart!==null){const t=matchMedia('(prefers-reduced-motion: reduce)').matches?1:Math.min(1,(now-approachStart)/2200),e=t*t*(3-2*t),d=240+(150-240)*e;camera.position.set(0,d*(1-e*.43),d*e*.82);controls.update();if(t===1){approachStart=null;update();}}// Keep depth precision at wide zoom: a fixed 30 m near plane makes low
 // clouds and the sea round to the same depth, producing horizontal bands.
 const near=Math.max(.03,camera.position.distanceTo(controls.target)*.005);
 if(Math.abs(camera.near-near)>near*.01){camera.near=near;camera.updateProjectionMatrix();}
 globalRelief.update(anchor,controls.target,cameraFootprint());installations.shift()?.();prepareSceneDepth(scene);renderer.render(scene,camera);});
const cos=()=>Math.max(.015,Math.cos(anchor.lat*Math.PI/180));
function centre(){return {lat:Math.max(-89.85,Math.min(89.85,anchor.lat-controls.target.z/111.2)),lon:wrap(anchor.lon+controls.target.x/(111.2*cos()))};}
function position(mesh,p){
 const n=p.cells+1,v=mesh.geometry.attributes.position;
 // Bake all edges in one shared coordinate frame. Separate translated Float32
 // meshes otherwise leave hairline cracks even with identical elevation samples.
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const lon=Math.round((p.west+x*p.span/p.cells)*1e10)/1e10,lat=Math.round((p.south+p.span-y*p.span/p.cells)*1e10)/1e10,i=y*n+x;
  v.setX(i,wrap(lon-anchor.lon)*111.2);v.setZ(i,(anchor.lat-lat)*111.2);
 }
 mesh.userData.edges.forEach((src,i)=>{v.setX(n*n+i,v.getX(src));v.setZ(n*n+i,v.getZ(src));});
 v.needsUpdate=true;mesh.geometry.computeBoundingSphere();mesh.position.set(0,0,0);mesh.scale.x=cos();
}
let backdrop;
function positionBackdrop(){
 if(!backdrop)return;
 backdrop.position.set(0,-.005,anchor.lat*111.2);backdrop.scale.x=cos();
 backdrop.material.map.offset.x=anchor.lon/360;
}
// A low-cost global land/sea map is always present under streamed geometry.
// This is geographic context, not an invented ocean beneath missing land.
fetch('/explorer/basemap.json').then(r=>{if(!r.ok)throw Error('Basemap unavailable');return r.json();}).then(data=>{
 const canvas=document.createElement('canvas');canvas.width=4096;canvas.height=2048;const ctx=canvas.getContext('2d');
 ctx.fillStyle='#12384e';ctx.fillRect(0,0,4096,2048);ctx.fillStyle='#234e45';
 paintLand(ctx,data,4096,2048);
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=THREE.RepeatWrapping;
 const geometry=new THREE.PlaneGeometry(360*111.2,180*111.2);geometry.rotateX(-Math.PI/2);
 backdrop=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({map:texture,depthWrite:false,depthTest:false}));backdrop.renderOrder=-100;scene.add(backdrop);positionBackdrop();
}).catch(e=>console.warn('Global context map',e.message));
function cameraFootprint(){
 camera.updateMatrixWorld();const ray=new THREE.Raycaster(),result=[];
 for(const [x,y]of [[-1,1],[1,1],[1,-1],[-1,-1]]){
  ray.setFromCamera(new THREE.Vector2(x,y),camera);const {origin,direction}=ray.ray;
  const t=direction.y<-.0001?Math.min(9600,-origin.y/direction.y):9600;
  const point=origin.clone().addScaledVector(direction,t);
  result.push([point.x-controls.target.x,point.z-controls.target.z]);
 }
 return result;
}
function dispose(mesh){mesh.userData.disposed=true;colourQueue.delete(mesh);scene.remove(mesh);mesh.geometry.dispose();mesh.material.map?.dispose();mesh.material.dispose();}
function rebase(){
 if(controls.target.length()<30)return;
 const c=centre(),shift=new THREE.Vector3(controls.target.x,0,controls.target.z);anchor=c;
 rebasing=true;camera.position.sub(shift);controls.target.sub(shift);controls.update();rebasing=false;
 for(const {mesh,p}of tiles.values())position(mesh,p);positionBackdrop();if(weatherView)weatherView.regionKey=null;
}
function preloadStatus(){return {key:terrainKey,...terrainReadiness(needed,tiles,failures,waterMissing)};}
function status(){const c=centre(),d=detail(camera.position.distanceTo(controls.target)),s=preloadStatus();
 $('status').textContent=`${c.lat.toFixed(4)}°, ${c.lon.toFixed(4)}°\nAutomatic detail · about ${Math.round(d.span*111200/d.cells)} m sampling\nTerrain elevation: ${s.elevation}/${s.total} patches\nWater & land cover: ${s.ready}/${s.total} patches (including ocean)\n${s.failed?s.terrainFailed+' elevation and '+s.coverFailed+' water/land-cover patches waiting for automatic retry.':s.ready===s.total?'All detail for this view is ready.':'Loading detail for this view…'}`;
 $('retry').hidden=s.failed===0;
 if(reader)$('status').textContent+=`\n${reader.saved.hits} terrain/land-cover grids reused from browser storage.`;
}
const installations=[];
function installTerrain(task){return new Promise((resolve,reject)=>installations.push(()=>{try{resolve(task());}catch(e){reject(e);}}));}
function applyColour(mesh,{pixels,size}){
 const texture=new THREE.DataTexture(pixels,size,size,THREE.RGBAFormat);texture.colorSpace=THREE.SRGBColorSpace;texture.magFilter=texture.minFilter=THREE.LinearFilter;texture.needsUpdate=true;
 const first=!mesh.material.map;mesh.material.map?.dispose();mesh.material.map=texture;if(first)mesh.material.needsUpdate=true;
 renderer.initTexture(texture);
}
const colourQueue=new Map();let colouring=false;
function paint(mesh){
 const token=mesh.userData.paintToken=(mesh.userData.paintToken||0)+1;
 colourQueue.set(mesh,{token,mode:$('surfaceStyle').value});void drainColours();
}
async function drainColours(){
 if(colouring)return;colouring=true;
 try{while(colourQueue.size){
  const [mesh,{token,mode}]=colourQueue.entries().next().value;colourQueue.delete(mesh);
  if(mesh.userData.disposed)continue;
  try{const {p,a,water,ocean}=mesh.userData,result=await reader.call('colour',[{p,a,water,ocean},mode]);
   await installTerrain(()=>{if(!mesh.userData.disposed&&mesh.userData.paintToken===token)applyColour(mesh,result);});
  }catch(e){if(!mesh.userData.disposed)console.warn('Terrain colour',e.message);}
 }}finally{colouring=false;}
}

function makeMesh(p,a,ocean,prepared){
 const geometry=new THREE.BufferGeometry();
 for(const [name,key,size]of [['position','positions',3],['normal','normals',3],['uv','uvs',2]])geometry.setAttribute(name,new THREE.BufferAttribute(prepared[key],size));
 geometry.setIndex(new THREE.BufferAttribute(prepared.indices,1));
 const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({roughness:.92,metalness:.04,side:THREE.FrontSide}));shadeWaterConsistently(mesh.material);mesh.userData={p,a,ocean,edges:prepared.edges};applyColour(mesh,prepared);position(mesh,p);return mesh;
}
async function build(p){
 const name=demName(p.south+p.span/2,p.west+p.span/2),ocean=!catalogue.has(name);
 const a=ocean?null:await reader.grid('dem',p,p.cells+1,{halo:1});
 if(!needed.has(p.key))return null;const mode=$('surfaceStyle').value,prepared=await reader.call('prepare',[p,a,ocean,mode]);
 return installTerrain(()=>{if(!needed.has(p.key))return null;const mesh=makeMesh(p,a,ocean,prepared);if(mode!==$('surfaceStyle').value)paint(mesh);return mesh;});
}
function pumpWater(){
 while(waterActive<2&&waterQueue.length){const {mesh,p}=waterQueue.shift();if(tiles.get(p.key)?.mesh!==mesh)continue;waterActive++;
  reader.grid('water',p,p.background?64:waterSize,{centres:true}).then(water=>{if(tiles.get(p.key)?.mesh!==mesh)return;mesh.userData.water=water;paint(mesh);waterMissing.delete(p.key);})
  .catch(e=>{if(tiles.get(p.key)?.mesh===mesh){waterMissing.add(p.key);console.warn('Water mask',p.key,e.message);}})
  .finally(()=>{waterActive--;prune();status();pumpWater();});
 }
}
function pump(){
 while(active<3&&queue.length){const p=queue.shift();if(!needed.has(p.key)||tiles.has(p.key)||pending.has(p.key))continue;
  active++;pending.add(p.key);status();
  build(p).then(mesh=>{if(!mesh)return;if(!needed.has(p.key)){dispose(mesh);return;}tiles.set(p.key,{mesh,p});scene.add(mesh);failures.delete(p.key);if(!mesh.userData.ocean){waterQueue.push({mesh,p});waterQueue.sort((a,b)=>Number(a.p.background||false)-Number(b.p.background||false));pumpWater();}})
   .catch(e=>{if(needed.has(p.key)){failures.set(p.key,e.message);console.warn(p.key,e.message);}})
   .finally(()=>{active--;pending.delete(p.key);prune();status();pump();});
 }
}
function prune(){
 terrainRevision++;
 const complete=[...needed.keys()].every(k=>tiles.has(k)&&(tiles.get(k).mesh.userData.ocean||tiles.get(k).mesh.userData.water));
 // Keep the previous coarser surface while replacement patches arrive.
 // Retain a bounded set of hidden meshes for a quick zoom back to the previous view.
 for(const [key,{mesh}]of tiles){mesh.visible=needed.has(key)||!complete;mesh.position.y=needed.has(key)?0:-.03;}
 const distance=({mesh})=>mesh.geometry.boundingSphere.center.clone().multiply(mesh.scale).distanceTo(controls.target);
 const old=[...tiles].filter(([k])=>!needed.has(k)).sort((a,b)=>distance(b[1])-distance(a[1]));
 while(tiles.size>needed.size+36&&old.length){const [key,{mesh}]=old.shift();dispose(mesh);tiles.delete(key);}
}
function update(){
 if(!catalogue)return;rebase();const c=centre(),distance=camera.position.distanceTo(controls.target),wanted=viewTiles(c.lat,c.lon,distance,cameraFootprint());
 needed.clear();for(const p of wanted)needed.set(p.key,p);
 terrainKey=[...needed.keys()].sort().join('|');
 prune();
 for(const key of failures.keys())if(!needed.has(key))failures.delete(key);
 for(const key of waterMissing)if(!needed.has(key))waterMissing.delete(key);
 queue=wanted.filter(p=>!tiles.has(p.key)&&!pending.has(p.key)&&!failures.has(p.key));pump();status();
 weatherView?.refresh();placeLabels?.refresh();
}
controls.addEventListener('change',()=>{$('viewAngle').value=controls.getPolarAngle()<.08?'top':'slanted';if(rebasing)return;clearTimeout(timer);timer=setTimeout(update,180);});
function go(lat=anchor.lat,lon=anchor.lon){if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>89.85){$('status').textContent='Use a latitude between −89.85 and 89.85 and a finite longitude.';return;}
 anchor={lat,lon:wrap(lon)};positionBackdrop();if(weatherView)weatherView.regionKey=null;$('weather').textContent='Loading IFS at this location…';lastWeather='';serial++;for(const {mesh}of tiles.values())dispose(mesh);tiles.clear();terrainRevision++;needed.clear();failures.clear();queue=[];
 rebasing=true;controls.target.set(0,0,0);camera.position.set(0,approaching&&!readySent?240:38,approaching&&!readySent?0:55);controls.update();rebasing=false;update();}
setupSearch($('search'),$('matches'),(lat,lon)=>go(lat,lon));
$('viewAngle').onchange=()=>{const d=camera.position.distanceTo(controls.target),angle=controls.getAzimuthalAngle(),polar=$('viewAngle').value==='top'?0:Math.atan2(.82,.57);camera.position.copy(controls.target).add(new THREE.Vector3(d*Math.sin(polar)*Math.sin(angle),d*Math.cos(polar),d*Math.sin(polar)*Math.cos(angle)));controls.update();update();};
function retryTerrain(){reader?.clear();failures.clear();for(const key of waterMissing){const old=tiles.get(key);if(old)waterQueue.push(old);}waterMissing.clear();pumpWater();update();}
$('retry').onclick=()=>{retryDelay=15000;retryTerrain();};
let retryDelay=15000;
function scheduleRetry(){setTimeout(()=>{
 if(failures.size||waterMissing.size){retryTerrain();retryDelay=Math.min(120000,retryDelay*2);}else retryDelay=15000;
 scheduleRetry();
},retryDelay);}
scheduleRetry();
$('surfaceStyle').onchange=()=>{for(const {mesh}of tiles.values())paint(mesh);styleNote();};
function styleNote(){$('styleNote').textContent=$('surfaceStyle').value==='relief'?'Weather3D elevation colours. Pale high ground is a colour convention, not current snow cover.':($('surfaceStyle').value==='hybrid'?'90% relief · 10% land cover. ':'')+'WorldCover 2021; static snow/ice is not a current snow forecast.';}$('north').onclick=()=>{const d=camera.position.distanceTo(controls.target);camera.position.copy(controls.target).add(new THREE.Vector3(0,d*.57,d*.82));controls.update();};
$('in').onclick=()=>{camera.position.sub(controls.target).multiplyScalar(.55).add(controls.target);controls.update();};$('out').onclick=()=>{camera.position.sub(controls.target).multiplyScalar(1.8).add(controls.target);controls.update();};
for(const b of document.querySelectorAll('[data-pan]'))b.onclick=()=>{const [x,z]=b.dataset.pan.split(',').map(Number),d=camera.position.distanceTo(controls.target)*.6,shift=new THREE.Vector3(x*d,0,z*d);camera.position.add(shift);controls.target.add(shift);controls.update();update();};
const terrainIndex=new TerrainIndex();let indexedRevision=-1;
function groundHeight(x,z){
 if(indexedRevision!==terrainRevision){terrainIndex.rebuild(tiles.values());indexedRevision=terrainRevision;}
 const lat=anchor.lat-z/111.2,lon=anchor.lon+x/(111.2*cos()),best=terrainIndex.find(lat,lon);
 if(!best)return globalRelief.height(lat,lon);if(best.mesh.userData.ocean)return 0;
 const {p,mesh,dx,dy}=best;return sample(mesh.userData.a,p.cells+3,p.cells+3,1+dx/p.span*p.cells,1+dy/p.span*p.cells)*.0015;
}
function weatherContext(){
 const c=centre(),distance=camera.position.distanceTo(controls.target),points=cameraFootprint(),xs=points.map(p=>p[0]),zs=points.map(p=>p[1]),scale=111.2*cos();
 const west=Math.floor((c.lon+Math.max(-2400,Math.min(...xs))/scale)*4)/4,north=Math.min(90,Math.ceil((c.lat-Math.max(-2400,Math.min(...zs))/111.2)*4)/4);
 const east=Math.min(west+359,Math.ceil((c.lon+Math.min(2400,Math.max(...xs))/scale)*4)/4),south=Math.max(-90,Math.floor((c.lat-Math.min(2400,Math.max(...zs))/111.2)*4)/4);
 return {preloadStatus,terrainRevision,camera,projectPlace:(lat,lon)=>({x:wrap(lon-anchor.lon)*scale,z:(anchor.lat-lat)*111.2}),centre:c,distance,target:controls.target,ground:groundHeight,terrainMeshes:()=>[...[...tiles.values()].map(t=>t.mesh),...(globalRelief.mesh?[globalRelief.mesh]:[]),...(backdrop?[backdrop]:[])],region:{west,north,lonSpan:Math.max(.25,east-west),latSpan:Math.max(.25,north-south)},bounds:r=>{
  const w=wrap(r.west-anchor.lon)*scale;return {west:w,east:w+r.lonSpan*scale,north:(anchor.lat-r.north)*111.2,south:(anchor.lat-r.north+r.latSpan)*111.2};
 }};
}
weatherView=new WeatherView(scene,weatherContext);
placeLabels=new PlaceLabels(camera,weatherContext);
const params=new URLSearchParams(location.search);if(params.has('lat')&&params.has('lon')&&Number.isFinite(Number(params.get('lat')))&&Math.abs(Number(params.get('lat')))<=89.85&&Number.isFinite(Number(params.get('lon'))))anchor={lat:Number(params.get('lat')),lon:wrap(Number(params.get('lon')))};
fetch('/dem/tileList.txt').then(r=>{if(!r.ok)throw Error('Terrain catalogue unavailable');return r.text();}).then(text=>{catalogue=new Set(text.split(/\s+/).map(s=>s.replace(/\/$/,'')));reader=new TerrainWorker(catalogue);reader.ready.then(()=>{styleNote();go();}).catch(e=>$('status').textContent=e.message);}).catch(e=>$('status').textContent=e.message);
