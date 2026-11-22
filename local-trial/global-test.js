import {localPreviewReady} from './preview-readiness.mjs';
import {ARRIVAL,ease,bezier,distanceKm,globeTravel} from './camera-travel.mjs';
import {orbitStep,orbitOffset} from './camera-orbit.mjs';
import {PointForecast} from './point-forecast.mjs?v=20261122at';
import {TerrainIndex} from './terrain-index.mjs';
import {shadeWaterConsistently} from './water-material.mjs';
import {prepareSceneDepth} from './scene-depth.mjs';
import {terrainReadiness} from './terrain-readiness.mjs?v=20261122f';
import {GlobalRelief} from './global-relief.mjs?v=20261122at';
import {setupSearch} from './location-search.mjs?v=20261120j';
import {paintLand} from './basemap-texture.mjs?v=20261120g';
import * as THREE from 'three';
import {OrbitControls} from './assets/OrbitControls.js';
import {wrap,demName,detail,viewTiles} from './terrain-stream.mjs?v=20261120l';
import {sample} from './terrain-raster.mjs?v=20261122l';
import {TerrainWorker} from './terrain-worker-client.mjs';
import {WeatherView} from './weather-view.mjs?v=20261122at';
import {setupUI} from './global-ui.mjs?v=20261122at';
import {PlaceLabels} from './place-labels.mjs?v=20261122at';
setupUI();
const terrainScale=()=>Number(document.getElementById("terrainScale").value);
const $=id=>document.getElementById(id),scene=new THREE.Scene();scene.background=new THREE.Color('#234557');
const renderer=new THREE.WebGLRenderer({antialias:true,logarithmicDepthBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));document.body.prepend(renderer.domElement);
const camera=new THREE.PerspectiveCamera(42,innerWidth/innerHeight,.03,12000),controls=new OrbitControls(camera,renderer.domElement);
controls.mouseButtons={LEFT:THREE.MOUSE.ROTATE,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.PAN};controls.touches={ONE:THREE.TOUCH.ROTATE,TWO:THREE.TOUCH.DOLLY_PAN};
controls.zoomToCursor=false;controls.screenSpacePanning=false;controls.minDistance=4;controls.maxDistance=3200;controls.maxPolarAngle=Math.PI/2+.2;controls.minPolarAngle=0;
scene.add(new THREE.HemisphereLight(0xc2eaff,0x293a22,2.2));const sun=new THREE.DirectionalLight(0xffefd8,2.6);sun.position.set(-200,400,-150);scene.add(sun);
let anchor={lat:-41.1,lon:174.8},serial=0,catalogue,active=0,timer,rebasing=false,lastWeather='',failures=new Map();
const tiles=new Map(),needed=new Map(),pending=new Set();let queue=[],waterQueue=[],waterActive=0,reader,terrainKey='',terrainRevision=0;
const waterMissing=new Set(),waterSize=512,globalRelief=new GlobalRelief();
globalRelief.setScale(terrainScale());
globalRelief.load(scene).then(()=>{terrainRevision++;}).catch(e=>console.warn(e.message));
function resize(){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;centreViewport();camera.updateProjectionMatrix();queueMicrotask(update);}resize();addEventListener('resize',resize);
let pointForecast,flight=null,zoomFocus=null,focusRevision=-1,orbit=null,lastOrbitRefresh=0;
let weatherView,placeLabels,lastRender=performance.now(),approachStart=null,readySent=false;
const approaching=new URLSearchParams(location.search).has('approach'),approachLoadStart=performance.now();
addEventListener('message',event=>{if(event.origin==='http://127.0.0.1:8091'&&event.source===parent&&event.data?.type==='local-terrain-approach')approachStart=performance.now();});
renderer.setAnimationLoop(now=>{const dt=Math.min(.1,(now-lastRender)/1000);lastRender=now;tickFlight(now);syncZoomFocus(dt);tickOrbit(now);keepAboveTerrain();weatherView?.tick(dt);pointForecast?.update();placeLabels?.tick(dt);updatePointMarker();if(approaching&&!readySent&&localPreviewReady(globalRelief.mesh,weatherView?.current,now-approachLoadStart)){readySent=true;parent.postMessage({type:'local-terrain-ready'},'http://127.0.0.1:8091');}
 if(approachStart!==null){const t=matchMedia('(prefers-reduced-motion: reduce)').matches?1:Math.min(1,(now-approachStart)/2200),e=t*t*(3-2*t),d=240+(ARRIVAL.height-240)*e;camera.position.copy(controls.target).add(new THREE.Vector3(0,d,ARRIVAL.south*e));controls.update();if(t===1){approachStart=null;focusRevision=-1;syncZoomFocus();update();}}// Keep depth precision at wide zoom: a fixed 30 m near plane makes low
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
 if(flight||Math.hypot(controls.target.x,controls.target.z)<30)return;
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
 const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({roughness:.92,metalness:.04,side:THREE.FrontSide}));shadeWaterConsistently(mesh.material);mesh.scale.y=terrainScale()/1.5;mesh.userData={p,a,ocean,edges:prepared.edges};applyColour(mesh,prepared);position(mesh,p);return mesh;
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
 if(!catalogue||(approaching&&!readySent)){weatherView?.refresh();placeLabels?.refresh();return;}rebase();const c=centre(),distance=camera.position.distanceTo(controls.target),wanted=viewTiles(c.lat,c.lon,distance,cameraFootprint());
 needed.clear();for(const p of wanted)needed.set(p.key,p);
 terrainKey=[...needed.keys()].sort().join('|');
 prune();
 for(const key of failures.keys())if(!needed.has(key))failures.delete(key);
 for(const key of waterMissing)if(!needed.has(key))waterMissing.delete(key);
 queue=wanted.filter(p=>!tiles.has(p.key)&&!pending.has(p.key)&&!failures.has(p.key));pump();status();
 weatherView?.refresh();placeLabels?.refresh();
}
controls.addEventListener('change',()=>{$('viewAngle').value=controls.getPolarAngle()<.08?'top':camera.position.y-groundHeight(camera.position.x,camera.position.z)<.8?'low':'slanted';if(rebasing||orbit||flight)return;clearTimeout(timer);timer=setTimeout(update,180);});
function go(lat=anchor.lat,lon=anchor.lon){stopOrbit();zoomFocus=null;flight=null;if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>89.85){$('status').textContent='Use a latitude between −89.85 and 89.85 and a finite longitude.';return;}
 anchor={lat,lon:wrap(lon)};positionBackdrop();if(weatherView)weatherView.regionKey=null;lastWeather='';serial++;for(const {mesh}of tiles.values())dispose(mesh);tiles.clear();terrainRevision++;needed.clear();failures.clear();queue=[];
 rebasing=true;controls.target.set(0,groundHeight(0,0),0);camera.position.copy(controls.target).add(new THREE.Vector3(0,approaching&&!readySent?240:ARRIVAL.height,approaching&&!readySent?0:ARRIVAL.south));zoomFocus={lat,lon};focusRevision=-1;controls.update();rebasing=false;update();}
