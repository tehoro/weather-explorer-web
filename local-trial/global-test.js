import {terrainReadiness} from './terrain-readiness.mjs?v=20261122f';
import {GlobalRelief} from './global-relief.mjs?v=20261122k';
import {setupSearch} from './location-search.mjs?v=20261120j';
import {paintLand} from './basemap-texture.mjs?v=20261120g';
import * as THREE from 'three';
import {OrbitControls} from './assets/OrbitControls.js';
import {wrap,demName,detail,viewTiles} from './terrain-stream.mjs?v=20261120l';
import {RasterReader,sample,isWater} from './terrain-raster.mjs?v=20261122k';
import {WeatherView} from './weather-view.mjs?v=20261122k';
import {setupUI} from './global-ui.mjs?v=20261122k';
import {PlaceLabels} from './place-labels.mjs?v=20261120s';
setupUI();
const $=id=>document.getElementById(id),scene=new THREE.Scene();scene.background=new THREE.Color('#234557');
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));document.body.prepend(renderer.domElement);
const camera=new THREE.PerspectiveCamera(42,innerWidth/innerHeight,.03,12000),controls=new OrbitControls(camera,renderer.domElement);
controls.mouseButtons={LEFT:THREE.MOUSE.ROTATE,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.PAN};controls.touches={ONE:THREE.TOUCH.ROTATE,TWO:THREE.TOUCH.DOLLY_PAN};
controls.screenSpacePanning=false;controls.minDistance=4;controls.maxDistance=3200;controls.maxPolarAngle=1.35;controls.minPolarAngle=0;
scene.add(new THREE.HemisphereLight(0xc2eaff,0x293a22,2.2));const sun=new THREE.DirectionalLight(0xffefd8,2.6);sun.position.set(-200,400,-150);scene.add(sun);
let anchor={lat:-41.1,lon:174.8},serial=0,catalogue,active=0,timer,rebasing=false,lastWeather='',failures=new Map();
const tiles=new Map(),needed=new Map(),pending=new Set();let queue=[],waterQueue=[],waterActive=0,reader,terrainKey='';
const waterMissing=new Set(),waterSize=512,globalRelief=new GlobalRelief();
globalRelief.load(scene).catch(e=>console.warn(e.message));
function resize(){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();queueMicrotask(update);}resize();addEventListener('resize',resize);
let weatherView,placeLabels,lastRender=performance.now(),approachStart=null,readySent=false;
const approaching=new URLSearchParams(location.search).has('approach'),approachLoadStart=performance.now();
addEventListener('message',event=>{if(event.origin==='http://127.0.0.1:8091'&&event.source===parent&&event.data?.type==='local-terrain-approach')approachStart=performance.now();});
renderer.setAnimationLoop(now=>{const dt=Math.min(.1,(now-lastRender)/1000);lastRender=now;weatherView?.tick(dt);placeLabels?.tick(dt);if(approaching&&!readySent&&needed.size&&backdrop){const near=[...needed.values()].filter(p=>!p.background).sort((a,b)=>a.distance-b.distance),central=near.slice(0,3),waited=now-approachLoadStart;if((central.length&&central.every(p=>tiles.has(p.key)))||(waited>12000&&near.some(p=>tiles.has(p.key)))){readySent=true;parent.postMessage({type:'local-terrain-ready'},'http://127.0.0.1:8091');}}
 if(approachStart!==null){const t=matchMedia('(prefers-reduced-motion: reduce)').matches?1:Math.min(1,(now-approachStart)/2200),e=t*t*(3-2*t),d=240+(150-240)*e;camera.position.set(0,d*(1-e*.43),d*e*.82);controls.update();if(t===1){approachStart=null;update();}}globalRelief.update(anchor,controls.target,cameraFootprint());renderer.render(scene,camera);});
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
 backdrop=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({map:texture,roughness:.92,metalness:.04,depthWrite:false,depthTest:false}));backdrop.renderOrder=-100;scene.add(backdrop);positionBackdrop();
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
function dispose(mesh){scene.remove(mesh);mesh.geometry.dispose();mesh.material.map?.dispose();mesh.material.dispose();}
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
const terrainStops=[[0,'#234e45'],[200,'#477353'],[700,'#7a8960'],[1400,'#9b9b80'],[2200,'#b3b3aa'],[3000,'#e7eff0']].map(([z,c])=>[z,new THREE.Color(c)]);
const coverColours={10:'#315d3c',20:'#78834e',30:'#81985c',40:'#a0a56a',50:'#a49a90',60:'#a7a18e',70:'#e4ecee',90:'#547a67',95:'#315d50',100:'#989578'};
const rgb=c=>{const v=new THREE.Color(c).convertLinearToSRGB();return [v.r*255,v.g*255,v.b*255];};
const coverRGB=Object.fromEntries(Object.entries(coverColours).map(([k,c])=>[k,rgb(c)])),seaRGB=rgb('#12384e');
const reliefRGB=Array.from({length:1801},(_,i)=>{const z=i*5;let c=terrainStops.at(-1)[1].clone();for(let j=1;j<terrainStops.length;j++)if(z<=terrainStops[j][0]){const [a,ca]=terrainStops[j-1],[b,cb]=terrainStops[j];c=ca.clone().lerp(cb,Math.max(0,(z-a)/(b-a)));break;}return rgb(c);});
function paint(mesh){
 const {p,a,water,ocean}=mesh.userData,n=p.cells+1,hn=n+2,size=p.background?64:waterSize,pixels=new Uint8Array(size*size*4),mode=$('surfaceStyle').value;
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const i=y*size+x,z=ocean?0:sample(a,hn,hn,1+(x+.5)/size*p.cells,1+(y+.5)/size*p.cells),code=water?.[i];
  let c=reliefRGB[Math.min(1800,Math.max(0,Math.round(z/5)))];
  if(isWater(code??0,z,ocean))c=seaRGB;
  else if(mode!=='relief'&&coverRGB[code]){const cc=coverRGB[code];c=mode==='cover'?cc:c.map((v,j)=>v*.9+cc[j]*.1);}
  pixels.set([Math.round(c[0]),Math.round(c[1]),Math.round(c[2]),255],i*4);
 }
 const texture=new THREE.DataTexture(pixels,size,size,THREE.RGBAFormat);texture.colorSpace=THREE.SRGBColorSpace;texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearFilter;texture.needsUpdate=true;
 mesh.material.map?.dispose();mesh.material.map=texture;mesh.material.needsUpdate=true;
}
function makeMesh(p,a,ocean){
 const n=p.cells+1,hn=n+2,width=p.span*111.2,step=width/p.cells,geometry=new THREE.PlaneGeometry(width,width,p.cells,p.cells);geometry.rotateX(-Math.PI/2);
 const v=geometry.attributes.position,uv=geometry.attributes.uv,normal=geometry.attributes.normal,vector=new THREE.Vector3();
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const i=y*n+x,j=(y+1)*hn+x+1,height=ocean?0:a[j];if(!Number.isFinite(height)||height<-1000||height>10000)throw Error('Invalid elevation');
  v.setY(i,height/1000*1.5);uv.setY(i,1-uv.getY(i));
  // Shared halo samples produce identical normals at neighbouring patch edges.
  vector.set(ocean?0:-(a[j+1]-a[j-1])*.0015/(2*step),1,ocean?0:-(a[j+hn]-a[j-hn])*.0015/(2*step)).normalize();normal.setXYZ(i,vector.x,vector.y,vector.z);
 }
 const edges=[];for(let i=0;i<n;i++)edges.push(i);for(let i=1;i<n;i++)edges.push(i*n+n-1);
 for(let i=n-2;i>=0;i--)edges.push((n-1)*n+i);for(let i=n-2;i>0;i--)edges.push(i*n);
 const positions=new Float32Array((n*n+edges.length)*3),uvs=new Float32Array((n*n+edges.length)*2),normals=new Float32Array(positions.length);
 positions.set(v.array);uvs.set(uv.array);normals.set(normal.array);const indices=Array.from(geometry.index.array);
 edges.forEach((src,i)=>{const dst=n*n+i;positions.set([v.getX(src),v.getY(src)-.15,v.getZ(src)],dst*3);uvs.set([uv.getX(src),uv.getY(src)],dst*2);normals.set([normal.getX(src),normal.getY(src),normal.getZ(src)],dst*3);const next=(i+1)%edges.length;indices.push(src,edges[next],n*n+next,src,n*n+next,dst);});
 geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));
 const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({roughness:.92,metalness:.04,side:THREE.FrontSide}));mesh.userData={p,a,ocean,edges};paint(mesh);position(mesh,p);return mesh;
}
async function build(p){
 const name=demName(p.south+p.span/2,p.west+p.span/2),ocean=!catalogue.has(name);
 const a=ocean?null:await reader.grid('dem',p,p.cells+1,{halo:1});
 if(!needed.has(p.key))return null;return makeMesh(p,a,ocean);
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
 anchor={lat,lon:wrap(lon)};positionBackdrop();if(weatherView)weatherView.regionKey=null;$('weather').textContent='Loading IFS at this location…';lastWeather='';serial++;for(const {mesh}of tiles.values())dispose(mesh);tiles.clear();needed.clear();failures.clear();queue=[];
 rebasing=true;controls.target.set(0,0,0);camera.position.set(0,approaching&&!readySent?240:38,approaching&&!readySent?0:55);controls.update();rebasing=false;update();}
