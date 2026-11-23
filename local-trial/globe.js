import {PlaceTemperatures} from './place-temperatures.mjs';
import {WeatherData} from './weather-engine.mjs';
import {frameAtTime} from './forecast-position.mjs';
import {globeJourney} from './camera-travel.mjs';
import {GlobeSurfaceCover} from './globe-surface-cover.mjs?v=20261123f';
import {GlobeClouds} from './globe-clouds.mjs?v=20261123c';
import {GlobePlaces} from './globe-places.mjs?v=20261120n';
import {setupSearch} from './location-search.mjs?v=20261120j';
import {GlobalRelief} from './global-relief.mjs?v=20261123c';
import * as THREE from 'three';
import {OrbitControls} from '/terrain-assets/OrbitControls.js';
const $=id=>document.getElementById(id),host=$('globe');
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(38,1,.1,30);
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.setClearColor('#07131f');host.append(renderer.domElement);
const globe=new THREE.Group();scene.add(globe);
const material=new THREE.MeshBasicMaterial({color:'#182630'});
let sphere=new THREE.Mesh(new THREE.SphereGeometry(1,96,64),material);globe.add(sphere);
scene.add(new THREE.AmbientLight('#c2deeb',2));const sun=new THREE.DirectionalLight('#edfaff',2.5);sun.position.set(-3,4,5);scene.add(sun);
const vector=(lat,lon,r=1)=>new THREE.Vector3(r*Math.cos(lat*Math.PI/180)*Math.cos(lon*Math.PI/180),r*Math.sin(lat*Math.PI/180),-r*Math.cos(lat*Math.PI/180)*Math.sin(lon*Math.PI/180));
camera.position.copy(vector(-35,174,3.7));
const controls=new OrbitControls(camera,renderer.domElement);controls.enablePan=false;controls.enableDamping=true;controls.minDistance=1.3;controls.maxDistance=7;
let lastInput=performance.now(),flight=null,active=true,down=null,interacting=false,spinning=true,returnPosition=null;
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
function spin(on){spinning=on;$('spinToggle').textContent=on?'Pause rotation':'Resume rotation';}
$('spinToggle').onclick=()=>spin(!spinning);
controls.addEventListener('start',()=>{lastInput=performance.now();if(flight)return;spin(false);interacting=true;});controls.addEventListener('end',()=>{lastInput=performance.now();interacting=false;});
// Share Local's bundled elevation, palette, sea colour and hill shading.
const relief=new GlobalRelief();
const surfaceCover=new GlobeSurfaceCover(relief);
relief.load(globe,true).then(()=>{
 globe.remove(sphere);sphere.geometry.dispose();sphere.material.dispose();sphere=relief.mesh;
}).catch(()=>{$('status').textContent='Terrain preview unavailable; region selection still works.';});
const clouds=new GlobeClouds(globe,$('globeClock'));
const requestedTime=new URLSearchParams(location.search).get('time');if(requestedTime)clouds.hold(requestedTime);
const labels=new GlobePlaces(host,globe,camera,vector,choose);
const labelWeather={data:new WeatherData(),displayFrame:0},temperatures=new PlaceTemperatures(labelWeather,labels);
labelWeather.data.init().catch(()=>{});
try{$('placeTemperatures').checked=localStorage.getItem('local-placeTemperatures')!=='false';}catch{}
$('placeTemperatures').onchange=()=>{try{localStorage.setItem('local-placeTemperatures',String($('placeTemperatures').checked));}catch{}};
let localViewTime=null;
// A subtle atmospheric rim, matching the highlights globe's blue halo.
const halo=new THREE.Mesh(new THREE.SphereGeometry(1.035,96,64),new THREE.ShaderMaterial({side:THREE.BackSide,transparent:true,depthWrite:false,vertexShader:'varying vec3 n,v;void main(){vec4 p=modelViewMatrix*vec4(position,1.);n=normalize(normalMatrix*normal);v=normalize(-p.xyz);gl_Position=projectionMatrix*p;}',fragmentShader:'varying vec3 n,v;void main(){float a=pow(1.-abs(dot(normalize(n),normalize(v))),3.);gl_FragColor=vec4(.3,.55,.7,a*.35);}'}));globe.add(halo);
function choose(lat,lon,name='Selected location',journey=null){
 if(flight||(!active&&!journey))return;
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>89.85){$('status').textContent='Enter a valid latitude and longitude.';return;}
 if(journey){active=true;$('local').hidden=false;$('local').classList.remove('departing');camera.position.copy(vector(journey.from.lat,journey.from.lon,1.2).applyQuaternion(globe.quaternion));resize();}
 returnPosition=camera.position.clone();spin(false);controls.enabled=false;$('status').textContent='Flying to '+name+' · detail will refine in the background.';
 const selectedTime=journey?.time||clouds.time();clouds.hold(selectedTime);
 const point=vector(lat,lon,1.2).applyQuaternion(globe.quaternion);
 flight={start:performance.now(),from:camera.position.clone(),to:point,lat,lon,name,journey:!!journey,ready:false,revealing:false};
 const f=flight,url='http://127.0.0.1:8092/global-test.html?'+new URLSearchParams({lat,lon,name,approach:'1',searchFlight:journey?'1':'0',time:selectedTime});
 const load=()=>{if(flight===f)$('viewer').src=url;};if(journey&&!reduced.matches)setTimeout(load,1200);else load();
 $('viewer').hidden=false;$('viewer').inert=true;$('viewer').classList.add('preparing');$('back').hidden=false;
}
addEventListener('message',event=>{
 if(event.origin!=='http://127.0.0.1:8092'||event.source!==$('viewer').contentWindow )return;
 if(event.data?.type==='local-view-time'){localViewTime=event.data.time;return;}
 if(event.data?.type==='local-search-flight'){const m=event.data;if(m.from&&m.to&&Number.isFinite(m.from.lat)&&Number.isFinite(m.from.lon))choose(m.to.lat,m.to.lon,m.to.name,m);return;}
 if(event.data?.type==='local-terrain-ready'&&flight)flight.ready=true;
});
function revealTerrain(f){
 if(f.revealing)return;f.revealing=true;
 $('viewer').contentWindow.postMessage({type:'local-terrain-approach'},'http://127.0.0.1:8092');
 $('viewer').inert=false;$('viewer').classList.remove('preparing');$('viewer').classList.add('revealing');$('local').classList.add('departing');
 setTimeout(()=>{if(flight!==f)return;$('local').hidden=true;$('local').classList.remove('departing');$('viewer').classList.remove('revealing');active=false;flight=null;},reduced.matches?0:1800);
}
setupSearch($('search'),$('matches'),(lat,lon,name)=>{clouds.hold(new Date().toISOString());choose(lat,lon,name);});
let tap=false;
renderer.domElement.addEventListener('pointerdown',e=>{down=[e.clientX,e.clientY];tap=e.button===0;});
renderer.domElement.addEventListener('pointermove',e=>{if(down&&Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)tap=false;});
renderer.domElement.addEventListener('pointercancel',()=>{down=null;tap=false;});
renderer.domElement.addEventListener('pointerup',()=>{down=null;});
renderer.domElement.addEventListener('dblclick',e=>{
 if(!tap||e.button!==0||flight||!active)return;e.preventDefault();
 // Pick the visible surface and undo the globe's current rotation.
 camera.updateMatrixWorld();globe.updateMatrixWorld(true);
 const b=renderer.domElement.getBoundingClientRect(),pointer=new THREE.Vector2((e.clientX-b.left)/b.width*2-1,-(e.clientY-b.top)/b.height*2+1),ray=new THREE.Raycaster();ray.setFromCamera(pointer,camera);
 const hit=ray.intersectObject(sphere)[0];if(!hit)return;const p=globe.worldToLocal(hit.point.clone()).normalize();choose(Math.asin(p.y)*180/Math.PI,Math.atan2(-p.z,p.x)*180/Math.PI);
});
function showTab(tab){
 flight=null;controls.enabled=true;if(returnPosition){camera.position.copy(returnPosition);controls.update();returnPosition=null;}$('viewer').inert=false;$('viewer').classList.remove('preparing','revealing');$('local').classList.remove('departing');
 document.querySelectorAll('[data-tab]').forEach(b=>{if(b.dataset.tab===tab)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
 active=tab==='local';$('local').hidden=!active;$('viewer').hidden=active;$('back').hidden=true;
 if(active){if(localViewTime)clouds.hold(localViewTime);try{$('placeTemperatures').checked=localStorage.getItem('local-placeTemperatures')!=='false';}catch{}$('viewer').removeAttribute('src');$('status').textContent='Drag to turn the globe. Scroll to approach. Click a named place or double-click anywhere on the globe.';resize();}
 else $('viewer').src='/explorer/#'+tab;
}
$('back').onclick=()=>showTab('local');document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
function resize(){const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;renderer.setSize(w,h);camera.aspect=w/h;camera.clearViewOffset();if(w>700)camera.setViewOffset(w,h,180,0,w,h);else camera.setViewOffset(w,h,0,220,w,h);camera.updateProjectionMatrix();}
addEventListener('resize',resize);resize();let last=performance.now();
function animate(now){requestAnimationFrame(animate);const dt=Math.min(.1,(now-last)/1000);last=now;if(!active)return;
 if(flight){const t=reduced.matches?1:Math.min(1,(now-flight.start)/(flight.journey?6800:2600)),e=t*t*(3-2*t),journey=flight.journey?globeJourney(t):null;const rotation=new THREE.Quaternion().setFromUnitVectors(flight.from.clone().normalize(),flight.to.clone().normalize()),direction=flight.from.clone().normalize().applyQuaternion(new THREE.Quaternion().slerp(rotation,journey?journey.turn:e));camera.position.copy(direction.multiplyScalar(journey?journey.radius:THREE.MathUtils.lerp(flight.from.length(),flight.to.length(),e)));camera.clearViewOffset();camera.updateProjectionMatrix();camera.lookAt(0,0,0);if(t===1&&flight.ready)revealTerrain(flight);}
 else {controls.update();if(spinning&&!interacting&&!reduced.matches)globe.rotation.y+=dt*.035;}
 clouds.tick(dt,reduced.matches);surfaceCover.tick(clouds.time());labels.layer.hidden=!!flight;if(!flight){labels.tick(dt);if(labelWeather.data.meta){const times=labelWeather.data.meta.times,time=Date.parse(clouds.time());labelWeather.temperatureTimeAvailable=time>=Date.parse(times[0])&&time<=Date.parse(times.at(-1));labelWeather.displayFrame=frameAtTime(times,time);temperatures.tick(dt);}}renderer.render(scene,camera);
}requestAnimationFrame(animate);

const travel=new URLSearchParams(location.search).get('travel');
if(travel){try{const journey=JSON.parse(travel);if(journey.from&&journey.to)choose(journey.to.lat,journey.to.lon,journey.to.name,journey);}catch{}history.replaceState(null,'',location.pathname);}