setupSearch($('search'),$('matches'),searchFlight);
$('viewAngle').onchange=()=>{if($('viewAngle').value==='low'){camera.position.y=groundHeight(camera.position.x,camera.position.z)+.5*terrainScale();controls.update();keepAboveTerrain();update();return;}const d=camera.position.distanceTo(controls.target),angle=controls.getAzimuthalAngle(),polar=$('viewAngle').value==='top'?0:Math.atan2(.82,.57);camera.position.copy(controls.target).add(new THREE.Vector3(d*Math.sin(polar)*Math.sin(angle),d*Math.cos(polar),d*Math.sin(polar)*Math.cos(angle)));controls.update();update();};
function retryTerrain(){reader?.clear();failures.clear();for(const key of waterMissing){const old=tiles.get(key);if(old)waterQueue.push(old);}waterMissing.clear();pumpWater();update();}
$('retry').onclick=()=>{retryDelay=15000;retryTerrain();};
let retryDelay=15000;
function scheduleRetry(){setTimeout(()=>{
 if(failures.size||waterMissing.size){retryTerrain();retryDelay=Math.min(120000,retryDelay*2);}else retryDelay=15000;
 scheduleRetry();
},retryDelay);}
scheduleRetry();
$('surfaceStyle').onchange=()=>{for(const {mesh}of tiles.values())paint(mesh);styleNote();};
function styleNote(){$('styleNote').textContent=$('surfaceStyle').value==='relief'?'Weather3D elevation colours. Pale high ground is an elevation colour. Forecast snow and sea ice are shown separately when enabled.':($('surfaceStyle').value==='hybrid'?'90% relief · 10% land cover. ':'')+'WorldCover 2021 base colours. Forecast snow and sea ice are shown separately when enabled.';}$('north').onclick=()=>{const d=camera.position.distanceTo(controls.target);camera.position.copy(controls.target).add(new THREE.Vector3(0,d*.57,d*.82));controls.update();};
$('in').onclick=()=>{camera.position.sub(controls.target).multiplyScalar(.55).add(controls.target);controls.update();};$('out').onclick=()=>{camera.position.sub(controls.target).multiplyScalar(1.8).add(controls.target);controls.update();};
for(const b of document.querySelectorAll('[data-pan]'))b.onclick=()=>{zoomFocus=null;const [x,z]=b.dataset.pan.split(',').map(Number),d=camera.position.distanceTo(controls.target)*.6,shift=new THREE.Vector3(x*d,0,z*d);camera.position.add(shift);controls.target.add(shift);controls.update();update();};
const terrainIndex=new TerrainIndex();let indexedRevision=-1;
function groundHeight(x,z){
 if(indexedRevision!==terrainRevision){terrainIndex.rebuild(tiles.values());indexedRevision=terrainRevision;}
 const lat=anchor.lat-z/111.2,lon=anchor.lon+x/(111.2*cos()),best=terrainIndex.find(lat,lon);
 if(!best)return globalRelief.height(lat,lon);if(best.mesh.userData.ocean)return 0;
 const {p,mesh,dx,dy}=best;return sample(mesh.userData.a,p.cells+3,p.cells+3,1+dx/p.span*p.cells,1+dy/p.span*p.cells)*.001*terrainScale();
}
function weatherContext(){
 const c=centre(),distance=camera.position.distanceTo(controls.target),points=cameraFootprint(),xs=orbit?[-orbit.coverage,orbit.coverage]:points.map(p=>p[0]),zs=orbit?[-orbit.coverage,orbit.coverage]:points.map(p=>p[1]),scale=111.2*cos();
 const west=Math.floor((c.lon+Math.max(-2400,Math.min(...xs))/scale)*4)/4,north=Math.min(90,Math.ceil((c.lat-Math.max(-2400,Math.min(...zs))/111.2)*4)/4);
 const east=Math.min(west+359,Math.ceil((c.lon+Math.min(2400,Math.max(...xs))/scale)*4)/4),south=Math.max(-90,Math.floor((c.lat-Math.min(2400,Math.max(...zs))/111.2)*4)/4);
 const coarseSightGrid={left:-180*scale-anchor.lon*scale,right:180*scale-anchor.lon*scale,top:(anchor.lat-90)*111.2,bottom:(anchor.lat+90)*111.2,stepX:scale/12,stepZ:111.2/12,
   height:(x,z)=>globalRelief.height(anchor.lat-z/111.2,anchor.lon+x/scale)};
  return {travelling:!!flight,cloudScale:Number($("cloudScale").value),focusedPlace:zoomFocus,orbiting:!!orbit,placeMesh:(x,z)=>{groundHeight(x,z);return terrainIndex.find(anchor.lat-z/111.2,anchor.lon+x/scale)?.mesh;},coarseSightGrid,preloadStatus,terrainRevision,camera,projectPlace:(lat,lon)=>({x:wrap(lon-anchor.lon)*scale,z:(anchor.lat-lat)*111.2}),centre:c,distance,target:controls.target,ground:groundHeight,terrainMeshes:()=>[...[...tiles.values()].map(t=>t.mesh),...(globalRelief.mesh?[globalRelief.mesh]:[]),...(backdrop?[backdrop]:[])],region:{west,north,lonSpan:Math.max(.25,east-west),latSpan:Math.max(.25,north-south)},bounds:r=>{
  const w=wrap(r.west-anchor.lon)*scale;return {west:w,east:w+r.lonSpan*scale,north:(anchor.lat-r.north)*111.2,south:(anchor.lat-r.north+r.latSpan)*111.2};
 }};
}
weatherView=new WeatherView(scene,weatherContext);
placeLabels=new PlaceLabels(camera,weatherContext,(lat,lon)=>({x:wrap(lon-anchor.lon)*111.2*cos(),z:(anchor.lat-lat)*111.2}));
pointForecast=new PointForecast(weatherView,flyToPoint);weatherView.pointForecast=pointForecast;
// Panel visibility never changes the camera. Reframe only on explicit centring.
const pointMarker=document.createElement('div');pointMarker.id='pointMarker';pointMarker.hidden=true;document.body.append(pointMarker);
function updatePointMarker(){
 const p=pointForecast?.location;if(!p){if(typeof pointMarker!=='undefined')pointMarker.hidden=true;return;}
 const v=weatherContext().projectPlace(p.lat,p.lon),q=new THREE.Vector3(v.x,groundHeight(v.x,v.z)+.01,v.z).project(camera);
 pointMarker.hidden=q.z< -1||q.z>1;pointMarker.style.transform=`translate(${(q.x+1)*innerWidth/2}px,${(1-q.y)*innerHeight/2}px)`;
}
addEventListener('local-place-select',e=>{pointForecast.select(e.detail.lat,e.detail.lon,e.detail.name);flyToPoint(pointForecast.location);});
let clickStart,pointClickTimer,lastPicked,lastPickTime=0;
renderer.domElement.addEventListener('pointerdown',e=>{clickStart={x:e.clientX,y:e.clientY,id:e.pointerId,button:e.button};});
renderer.domElement.addEventListener('pointerup',e=>{
 const p=clickStart;clickStart=null;if(!p||p.button!==0||p.id!==e.pointerId||Math.hypot(e.clientX-p.x,e.clientY-p.y)>5)return;
 camera.updateMatrixWorld();const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(e.clientX/innerWidth*2-1,1-e.clientY/innerHeight*2),camera);
 const hit=ray.intersectObjects([...tiles.values()].filter(t=>t.mesh.visible).map(t=>t.mesh),false)[0];
 let point=hit?.point;
 if(!point){let last=ray.ray.origin.clone(),above=last.y-groundHeight(last.x,last.z);
  for(let d=.1;d<12000;d=d*1.08+.1){const q=ray.ray.at(d,new THREE.Vector3()),gap=q.y-groundHeight(q.x,q.z);
   if(gap<=0&&above>0){let a=last,b=q;for(let i=0;i<18;i++){const mid=a.clone().lerp(b,.5);if(mid.y>groundHeight(mid.x,mid.z))a=mid;else b=mid;}point=b;break;}last=q;above=gap;}
 }
 if(point){
  if(performance.now()-lastPickTime>400)lastPicked={lat:anchor.lat-point.z/111.2,lon:wrap(anchor.lon+point.x/(111.2*cos()))};
  lastPickTime=performance.now();clearTimeout(pointClickTimer);
  pointClickTimer=setTimeout(()=>pointForecast.select(lastPicked.lat,lastPicked.lon),400);
 }
});
renderer.domElement.addEventListener('dblclick',()=>{clearTimeout(pointClickTimer);if(lastPicked&&performance.now()-lastPickTime<400){pointForecast.select(lastPicked.lat,lastPicked.lon);flyToPoint(pointForecast.location);}});
controls.addEventListener('start',()=>{if(flight)zoomFocus=null;flight=null;approachStart=null;stopOrbit();});
function flyToPoint(p){
 if(!p)return;stopOrbit();approachStart=null;zoomFocus={lat:p.lat,lon:p.lon,name:p.name};focusRevision=-1;const q=weatherContext().projectPlace(p.lat,p.lon),target=new THREE.Vector3(q.x,groundHeight(q.x,q.z),q.z),offset=camera.position.clone().sub(controls.target);
 const end=target.clone().add(offset),start=camera.position.clone();let lift=0;
 for(let i=0;i<=64;i++){const t=i/64,v=start.clone().lerp(end,t);lift=Math.max(lift,groundHeight(v.x,v.z)+.3-v.y);}
 flight={start:performance.now(),from:controls.target.clone(),to:target,eye:start,end,lift:Math.max(0,lift)+.2};
 centreViewport();
}
function searchFlight(lat,lon,name){
 stopOrbit();flight=null;approachStart=null;const time=weatherView?.pauseForTravel(true),from=centre(),destination={lat,lon,name};
 if(globeTravel(from,destination)){
  const message={type:'local-search-flight',from,to:destination,time};
  if(parent!==window)parent.postMessage(message,'http://127.0.0.1:8091');
  else location.href='http://127.0.0.1:8091/?'+new URLSearchParams({travel:JSON.stringify(message)});
  return;
 }
 pointForecast.select(lat,lon,name);zoomFocus=destination;focusRevision=-1;
 const q=weatherContext().projectPlace(lat,lon),target=new THREE.Vector3(q.x,groundHeight(q.x,q.z),q.z),eye=camera.position.clone(),end=target.clone().add(new THREE.Vector3(0,ARRIVAL.height,ARRIVAL.south));
 const distance=eye.distanceTo(end),reach=Math.min(180,Math.max(5,distance*.3)),forward=controls.target.clone().sub(eye).normalize();
 const first=eye.clone().addScaledVector(forward,reach),second=end.clone().add(new THREE.Vector3(0,Math.min(45,distance*.1),reach));
 let lift=0;for(let i=1;i<64;i++){const t=i/64,p=bezier(eye,first,second,end,t);lift=Math.max(lift,(groundHeight(p.x,p.z)+.5*terrainScale()-p.y)/Math.sin(Math.PI*t));}
 flight={kind:'search',start:performance.now(),duration:Math.min(6000,3200+distanceKm(from,destination)*5),from:controls.target.clone(),to:target,eye,end,first,second,lift:Math.max(0,lift),lastRefresh:0};
 centreViewport();
}
function centreViewport(){
 if(document.body.classList.contains("clean"))return;
 const w=innerWidth,h=innerHeight,settings=$('settingsPanel'),point=$('pointForecast'),right=settings&&!settings.hidden?settings.getBoundingClientRect().left:w,left=point&&!point.hidden?point.getBoundingClientRect().right:0;
 const top=80,bottom=$('timeline').getBoundingClientRect().top;
 if(right-left>200)camera.setViewOffset(w,h,(w-left-right)/2,(h-top-bottom)/2,w,h);else camera.clearViewOffset();
 camera.updateProjectionMatrix();
}
function tickFlight(now){
 if(!flight)return;const f=flight,t=matchMedia('(prefers-reduced-motion: reduce)').matches?1:Math.min(1,(now-f.start)/(f.duration||2400)),u=t*t*(3-2*t);
 controls.target.copy(f.from).lerp(f.to,u);
 if(f.kind==='search'){const p=bezier(f.eye,f.first,f.second,f.end,u);camera.position.set(p.x,p.y,p.z);if(now-f.lastRefresh>750){f.lastRefresh=now;weatherView?.refresh();placeLabels?.refresh();}}
 else camera.position.copy(f.eye).lerp(f.end,u);camera.position.y+=Math.sin(Math.PI*u)*f.lift;
 camera.position.y=Math.max(camera.position.y,groundHeight(camera.position.x,camera.position.z)+.3);controls.update();
 if(t===1){const dy=groundHeight(f.to.x,f.to.z)-controls.target.y;controls.target.y+=dy;camera.position.y+=dy;controls.update();flight=null;focusRevision=-1;syncZoomFocus();update();weatherView?.prepare();}
}