setupSearch($('search'),$('matches'),(lat,lon)=>go(lat,lon));
$('viewAngle').onchange=()=>{const d=camera.position.distanceTo(controls.target),angle=controls.getAzimuthalAngle(),polar=$('viewAngle').value==='top'?0:Math.atan2(.82,.57);camera.position.copy(controls.target).add(new THREE.Vector3(d*Math.sin(polar)*Math.sin(angle),d*Math.cos(polar),d*Math.sin(polar)*Math.cos(angle)));controls.update();update();};
function retryTerrain(){reader?.files.clear();failures.clear();for(const key of waterMissing){const old=tiles.get(key);if(old)waterQueue.push(old);}waterMissing.clear();pumpWater();update();}
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
function groundHeight(x,z){
 const lat=anchor.lat-z/111.2,lon=anchor.lon+x/(111.2*cos());let best=null;
 for(const t of tiles.values()){if(!t.mesh.visible)continue;const dx=((lon-t.p.west)%360+360)%360,dy=t.p.south+t.p.span-lat;
  if(dx<=t.p.span&&dy>=0&&dy<=t.p.span&&(!best||t.p.span/t.p.cells<best.p.span/best.p.cells))best={...t,dx,dy};
 }
 if(!best)return globalRelief.height(lat,lon);if(best.mesh.userData.ocean)return 0;
 const {p,mesh,dx,dy}=best;return sample(mesh.userData.a,p.cells+3,p.cells+3,1+dx/p.span*p.cells,1+dy/p.span*p.cells)*.0015;
}
function weatherContext(){
 const c=centre(),distance=camera.position.distanceTo(controls.target),points=cameraFootprint(),xs=points.map(p=>p[0]),zs=points.map(p=>p[1]),scale=111.2*cos();
 const west=Math.floor((c.lon+Math.max(-2400,Math.min(...xs))/scale)*4)/4,north=Math.min(90,Math.ceil((c.lat-Math.max(-2400,Math.min(...zs))/111.2)*4)/4);
 const east=Math.min(west+359,Math.ceil((c.lon+Math.min(2400,Math.max(...xs))/scale)*4)/4),south=Math.max(-90,Math.floor((c.lat-Math.min(2400,Math.max(...zs))/111.2)*4)/4);
 return {preloadStatus,camera,projectPlace:(lat,lon)=>({x:wrap(lon-anchor.lon)*scale,z:(anchor.lat-lat)*111.2}),centre:c,distance,target:controls.target,ground:groundHeight,terrainMeshes:()=>[...[...tiles.values()].map(t=>t.mesh),...(globalRelief.mesh?[globalRelief.mesh]:[]),...(backdrop?[backdrop]:[])],region:{west,north,lonSpan:Math.max(.25,east-west),latSpan:Math.max(.25,north-south)},bounds:r=>{
  const w=wrap(r.west-anchor.lon)*scale;return {west:w,east:w+r.lonSpan*scale,north:(anchor.lat-r.north)*111.2,south:(anchor.lat-r.north+r.latSpan)*111.2};
 }};
}
weatherView=new WeatherView(scene,weatherContext);
placeLabels=new PlaceLabels(camera,weatherContext);
const params=new URLSearchParams(location.search);if(params.has('lat')&&params.has('lon')&&Number.isFinite(Number(params.get('lat')))&&Math.abs(Number(params.get('lat')))<=89.85&&Number.isFinite(Number(params.get('lon'))))anchor={lat:Number(params.get('lat')),lon:wrap(Number(params.get('lon')))};
fetch('/dem/tileList.txt').then(r=>{if(!r.ok)throw Error('Terrain catalogue unavailable');return r.text();}).then(text=>{catalogue=new Set(text.split(/\s+/).map(s=>s.replace(/\/$/,'')));reader=new RasterReader(GeoTIFF,'',catalogue);styleNote();go();}).catch(e=>$('status').textContent=e.message);