function stopOrbit(){orbit=null;const button=$('orbitToggle');button.textContent='Orbit';button.setAttribute('aria-pressed','false');}
$('orbitToggle').onclick=()=>{
 if(orbit){stopOrbit();update();return;}
 if(flight)tickFlight(flight.start+(flight.duration||2400));
 rebase();
 const offset=camera.position.clone().sub(controls.target);
 const radius=Math.hypot(offset.x,offset.z),bearing=Math.atan2(offset.x,offset.z);let altitude=camera.position.y;
 // Check the complete circuit once. Climb before rotating, then hold MSL height.
 for(let i=0;i<180;i++){const p=orbitOffset(radius,0,i*Math.PI/90);altitude=Math.max(altitude,groundHeight(controls.target.x+p.x,controls.target.z+p.z)+.5*terrainScale());}
 const coverage=Math.min(2400,Math.max(...cameraFootprint().map(p=>Math.hypot(...p))));
 orbit={coverage,radius,bearing,altitude,fromAltitude:camera.position.y,start:performance.now(),last:performance.now()};
 $('orbitToggle').textContent='Stop orbit';$('orbitToggle').setAttribute('aria-pressed','true');lastOrbitRefresh=0;clearTimeout(timer);
};
function tickOrbit(now){
 if(!orbit||flight)return;
 const seconds=(now-orbit.last)/1000;orbit.last=now;
 if(document.hidden)return;
 const climb=orbit.altitude===orbit.fromAltitude?1:ease((now-orbit.start)/1500);
 if(climb===1)orbit.bearing=orbitStep(orbit.bearing,seconds,Math.max(10,Math.min(3600,Number($('orbitPeriod').value)||120)));
 const offset=orbitOffset(orbit.radius,0,orbit.bearing);
 camera.position.set(controls.target.x+offset.x,orbit.fromAltitude+(orbit.altitude-orbit.fromAltitude)*climb,controls.target.z+offset.z);
 controls.update();
 // Continuous motion must not postpone streaming indefinitely via debounce.
 if(now-lastOrbitRefresh>750){lastOrbitRefresh=now;update();}
}
document.addEventListener('visibilitychange',()=>{if(orbit)orbit.last=performance.now();});
for(const id of ['viewAngle','north','in','out'])$(id).addEventListener('click',()=>{stopOrbit();if(flight)zoomFocus=null;flight=null;approachStart=null;});
for(const b of document.querySelectorAll('[data-pan]'))b.addEventListener('click',()=>{stopOrbit();flight=null;approachStart=null;});
$('viewAngle').addEventListener('change',stopOrbit);

// Keep about 500 real metres above the exaggerated terrain.
function keepAboveTerrain(){
 const floor=groundHeight(camera.position.x,camera.position.z)+.5*terrainScale();
 if(camera.position.y<floor){camera.position.y=floor;if(orbit){stopOrbit();$("status").textContent="Orbit stopped: terrain crosses the camera altitude.";}controls.update();}
}
// Zoom and orbit share the selected ground point. Update its height when finer
// terrain arrives, moving the camera by the same amount to preserve the view.
function syncZoomFocus(dt){
 if(!zoomFocus||flight||orbit||focusRevision===terrainRevision)return;
 const q=weatherContext().projectPlace(zoomFocus.lat,zoomFocus.lon),target=new THREE.Vector3(q.x,groundHeight(q.x,q.z),q.z),shift=target.clone().sub(controls.target);
 if(dt!==undefined&&shift.length()>.0001)shift.multiplyScalar(1-Math.exp(-dt/.6));else focusRevision=terrainRevision;
 camera.position.add(shift);controls.target.add(shift);controls.update();
}
renderer.domElement.addEventListener('wheel',()=>{if(flight?.kind==='search'){flight=null;zoomFocus=null;}else if(flight)tickFlight(flight.start+(flight.duration||2400));syncZoomFocus();},{capture:true,passive:true});
// A deliberate pan chooses a new focus; ordinary wheel zoom and rotation do not.
renderer.domElement.addEventListener('pointerdown',e=>{if(e.button===2)zoomFocus=null;},{capture:true});
renderer.domElement.addEventListener('touchstart',e=>{if(e.touches.length>1)zoomFocus=null;},{capture:true,passive:true});

const params=new URLSearchParams(location.search);if(params.has('lat')&&params.has('lon')&&Number.isFinite(Number(params.get('lat')))&&Math.abs(Number(params.get('lat')))<=89.85&&Number.isFinite(Number(params.get('lon'))))anchor={lat:Number(params.get('lat')),lon:wrap(Number(params.get('lon')))};
go();zoomFocus.name=params.get('name')||undefined;if(params.get('searchFlight')==='1'){pointForecast.select(anchor.lat,anchor.lon,zoomFocus.name);centreViewport();}
fetch('/dem/tileList.txt').then(r=>{if(!r.ok)throw Error('Terrain catalogue unavailable');return r.text();}).then(text=>{const available=new Set(text.split(/\s+/).map(s=>s.replace(/\/$/,'')));reader=new TerrainWorker(available);reader.ready.then(()=>{catalogue=available;styleNote();update();}).catch(e=>$('status').textContent=e.message);}).catch(e=>$('status').textContent=e.message);

$('terrainScale').addEventListener('input',()=>{globalRelief.setScale(terrainScale());for(const {mesh}of tiles.values())mesh.scale.y=terrainScale()/1.5;terrainRevision++;focusRevision=-1;syncZoomFocus();keepAboveTerrain();});
