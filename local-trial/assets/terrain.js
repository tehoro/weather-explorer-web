var captureVideoFrame,videoCaptureActive=false;
var regional=null;
let rainColourOpacity=.50;
import * as THREE from 'three';
import {OrbitControls} from './OrbitControls.js';
const $=id=>document.getElementById(id), scene=new THREE.Scene();
scene.background=new THREE.Color('#07131f');

// A page zoom changes the CSS viewport. The desktop window width stays in screen
// coordinates. Embedded WebKit can report zero outer width and expose zoom via DPR.
const initialPixelRatio=devicePixelRatio || 1;
// Keep touch-device symbols at their reviewed sizes, including iPads using a trackpad.
const desktopSymbolScale=navigator.maxTouchPoints===0 && matchMedia('(pointer:fine)').matches ? 2 : 1;
function scenePixelScale(){
 if(window.outerWidth>0)return innerWidth/window.outerWidth;
 return initialPixelRatio/(devicePixelRatio || 1);
}
const initialSceneScale=scenePixelScale();let scenePixels=initialSceneScale;
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio,matchMedia('(max-width:700px), (pointer:coarse)').matches?1.25:2));renderer.setSize(innerWidth,innerHeight);$('scene').append(renderer.domElement);
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.3;
const camera=new THREE.PerspectiveCamera(42,innerWidth/innerHeight,.02,10000),controls=new OrbitControls(camera,renderer.domElement);
controls.enableDamping=true;controls.dampingFactor=.08;controls.maxPolarAngle=Math.PI*.49;controls.minDistance=.25;controls.screenSpacePanning=true;
scene.add(new THREE.HemisphereLight(0xc2eaff,0x293a22,2.2));const sun=new THREE.DirectionalLight(0xffefd8,2.6);sun.position.set(-200,400,-150);scene.add(sun);
let selectionDot,geo,mesh,T,W,windFrom=null,windStart=0,pub,particles,trailGeo,trail,sectionLine,sectionEnds,selected,loading=false,playing=false,draw=false,dragStart,down,frameToken=0,regionToken=0;
// The surface overlay and precipitation particles share the same weather-grid values.
// Keep W.precip intact for point forecasts and the raw model readout.
var paintedPrecip, rainFilterSource, rainFilterWeather, rainFilterMiddle;
function filterLightRain(data,weather){paintedPrecip=weather.precip;rainFilterWeather=weather;}
function displayPrecip(){return rainFilterWeather===W && paintedPrecip ? paintedPrecip : W.precip;}

function hiddenLiquidAt(x,z,shown){
 return shown<sample(W.precip,x,z) && shown<=(W.snow_water?sample(W.snow_water,x,z):0)+1e-6;
}

var prepareRain,updatePrecipitation;
const hourlyWorkers=new Map(),hourlyJobs=new Map(),surfacePending=new Map();let workId=0;
function background(kind,job){
 let worker=hourlyWorkers.get(kind);
 if(!worker){worker=new Worker(new URL('./hour-worker.js?v=ae3f5aa7df65',import.meta.url));hourlyWorkers.set(kind,worker);
 worker.onmessage=({data:m})=>{const p=hourlyJobs.get(m.id);if(!p)return;hourlyJobs.delete(m.id);if(m.error)p.reject(Error(m.error));else p.resolve(m.value);};
 worker.onerror=e=>{for(const [id,p] of hourlyJobs)if(p.worker===worker){hourlyJobs.delete(id);p.reject(Error(e.message));}worker.terminate();hourlyWorkers.delete(kind);};}
 return new Promise((resolve,reject)=>{const id=++workId;hourlyJobs.set(id,{resolve,reject,worker});worker.postMessage({...job,id});});
}
function getSurface(r,h){
 const key=r+':'+h;if(cache.has(key))return Promise.resolve(cache.get(key));
 if(surfacePending.has(key))return surfacePending.get(key);
 const url=`/data/${pub.data_version||"v2"}/${pub.cycle}/${r}/hour-${String(h).padStart(3,"0")}.json`;
 const p=background('weather',{url}).then(w=>{cache.set(key,w);if(cache.size>4)cache.delete(cache.keys().next().value);return w;}).finally(()=>surfacePending.delete(key));surfacePending.set(key,p);return p;
}
const cache=new Map(),N=matchMedia('(max-width:700px), (pointer:coarse)').matches?4800:9200,L=14,clock=new THREE.Clock(),ray=new THREE.Raycaster(),pointer=new THREE.Vector2();
const dateFormatter=new Intl.DateTimeFormat('en-NZ',{timeZone:'Pacific/Auckland',weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
const zoneFormatter=new Intl.DateTimeFormat('en-NZ',{timeZone:'Pacific/Auckland',timeZoneName:'longOffset'});
function nzZone(date){const offset=zoneFormatter.formatToParts(date).find(p=>p.type==='timeZoneName').value;return offset==='GMT+13:00'?'NZDT':'NZST';}
const fmt={format:date=>dateFormatter.format(date)+' '+nzZone(date)};
const rainStops=[[.1,'#264e6c'],[1,'#237fea'],[2,'#44d5f3'],[5,'#57b8f4'],[10,'#9bd6ff'],[20,'#d3eeff']].map(([x,c])=>[x,new THREE.Color(c)]);
const terrainStops=[[0,'#234e45'],[200,'#477353'],[700,'#7a8960'],[1400,'#9b9b80'],[2200,'#b3b3aa'],[3000,'#e7eff0']].map(([x,c])=>[x,new THREE.Color(c)]);
function ramp(value,stops){for(let i=1;i<stops.length;i++)if(value<stops[i][0])return stops[i-1][1].clone().lerp(stops[i][1],THREE.MathUtils.clamp((value-stops[i-1][0])/(stops[i][0]-stops[i-1][0]),0,1));return stops.at(-1)[1].clone()}
async function json(url){const r=await fetch(url);if(!r.ok){const e=await r.json();throw Error(e.error||r.statusText)}return r.json()}
function showError(msg){$('info').textContent=msg}
function pointXY(x,z){return [(x/T.width_km+.5)*(T.nx-1),(z/T.depth_km+.5)*(T.ny-1)]}
function sample(a,x,z){const [fx,fy]=pointXY(x,z);if(fx<0||fy<0||fx>T.nx-1||fy>T.ny-1)return NaN;const ix=Math.min(T.nx-2,Math.floor(fx)),iy=Math.min(T.ny-2,Math.floor(fy)),dx=fx-ix,dy=fy-iy,k=iy*T.nx+ix;if(!T.valid[k]||!T.valid[k+1]||!T.valid[k+T.nx]||!T.valid[k+T.nx+1])return NaN;return (a[k]*(1-dx)+a[k+1]*dx)*(1-dy)+(a[k+T.nx]*(1-dx)+a[k+T.nx+1]*dx)*dy}
function height(x,z){return sample(T.height,x,z)/1000*Number($('exaggeration').value)}
function coords(x,z){const [w,e,s,n]=T.bounds;return [n-(z/T.depth_km+.5)*(n-s),w+(x/T.width_km+.5)*(e-w)]}
function xy(lat,lon){const [w,e,s,n]=T.bounds;return [(lon-w)/(e-w)*T.width_km-T.width_km/2,(n-lat)/(n-s)*T.depth_km-T.depth_km/2]}
function dispose(o){if(!o)return;scene.remove(o);o.geometry?.dispose();o.material?.map?.dispose();o.material?.dispose()}
function makeTerrain(){dispose(mesh);geo=new THREE.BufferGeometry();const pos=new Float32Array(T.nx*T.ny*3),col=new Float32Array(pos.length),indices=[];
 for(let y=0;y<T.ny;y++)for(let x=0;x<T.nx;x++){let k=y*T.nx+x;pos[k*3]=(x/(T.nx-1)-.5)*T.width_km;pos[k*3+2]=(y/(T.ny-1)-.5)*T.depth_km;if(x<T.nx-1&&y<T.ny-1&&T.valid[k]&&T.valid[k+1]&&T.valid[k+T.nx]&&T.valid[k+T.nx+1])indices.push(k,k+T.nx,k+1,k+1,k+T.nx,k+T.nx+1)}
 geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('color',new THREE.BufferAttribute(col,3));geo.setIndex(indices);mesh=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.92,metalness:.04,side:THREE.DoubleSide}));scene.add(mesh);updateHeight();colour();resetCamera();makeParticles();}
function updateHeight(){if(!T||!geo)return;const p=geo.attributes.position.array;for(let i=0;i<T.height.length;i++)p[i*3+1]=Math.max(0,T.height[i])/1000*Number($('exaggeration').value);geo.attributes.position.needsUpdate=true;geo.computeVertexNormals();geo.computeBoundingSphere();updateSelectionDot();}
const snowStops=[[.1,'#442365'],[1,'#6d39ad'],[2,'#9257d1'],[5,'#ae80e4'],[10,'#ceb0f0'],[20,'#eadbff']].map(([x,c])=>[x,new THREE.Color(c)]);
function isSnow(h,level){return level!==null&&Number.isFinite(level)&&h>=Math.round(level);}
var baseSurfaceKey,baseSurface,baseLandKey;
function colour(){
 if(!T||!geo)return;
 const dest=geo.attributes.color.array;
 if(baseSurfaceKey!==T.height||baseLandKey!==T.land){
  baseSurfaceKey=T.height;baseLandKey=T.land;baseSurface=new Float32Array(dest.length);const sea=new THREE.Color('#102f42');
  for(let i=0;i<T.height.length;i++)((T.land[i]<.5||T.lake?.[i])?sea:ramp(T.height[i],terrainStops)).toArray(baseSurface,i*3);
 }
 dest.set(baseSurface);
 if(W&&(!geo.attributes.weatherValue||surfaceField==='rain')){
  const c=new THREE.Color();for(let i=0;i<W.precip.length;i++){const v=displayPrecip()[i];if(!(v>=.1))continue;
   const share=Number.isFinite(W.snow_water?.[i])?Math.max(0,Math.min(1,W.snow_water[i]/v)):(isSnow(T.height[i],W.snow_level[i])?1:0);
   const rain=ramp(v,rainStops);if(share>0)rain.lerp(ramp(v,snowStops),share);c.fromArray(baseSurface,i*3).lerp(rain,rainColourOpacity).toArray(dest,i*3);
  }
 }
 geo.attributes.color.needsUpdate=true;
}
// Fixed physical wind-speed bands, independent of particle animation speed.
const windColours=['#fff3b0','#ffd12f','#ff851b','#ff334f','#e64dff'].map(c=>new THREE.Color(c));
function windBand(kmh){return kmh>=120?4:kmh>=90?3:kmh>=60?2:kmh>=30?1:0}
// Fit the projected terrain, rather than scaling distance by the longer side.
var overviewCamera=true,overviewTopDown=false;
function resetCamera(topDown=false){
 if(!T||!geo)return;
 overviewCamera=true;overviewTopDown=topDown;
 const w=innerWidth,h=innerHeight,compact=matchMedia('(max-width: 700px), (max-height: 520px) and (pointer: coarse)').matches,pad=compact?5:18;
 const timeline=(document.body.classList.contains('clearView')?$('clearToolbar'):$('timeline')).getBoundingClientRect();
 // Panels float over the landscape; do not shift or shrink the overview for them.
 const left=pad,right=w-pad;
 const top=compact && h>w ? 62 : pad,bottom=Math.max(top+120,timeline.top-pad),cw=Math.max(120,right-left),ch=bottom-top;
 const d=Math.max(T.width_km,T.depth_km);
 const damping=controls.enableDamping;controls.enableDamping=false;controls.update();
 controls.target.set(0,0,0);camera.clearViewOffset();
 // OrbitControls requires a tiny polar epsilon; negative Z is geographic north.
 const direction=(topDown?new THREE.Vector3(0,1,1e-6):compact && h>w ? new THREE.Vector3(-.62,2.8,1) : new THREE.Vector3(0,.82,1.02)).normalize();
 camera.far=d*12;controls.maxDistance=d*4;
 // Include actual terrain vertices so empty corners do not inflate the fit.
 const positions=geo.attributes.position;
 const hasLand=compact && T.land.some((v,i)=>v>=.5 && T.valid[i]);
 function bounds(distance){
  camera.position.copy(direction).multiplyScalar(distance);camera.lookAt(controls.target);camera.updateMatrixWorld();camera.updateProjectionMatrix();
  let xmin=Infinity,xmax=-Infinity,ymin=Infinity,ymax=-Infinity;
  const p=new THREE.Vector3();
  for(let i=0;i<positions.count;i++){
   if(!T.valid[i]||(compact && hasLand && T.land[i]<.5))continue;
   p.fromBufferAttribute(positions,i).project(camera);
   xmin=Math.min(xmin,p.x);xmax=Math.max(xmax,p.x);ymin=Math.min(ymin,p.y);ymax=Math.max(ymax,p.y);
  }
  return {xmin,xmax,ymin,ymax};
 }
 let low=d*.3,high=d*8,b;
 for(let i=0;i<22;i++){const mid=(low+high)/2;b=bounds(mid);if((b.xmax-b.xmin)*w/2>cw||(b.ymax-b.ymin)*h/2>ch)low=mid;else high=mid;}
 b=bounds(high*(compact?1.005:1.025));
 const actualX=w/2+(b.xmin+b.xmax)*w/4,actualY=h/2-(b.ymin+b.ymax)*h/4;
 camera.setViewOffset(w,h,actualX-(left+right)/2,actualY-(top+bottom)/2,w,h);
 controls.update();controls.enableDamping=damping;
}
controls.addEventListener('start',()=>{overviewCamera=false;});

// A fixed 20 m near plane loses depth precision from a country-scale overview.
// Keep sea-level ribbons distinct from the sea, while allowing close terrain views.
function updateCameraDepth(){
 const distance=camera.position.distanceTo(controls.target);
 const ground=markerTerrainHeight(camera.position.x,camera.position.z);
 const clearance=Number.isFinite(ground)?Math.abs(camera.position.y-ground):Infinity;
 // From directly overhead, a nearly level ocean puts entire rows at the
 // same quantised depth. Give the ribbons two depth-buffer units of bias.
 const overhead=controls.getPolarAngle()<.001;
 if(trail){
  trail.material.polygonOffset=overhead;
  trail.material.polygonOffsetUnits=-2;
 }
 const near=Math.max(.02,Math.min(distance/(overhead?4:100),clearance/4));
 if(Math.abs(camera.near-near)>near*.01){camera.near=near;camera.updateProjectionMatrix();}
}
// Estimate the ground span at the point the camera is looking at, in km.
let windViewRatio = 1;
let windSeedWindow = null;
let windRecycleCursor = 0;
function updateWindView(dt) {
  const distance = camera.position.distanceTo(controls.target);
  const span = 2 * distance * Math.tan(camera.fov * Math.PI / 360);
  const ratio = Math.max(.015, Math.min(1, span / Math.max(T.width_km, T.depth_km)));
  windViewRatio += (ratio - windViewRatio) * Math.min(1, dt * 4);
  if (ratio >= .9) {
    windSeedWindow = null;
    return;
  }
  // Include a margin around the target for tilted and rotating views.
  const radius = span * Math.max(1, camera.aspect) * .85;
  windSeedWindow = {
    left: Math.max(-T.width_km / 2, controls.target.x - radius),
    right: Math.min(T.width_km / 2, controls.target.x + radius),
    top: Math.max(-T.depth_km / 2, controls.target.z - radius),
    bottom: Math.min(T.depth_km / 2, controls.target.z + radius)
  };
  const box = windSeedWindow;
  if (box.left >= box.right || box.top >= box.bottom) {
    windSeedWindow = null;
    return;
  }
  // Move a few distant trails at a time. Leave every fourth trail on the wider map.
  for (let i = 0; i < Math.ceil(N * dt * .5); i++) {
    windRecycleCursor = (windRecycleCursor + 1) % N;
    const p = particles[windRecycleCursor];
    if (windRecycleCursor % 4 && (p.x < box.left || p.x > box.right || p.z < box.top || p.z > box.bottom)) respawn(p);
  }
}

function trailHeight(x,z){return height(x,z)+Math.max(.12,T.width_km*.0008)}
function respawn(p){for(let n=0;n<30;n++){p.x=(Math.random()-.5)*T.width_km;p.z=(Math.random()-.5)*T.depth_km;
  if(windSeedWindow && n<8 && p.focusTrail){
   p.x=THREE.MathUtils.lerp(windSeedWindow.left,windSeedWindow.right,Math.random());
   p.z=THREE.MathUtils.lerp(windSeedWindow.top,windSeedWindow.bottom,Math.random());
  }
  if(Number.isFinite(height(p.x,p.z)))break}p.age=Math.random()*20;p.history=Array.from({length:L},()=>[p.x,trailHeight(p.x,p.z),p.z])}
// Screen-space ribbons: native WebGL lines are usually fixed at one pixel.
function windWidth(kmh){return 1+3*Math.min(120,Math.max(0,kmh))/120}
function makeParticles(){
 dispose(trail);windSeedWindow=null;windViewRatio=1;particles=Array.from({length:N},(_,i)=>{let p={focusTrail:i%4!==0,visibility:i<N*.25*Number($('density').value)?1:0};respawn(p);return p});
 trailGeo=new THREE.InstancedBufferGeometry();
 trailGeo.setAttribute('position',new THREE.Float32BufferAttribute([0,-1,0,1,-1,0,0,1,0,1,1,0],3));trailGeo.setIndex([0,1,2,2,1,3]);
 const count=N*(L-1),positions=new THREE.InstancedInterleavedBuffer(new Float32Array(count*6),6),colors=new THREE.InstancedInterleavedBuffer(new Float32Array(count*6),6);
 positions.setUsage(THREE.DynamicDrawUsage);colors.setUsage(THREE.DynamicDrawUsage);
 trailGeo.setAttribute('start',new THREE.InterleavedBufferAttribute(positions,3,0));trailGeo.setAttribute('end',new THREE.InterleavedBufferAttribute(positions,3,3));
 trailGeo.setAttribute('trailColour',new THREE.InterleavedBufferAttribute(colors,3,0));
 trailGeo.setAttribute('width',new THREE.InstancedBufferAttribute(new Float32Array(count),1).setUsage(THREE.DynamicDrawUsage));
 trailGeo.setAttribute('visibility',new THREE.InstancedBufferAttribute(new Float32Array(count),1).setUsage(THREE.DynamicDrawUsage));
 trailGeo.userData={positions,colors};trailGeo.instanceCount=count;
 const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,toneMapped:false,
 uniforms:{pixelSize:{value:1},viewport:{value:new THREE.Vector2(innerWidth,innerHeight)}},
 vertexShader:`attribute vec3 start;attribute vec3 end;attribute vec3 trailColour;attribute float width;attribute float visibility;
 uniform float pixelSize;uniform vec2 viewport;varying float halfWidth;varying vec3 tint;varying float edge;varying float opacity;
 void main(){vec4 a=projectionMatrix*modelViewMatrix*vec4(start,1.0);vec4 b=projectionMatrix*modelViewMatrix*vec4(end,1.0);
 tint=trailColour;
 halfWidth=width*.5;
 float radius=halfWidth+.5*pixelSize;
 edge=position.y*radius;opacity=visibility;
 if(a.w<=0.0||b.w<=0.0){gl_Position=vec4(2.0,2.0,2.0,1.0);return;}
 vec2 d=(b.xy/b.w-a.xy/a.w)*viewport;float len=length(d);
 vec2 normal=len>0.0001?vec2(-d.y,d.x)/len:vec2(0.0);
 vec4 p=mix(a,b,position.x);p.xy+=2.0*normal*edge/viewport*p.w;gl_Position=p;}`,
 fragmentShader:`uniform float pixelSize;varying float halfWidth;varying vec3 tint;varying float edge;varying float opacity;void main(){gl_FragColor=vec4(tint,opacity*.95*(clamp((halfWidth-abs(edge))/pixelSize+.5,0.0,1.0)));
 #include <colorspace_fragment>
 }`});
 trail=new THREE.Mesh(trailGeo,material);trail.frustumCulled=false;scene.add(trail);
}
// Blend east/north components, not compass angles, so north-wrap stays continuous.
// Retarget from the currently displayed field if the user scrubs before blending ends.
const WIND_BLEND_MS=1000;
function windBlend(now=performance.now()){
 const t=Math.min(1,Math.max(0,(now-windStart)/WIND_BLEND_MS));return t*t*(3-2*t);
}
function acceptWeather(next){
 if(W){
  const t=windBlend();
  windFrom=windFrom&&t<1?{
   u:Float32Array.from(W.u,(v,i)=>windFrom.u[i]+(v-windFrom.u[i])*t),
   v:Float32Array.from(W.v,(v,i)=>windFrom.v[i]+(v-windFrom.v[i])*t)
  }:{u:W.u,v:W.v};
  windStart=performance.now();
 }
 W=next;
}
// The head moves every render. Older points represent equal intervals in time.
let windSamplePhase=0;
function advanceWindHistory(p,elapsed,firstSample){
 const head=p.history[0],x0=head[0],z0=head[2];
 for(let t=firstSample;t<=elapsed;t+=1/60){
  const f=t/elapsed,x=x0+(p.x-x0)*f,z=z0+(p.z-z0)*f;
  const point=p.history.pop();point[0]=x;point[1]=trailHeight(x,z);point[2]=z;
  p.history.splice(1,0,point);
 }
 head[0]=p.x;head[1]=trailHeight(p.x,p.z);head[2]=p.z;
}
function windStep(dt){if(!trail||!W)return;const firstSample=1/60-windSamplePhase;windSamplePhase=(windSamplePhase+dt)%(1/60);trail.visible=$('uiWind')?.checked??true;if(!trail.visible)return;const arr=trailGeo.userData.positions.array,colors=trailGeo.userData.colors.array,widths=trailGeo.attributes.width.array;trail.material.uniforms.viewport.value.set(innerWidth/scenePixels,innerHeight/scenePixels);trail.material.uniforms.pixelSize.value=1/(renderer.getPixelRatio()*scenePixels);updateWindView(dt);const scale=Number($('speed').value)*T.width_km*.01*windViewRatio,blend=windBlend();if(blend>=1)windFrom=null;
 for(let i=0;i<N;i++){const p=particles[i],goal=i<N*.25*Number($('density').value)?1:0;p.visibility+=(goal-p.visibility)*Math.min(1,dt*5);if(!goal&&p.visibility<.001)p.visibility=0;trailGeo.attributes.visibility.array.fill(p.visibility,i*(L-1),(i+1)*(L-1));if(p.visibility===0)continue;let u=sample(W.u,p.x,p.z),v=sample(W.v,p.x,p.z);if(windFrom){const a=sample(windFrom.u,p.x,p.z),b=sample(windFrom.v,p.x,p.z);u=a+(u-a)*blend;v=b+(v-b)*blend;}const kmh=Math.hypot(u,v)*3.6,c=windDisplayColour(kmh),width=windWidth(kmh);for(let j=0;j<L-1;j++){widths[i*(L-1)+j]=width*(.55+.45*(1-j/L));const fade=(1-j/L)*.8+.2;for(let q=0;q<2;q++){const k=(i*(L-1)+j)*6+q*3;colors[k]=c.r*fade;colors[k+1]=c.g*fade;colors[k+2]=c.b*fade;}}p.x+=u*dt*scale;p.z-=v*dt*scale;p.age+=dt;if(!Number.isFinite(height(p.x,p.z))||p.age>24||!Number.isFinite(u)){respawn(p)}advanceWindHistory(p,dt,firstSample);for(let j=0;j<L-1;j++){const k=(i*(L-1)+j)*6,a=p.history[j],b=p.history[j+1];arr[k]=a[0];arr[k+1]=a[1];arr[k+2]=a[2];arr[k+3]=b[0];arr[k+4]=b[1];arr[k+5]=b[2]}}trailGeo.userData.positions.needsUpdate=true;trailGeo.userData.colors.needsUpdate=true;trailGeo.attributes.width.needsUpdate=true;trailGeo.attributes.visibility.needsUpdate=true;}
async function loadRegion(){if(!pub)return;const token=++regionToken;++frameToken;loading=true;sectionEnds=null;dispose(sectionLine);W=null;windFrom=null;try{const t=await json('/data/'+(pub.data_version||'v2')+'/'+pub.cycle+'/'+$('region').value+'/terrain.json?detail=2');if(token!==regionToken)return;T=t;selectTerrain();makeTerrain();loading=false;await loadHour()}catch(e){loading=false;showError(e.message)}}
async function loadHour(){if(!pub||!T)return;const h=Number($('hours').value),r=$('region').value,key=r+':'+h,token=++frameToken;loading=true;updateHourButtons();try{const [w,cloud]=await Promise.all([getSurface(r,h),prepareRain?.(pub.cycle,r,h)]);if(token!==frameToken)return;acceptWeather(w);colour();if(h<Number($('hours').max))getSurface(r,h+3).catch(()=>{});updateMapTime();$('time').textContent=fmt.format(new Date(Date.parse(pub.timing.initial_utc)+h*3600000));$('lead').textContent='+'+h+' h · '+nzZone(new Date(Date.parse(pub.timing.initial_utc)+h*3600000));if(selected)inspect(selected);}catch(e){showError(e.message);playing=false;updatePlay()}finally{if(token===frameToken){loading=false;updateHourButtons()}}}
function pick(e){pointer.set(e.clientX/innerWidth*2-1,-e.clientY/innerHeight*2+1);ray.setFromCamera(pointer,camera);return mesh?ray.intersectObjects(regional?.surfaces() || [mesh],false)[0]?.point:null}
function inspect(p){selected=p.clone();updateSelectionDot();const [lat,lon]=coords(p.x,p.z),u=sample(W.u,p.x,p.z),v=sample(W.v,p.x,p.z),speed=Math.hypot(u,v)*3.6,direction=(Math.atan2(-u,-v)*180/Math.PI+360)%360,dirs=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];$('info').innerHTML=`<div style="color:#a5c3d1">${fmt.format(new Date(Date.parse(pub.timing.initial_utc)+W.hour*3600000))}</div><strong>${Math.abs(lat).toFixed(3)}°S, ${lon.toFixed(3)}°E</strong> · terrain ${Math.round(sample(T.height,p.x,p.z))} m · model ${Math.round(sample(T.model_height||T.height,p.x,p.z))} m<br>Wind <strong>${dirs[Math.round(direction/22.5)%16]} ${Math.round(speed)} km/h</strong><br>Precipitation <strong>${sample(W.precip,p.x,p.z).toFixed(1)} mm/h</strong> · ${sample(W.temperature,p.x,p.z).toFixed(1)}°C<br><button id="openPoint">Point forecast</button>`;if(!$('pointPanel').hidden)refreshPoint();}
renderer.domElement.addEventListener('pointerdown',e=>{down=[e.clientX,e.clientY]});
renderer.domElement.addEventListener('pointerup',e=>{if(!isClearView()&&down&&Math.hypot(e.clientX-down[0],e.clientY-down[1])<5&&W){const p=pick(e);if(p)inspect(p)}});
renderer.domElement.addEventListener('dblclick',e=>{if(isClearView())return;const p=pick(e);if(p){const offset=camera.position.clone().sub(controls.target).multiplyScalar(.35);controls.target.copy(p);camera.position.copy(p).add(offset)}});
$('exaggeration').oninput=()=>{$('exLabel').textContent=$('exaggeration').value+'×';updateHeight();if(particles)for(const p of particles)respawn(p)};$('region').onchange=()=>{selected=null;closePoint();updateSelectionDot();$('info').textContent='Click the landscape to inspect the forecast.';loadRegion()};$('hours').onchange=()=>loadHour();
function updatePlay(){$('play').textContent=playing?'❚❚ Pause':'▶ Play';$('play').setAttribute('aria-label',playing?'Pause forecast':'Play forecast')}$('play').onclick=()=>{playing=!playing;updatePlay()};
let lastAdvance=0,forecastPlaybackRate=1;let lastOrbitQuality=false;const normalRatio=renderer.getPixelRatio();
function animate(){
 const movingForecast=videoCaptureActive||(!!cityFlight&&playing)||(playing&&$("pressureClouds").checked);
 if(movingForecast!==lastOrbitQuality){lastOrbitQuality=movingForecast;renderer.setPixelRatio(movingForecast?Math.min(normalRatio,1,Math.sqrt(950000/(innerWidth*innerHeight))):normalRatio);}
requestAnimationFrame(animate);const dt=Math.min(.07,clock.getDelta());if(!advanceCityFlight(performance.now()))controls.update();windStep(dt);updateCameraDepth();regional?.update();updatePrecipitation?.(dt);updateTownMarkers();updateClearControls();renderer.render(scene,camera);captureVideoFrame?.();const dir=camera.position.clone().sub(controls.target);$('compass').style.transform=`rotate(${Math.atan2(dir.x,dir.z)*180/Math.PI}deg)`;if(playing&&!loading&&performance.now()-lastAdvance>1600/forecastPlaybackRate){lastAdvance=performance.now();$('hours').value=Number($('hours').value)>=Number($('hours').max)?Number($('hours').min):Number($('hours').value)+3;loadHour()}}animate();
let lastSceneWidth=innerWidth, lastSceneHeight=innerHeight, lastSceneDpr=devicePixelRatio;
addEventListener('resize',()=>{
 const ratio=innerWidth/lastSceneWidth;
 const dprZoom=Math.abs(lastSceneDpr-devicePixelRatio)>.001 &&
  Math.abs(ratio*devicePixelRatio/lastSceneDpr-1)<.003;
 const scale=dprZoom?scenePixels*ratio:scenePixelScale();
 lastSceneDpr=devicePixelRatio;
 // Preserve framing when the same window is expressed in more or fewer CSS pixels.
 const zoomOnly=Math.abs(scale-scenePixels)>.002 &&
  Math.abs(innerHeight-lastSceneHeight*ratio)<3;
 scenePixels=scale;lastSceneWidth=innerWidth;lastSceneHeight=innerHeight;
 camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);if(overviewCamera&&!zoomOnly)resetCamera(overviewTopDown);else if(camera.view?.enabled){camera.setViewOffset(innerWidth,innerHeight,camera.view.offsetX*(zoomOnly?ratio:1),camera.view.offsetY*(zoomOnly?ratio:1),innerWidth,innerHeight)}});
const regionHeights={};
let previousRegion=$('region').value;
function changeRegionHeight(){
 const r=$('region').value;
 regionHeights[previousRegion]=Number($('exaggeration').value);
 $('exaggeration').value=regionHeights[r]??1;
 $('exLabel').textContent=$('exaggeration').value+'×';
 previousRegion=r;
}
$('region').addEventListener('change',changeRegionHeight,true);
const initialRegion=new URLSearchParams(location.search).get('region');
if([...$('region').options].some(o=>o.value===initialRegion)){
 $('region').value=initialRegion;changeRegionHeight();
}
try{const s=await json('/manifest.json');pub=s.published;updateFreshness();setInterval(updateFreshness,60000);if(!pub)throw Error('No completed forecast is available yet.');$('hours').min=pub.timing.start_hour;$('hours').step=3;$('hours').max=pub.timing.display_lead_hours;const issue=Math.max(1,Math.round((Date.parse(pub.timing.issue_local)-Date.parse(pub.timing.initial_utc))/3600000));$('hours').value=Math.max(pub.timing.start_hour,Math.min(Math.round(issue/3)*3,pub.timing.display_lead_hours));$('start').textContent=fmt.format(new Date(Date.parse(pub.timing.initial_utc)+pub.timing.start_hour*3600000));$('end').textContent=fmt.format(new Date(pub.timing.display_end_local));$('cycle').textContent='Run '+pub.cycle+' UTC';await loadRegion()}catch(e){showError(e.message)}

function updateFreshness(){if(!pub)return;const old=Date.now()-Date.parse(pub.timing.initial_utc)>24*3600000;$('freshness').textContent=old?'Saved trial forecast — prepare a newer run locally to refresh it.':'';}
function updateHourButtons(){$('nowHour').disabled=loading||!T||!pub;const h=Number($('hours').value);$('previousHour').disabled=loading||!T||h<=Number($('hours').min);$('nextHour').disabled=loading||!T||h>=Number($('hours').max);}
function stepHour(delta){if(loading||!T)return;playing=false;updatePlay();const slider=$('hours');slider.value=Math.max(Number(slider.min),Math.min(Number(slider.max),Number(slider.value)+delta*3));loadHour();}
$('previousHour').onclick=()=>stepHour(-1);$('nextHour').onclick=()=>stepHour(1);

$('resetView').onclick=()=>{const damping=controls.enableDamping;controls.enableDamping=false;controls.update();resetCamera();controls.enableDamping=damping;};
$('topDownView').onclick=()=>resetCamera(true);
function nearestForecastHour(now,initial,min,max){return Math.max(min,Math.min(max,Math.round((now-Date.parse(initial))/10800000)*3));}
$('nowHour').onclick=()=>{if(loading||!T||!pub)return;playing=false;updatePlay();const slider=$('hours');slider.value=nearestForecastHour(Date.now(),pub.timing.initial_utc,Number(slider.min),Number(slider.max));loadHour();};

function updateSelectionDot(){
 if(!selected||!T){if(selectionDot)selectionDot.visible=false;return;}
 if(!selectionDot){
  const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;const ctx=canvas.getContext('2d');
  ctx.beginPath();ctx.arc(32,32,25,0,Math.PI*2);ctx.fillStyle='#ffffff';ctx.fill();
  ctx.beginPath();ctx.arc(32,32,19,0,Math.PI*2);ctx.fillStyle='#ff202c';ctx.fill();
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0],3));
  const material=new THREE.PointsMaterial({size:12,sizeAttenuation:false,map:new THREE.CanvasTexture(canvas),transparent:true,depthTest:false,depthWrite:false,toneMapped:false});
  selectionDot=new THREE.Points(geometry,material);selectionDot.renderOrder=1;selectionDot.frustumCulled=false;scene.add(selectionDot);
 }
 const y=markerTerrainHeight(selected.x,selected.z);selectionDot.visible=Number.isFinite(y);selectionDot.position.set(selected.x,y,selected.z);
}

const NZ_TOWNS=[["Arthur’s Pass",-42.95,171.56667,745],["Yaldhurst",-43.51667,172.51667,38],["Wyndham",-46.33333,168.85,27],["Woodlands",-46.36667,168.55,41],["Woodend",-43.31667,172.66667,13],["Wingatui",-45.88333,170.38333,101],["Winchester",-44.2,171.28333,39],["Wigram",-43.55,172.55,21],["Whitianga",-36.83333,175.7,8],["Whitford",-36.93333,174.96667,5],["Whatawhata",-37.8,175.15,19],["Whataroa",-43.28333,170.41667,218],["Whangarei Heads",-35.81667,174.5,128],["Whangaparaoa",-36.63333,174.76667,38],["Whangamata",-37.2,175.86667,7],["Whakatu",-39.6,176.88333,7],["Whakarongo",-40.33333,175.66667,42],["Weston",-45.08333,170.91667,84],["West Melton",-43.51667,172.36667,96],["West Eyreton",-43.35,172.38333,119],["Wellsford",-36.28333,174.51667,56],["Wellington",-41.28664,174.77557,31],["Fox Glacier",-43.46485,170.01678,163],["Waverley",-39.76667,174.63333,85],["Washdyke",-44.35,171.23333,9],["Warrington",-45.71667,170.58333,137],["Warkworth",-36.4,174.66667,23],["Whanganui",-39.93333,175.05,18],["Wallaceville",-41.13333,175.05,57],["Wallacetown",-46.33333,168.28333,8],["Wakefield",-41.4,173.05,59],["Waiuku",-37.24806,174.73489,13],["Waitoa",-37.61667,175.63333,23],["Waitati",-45.75,170.56667,15],["Waitangi",-35.27025,174.08062,9],["Waitakere",-36.85126,174.54477,83],["Wairau Valley",-41.56667,173.53333,165],["Wairakei",-38.63333,176.1,375],["Waipu",-35.98333,174.45,9],["Waipara",-43.06667,172.75,65],["Waiouru",-39.47753,175.66834,819],["Wainuiomata",-41.26667,174.95,93],["Wainui",-38.68873,178.07048,15],["Waimauku",-36.75,174.5,80],["Waimate North",-35.31667,173.88333,179],["Waimana",-38.15,177.08333,47],["Waikuku Beach",-43.28333,172.71667,3],["Waikowhai",-43.45,169.88333,51],["Waikiwi",-46.38333,168.33333,7],["Waikino",-37.41667,175.76667,82],["Waikawa",-41.26667,174.05,35],["Waikari",-42.96667,172.68333,237],["Waikanae",-40.88333,175.06667,30],["Waihola",-46.03333,170.1,78],["Waihi Beach",-37.4,175.93333,17],["Waiau",-42.65,173.05,146],["Waiatarua",-36.93333,174.58333,272],["Waharoa",-37.76667,175.76667,54],["Wadestown",-41.26667,174.76667,157],["Urenui",-39.0,174.38333,48],["Turangi",-38.99037,175.80837,383],["Tuatapere",-46.13333,167.68333,24],["Tuamarina",-41.43333,173.95,8],["Tuakau",-37.27047,174.94384,25],["Tuai",-38.81667,177.16667,349],["Tuahiwi",-43.33333,172.65,7],["Tolaga Bay",-38.36667,178.3,10],["Tokoroa",-38.23333,175.86667,346],["Tokomaru",-40.473,175.50934,26],["Tokomaru",-38.13333,178.3,43],["Titahi Bay",-41.1,174.83333,12],["Tirau",-37.98333,175.75,151],["Tinwald",-43.91667,171.71667,102],["Tinopai",-36.25441,174.24608,7],["Tiniroto",-38.76667,177.56667,299],["Timaru",-44.39672,171.25364,14],["Te Taho",-43.21667,170.43333,55],["Te Puia",-38.06667,178.3,291],["Te Poi",-37.88333,175.83333,93],["Templeton",-43.55,172.46667,44],["Te Kauwhata",-37.4,175.15,19],["Te Karaka",-38.46667,177.86667,45],["Te Kaha",-37.73987,177.67656,19],["Te Horo",-40.8,175.1,7],["Te Awanga",-39.63333,176.98333,7],["Te Anau",-45.41667,167.71667,215],["Taupo",-38.68333,176.08333,405],["Taupiri",-37.61667,175.18333,17],["Tapawera",-41.4,172.81667,184],["Tangiteroria",-35.81667,174.05,9],["Tangimoana",-40.3,175.25,7],["Taneatua",-38.06667,177.01667,22],["Takapau",-40.03333,176.35,235],["Takaka",-40.85,172.8,10],["Tai Tapu",-43.66667,172.55,8],["Tairua",-37.01667,175.85,10],["Taipa",-34.99604,173.46665,8],["Tahunanui",-41.28706,173.24573,8],["Swannanoa",-43.38333,172.46667,67],["Stoke",-41.31667,173.23333,31],["Stirling",-46.25,169.78333,9],["Springston",-43.65,172.41667,19],["Springfield",-43.33333,171.91667,403],["Spreydon",-43.5567,172.61689,11],["Southbrook",-43.33333,172.6,17],["Southbridge",-43.81667,172.25,22],["Silverstream",-41.15,175.0,103],["Silverdale",-36.6187,174.67764,17],["Sefton",-43.25,172.66667,13],["Seddon",-41.66667,174.08333,87],["Sanson",-40.22011,175.42445,57],["Saint Clair",-45.91667,170.48333,98],["Russell",-35.26153,174.12257,8],["Ruawai",-36.13333,174.03333,4],["Ruatoria",-37.88333,178.33333,60],["Rongotea",-40.29262,175.42514,31],["Rolleston",-43.58333,172.38333,60],["Riwaka",-41.08333,173.0,9],["Riversdale",-45.9,168.75,127],["Riverhead",-36.75,174.6,20],["Richmond",-41.33333,173.18333,10],["Reporoa",-38.43594,176.34117,300],["Renwick",-41.5,173.83333,37],["Reefton",-42.11667,171.86667,199],["Redcliffs",-43.56152,172.73654,4],["Rawene",-35.40217,173.50317,53],["Raupunga",-39.03333,177.21667,64],["Raumati Beach",-40.91667,174.98333,11],["Ratapiko",-39.2,174.31667,215],["Rapaura",-41.46667,173.9,18],["Rangiriri",-37.4305,175.12971,16],["Ranfurly",-45.13333,170.1,423],["Ramarama",-37.15,174.95,23],["Rakaia",-43.75,172.01667,118],["Rahotu",-39.33333,173.8,42],["Raglan",-37.8,174.88333,31],["Puniho",-39.2,173.83333,55],["Pukerua Bay",-41.03333,174.9,101],["Pukekohe East",-37.2,174.95,115],["Prebbleton",-43.58333,172.51667,50],["Port Waikato",-37.39014,174.72755,9],["Portobello",-45.85,170.65,77],["Motueka",-41.13333,173.01667,3],["Porirua",-41.13333,174.85,58],["Pokeno",-37.24502,175.02049,28],["Pohangina",-40.17336,175.7943,128],["Plimmerton",-41.08333,174.86667,6],["Pleasant Point",-44.26667,171.13333,89],["Pirongia",-38.0,175.2,30],["Piopio",-38.46667,175.01667,145],["Piha",-36.95,174.46667,153],["Wanaka",-44.7,169.15,325],["Pauatahanui",-41.1,174.91667,1],["Pauanui",-37.01667,175.86667,13],["Patutahi",-38.61667,177.9,16],["Patumahoe",-37.18333,174.83333,64],["Parnell",-36.86667,174.78333,43],["Pareora",-44.5,171.2,13],["Paremoremo",-36.76667,174.66667,12],["Paremata",-41.11667,174.86667,64],["Paraparaumu",-40.91667,175.01667,77],["Parakai",-36.65,174.43333,4],["Papatowai",-46.56069,169.47068,25],["Palmerston North",-40.35636,175.61113,34],["Paihia",-35.28067,174.09103,9],["Paengaroa",-37.81667,176.41667,27],["Paekakariki",-40.98544,174.95449,12],["Oxford",-43.3,172.18333,244],["Owhango",-39.0,175.38333,445],["Owaka",-46.45,169.66667,11],["Outram",-45.86667,170.23333,10],["Otumoetai",-37.67156,176.13865,53],["Otorohanga",-38.18333,175.2,39],["Otautau",-46.15,168.0,55],["Otatara",-46.43333,168.3,16],["Otane",-39.88333,176.63333,91],["Otaki Beach",-40.75,175.11667,5],["Oropi",-37.83948,176.16105,321],["Orewa",-36.581,174.679,57],["Orere Point",-36.96667,175.25,34],["Oratia",-36.91667,174.61667,53],["Opua",-35.31667,174.11667,20],["Opaheke",-37.08333,174.96667,23],["Onewhero",-37.32782,174.9153,168],["Onerahi",-35.76667,174.36667,38],["Onekawa",-39.50914,176.88958,4],["Omokoroa",-37.64849,176.03497,26],["Omarama",-44.48848,169.96626,431],["Okere Falls",-38.01703,176.34507,293],["Okato",-39.2,173.88333,112],["Okaihau",-35.31667,173.78333,262],["Ohope Beach",-37.97519,177.07588,11],["Ohinemutu",-38.15,176.28333,313],["Ohariu",-41.2,174.76667,185],["Ohai",-45.91667,167.95,233],["Ohaeawai",-35.35,173.88333,151],["Oakura",-39.11667,173.95,22],["Nuhaka",-39.05,177.75,7],["North East Valley",-45.85,170.53333,61],["Normanby",-39.53333,174.28333,110],["Ngunguru",-35.61667,174.5,50],["Ngongotaha",-38.08333,176.2,292],["Ngatea",-37.28333,175.5,5],["Ngaio",-41.25039,174.77394,101],["New Plymouth",-39.06667,174.08333,64],["New Brighton",-43.51667,172.73333,6],["Nelson",-41.27078,173.28404,11],["National Park",-39.18333,175.4,817],["Napier",-39.4926,176.91233,6],["Murupara",-38.46667,176.7,201],["Muriwai Beach",-36.83659,174.43298,162],["Murchison",-41.8,172.33333,172],["Moturoa",-39.06428,174.03563,39],["Mossburn",-45.66667,168.25,288],["Mornington",-45.88333,170.46667,83],["Moerewa",-35.38333,174.03333,18],["Moawhango",-39.58016,175.86227,492],["Midhirst",-39.29336,174.2667,346],["Methven",-43.63333,171.65,319],["Meremere",-39.58333,174.38333,153],["Maungaturoto",-36.1,174.36667,42],["Maungatapere",-35.75,174.2,125],["Matakana",-36.35,174.71667,20],["Maramarua",-37.25,175.23333,43],["Maraetai",-36.88333,175.05,35],["Mapua",-41.25,173.1,6],["Manutuke",-38.68333,177.91667,6],["Manukau City",-36.99282,174.87986,43],["Mangorei",-39.15,174.08333,212],["Mangere",-36.96807,174.79875,15],["Mangawhai",-36.11667,174.56667,40],["Mangatainoka",-40.41513,175.86352,100],["Manapouri",-45.56695,167.61154,205],["Manakau",-40.71667,175.21667,34],["Manaia",-39.55,174.13333,79],["Mamaku",-38.1,176.08333,577],["Maketu",-37.76667,176.45,12],["Macandrew Bay",-45.86667,170.6,32],["Lumsden",-45.73333,168.45,216],["Luggate",-44.75,169.26667,314],["Lower Hutt",-41.21667,174.91667,9],["Longburn",-40.38395,175.5429,23],["Loburn",-43.25,172.53333,101],["Little Wanganui",-41.4,172.06667,87],["Little River",-43.76667,172.78333,121],["Lincoln",-43.65,172.48333,8],["Lepperton",-39.06667,174.21667,78],["Leithfield",-43.2,172.73333,23],["Leigh",-36.28333,174.81667,21],["Leeston",-43.76667,172.3,18],["Lake Tekapo",-44.00641,170.48033,710],["Ladbrooks",-43.61667,172.53333,16],["Kurow",-44.73341,170.46962,209],["Kumeu",-36.76667,174.56667,69],["Kopuaranga",-40.83333,175.66667,188],["Kirwee",-43.5,172.21667,159],["Kingston",-45.33288,168.71476,318],["Kimbolton",-40.05548,175.77936,460],["Kilbirnie",-41.31824,174.79506,7],["Kihikihi",-38.03333,175.35,69],["Khandallah",-41.245,174.79422,153],["Kerikeri",-35.22676,173.94739,73],["Kerepehi",-37.3,175.53333,6],["Kelvin Grove",-40.32875,175.64512,55],["Kawhia",-38.06667,174.81667,19],["Kawerau",-38.1,176.7,46],["Kawakawa",-35.38333,174.06667,40],["Kaukapakapa",-36.61667,174.5,24],["Katikati",-37.55,175.91667,9],["Karori",-41.28374,174.74141,184],["Karitane",-45.64021,170.65772,9],["Karamea",-41.25,172.11667,5],["Kaponga",-39.43333,174.15,265],["Kakanui",-45.18333,170.9,6],["Kaiwaka",-36.16667,174.45,48],["Kaikoura",-42.41667,173.68333,38],["Kaharoa",-37.99513,176.23467,416],["Kaeo",-35.1,173.78333,5],["Judgeford",-41.11667,174.93333,21],["Johnsonville",-41.22132,174.80295,151],["Jerusalem",-39.55,175.06667,80],["Invercargill",-46.4,168.35,6],["Hunterville",-39.93656,175.56835,268],["Huia",-36.99834,174.56665,9],["Howick",-36.89359,174.93174,52],["Hororata",-43.53333,171.95,193],["Hornby",-43.55,172.53333,26],["Hope",-41.36667,173.15,35],["Homai",-37.01667,174.88333,37],["Hinds",-44.0,171.56667,91],["Himatangi",-40.39146,175.3153,22],["Hikurangi",-35.6,174.3,189],["Hikuai",-37.08333,175.78333,11],["Hicks Bay",-37.6,178.3,168],["Heretaunga",-41.15,175.03333,55],["Hector",-41.6,171.88333,5],["Heathcote Valley",-43.57787,172.71224,25],["Hawarden",-42.93333,172.63333,300],["Havelock North",-39.66667,176.88333,21],["Havelock",-41.28333,173.76667,27],["Haumoana",-39.6037,176.94571,6],["Hastings",-39.6381,176.84918,19],["Haruru",-35.28066,174.05434,27],["Harihari",-43.15,170.55,50],["Harewood",-43.48333,172.58333,20],["Hanmer Springs",-42.51667,172.81667,391],["Hamurana",-38.03333,176.26667,289],["Hamilton",-37.78333,175.28333,39],["Halswell",-43.58333,172.56667,18],["Oban",-46.89887,168.12897,5],["Halcombe",-40.14332,175.4944,117],["Hakataramea",-44.73333,170.48333,199],["Haast",-43.88333,169.05,22],["Greerton",-37.72541,176.13346,43],["Glentanner",-43.90726,170.12342,545],["Glenorchy",-44.85036,168.38664,321],["Gladstone",-41.08333,175.65,84],["Frasertown",-38.96861,177.40056,21],["Franz Josef",-43.38905,170.18189,154],["Frankton",-45.02125,168.73361,350],["Foxton Beach",-40.46384,175.22716,8],["Fitzroy",-39.05,174.1,27],["Fendalton",-43.51667,172.6,13],["Favona",-36.93333,174.8,24],["Fairlie",-44.1,170.83333,305],["Fairfield",-45.9,170.4,19],["Egmont Village",-39.14534,174.14403,203],["Edgecumbe",-37.98333,176.83333,9],["Edendale",-46.31667,168.78333,43],["East Tamaki",-36.95,174.9,39],["East Taieri",-45.9,170.33333,70],["Ealing",-44.05,171.41667,112],["Dunsandel",-43.66667,172.18333,78],["Dunedin",-45.87416,170.50361,21],["Drury",-37.1,174.95,14],["Doyleston",-43.75,172.3,25],["Dobson",-42.45,171.35,55],["Dargaville",-35.93333,173.88333,8],["Darfield",-43.48333,172.11667,204],["Dairy Flat",-36.66667,174.65,63],["Cust",-43.31667,172.36667,138],["Culverden",-42.76667,172.85,192],["Coromandel",-36.7611,175.49634,7],["Colville",-36.63333,175.46667,33],["Collingwood",-40.67716,172.6807,0],["Coalgate",-43.48333,171.96667,241],["Clyde",-45.18651,169.31545,167],["Clive",-39.58333,176.91667,6],["Clinton",-46.2,169.36667,132],["Clevedon",-37.0,175.05,10],["Claudelands",-37.78333,175.28333,39],["Clarkville",-43.41667,172.61667,11],["Christchurch",-43.53333,172.63333,14],["Cheviot",-42.81667,173.26667,58],["Castlepoint",-40.9,176.21667,27],["Carters Beach",-41.75,171.56667,2],["Cardrona",-44.88333,169.0,618],["Campbells Bay",-36.74645,174.75978,18],["Burnham",-43.61667,172.31667,62],["Bunnythorpe",-40.28333,175.63333,56],["Bulls",-40.17487,175.38463,55],["Brooklyn",-41.30586,174.76257,137],["Brightwater",-41.38333,173.11667,35],["Bombay",-37.16667,174.98333,102],["Blackball",-42.36667,171.41667,89],["Bethlehem",-37.69496,176.10861,36],["Bell Block",-39.03333,174.15,34],["Belfast",-43.45,172.63333,10],["Beachlands",-36.88333,175.0,26],["Bay View",-39.42035,176.86727,8],["Barrytown",-42.24394,171.32614,161],["Awarua Plains",-46.48333,168.38333,2],["Awanui",-35.05,173.25,6],["Awakeri",-38.0,176.9,14],["Avondale",-36.88333,174.7,41],["Auckland",-36.84853,174.76349,43],["Athenree",-37.46667,175.91667,56],["Atawhai",-41.23333,173.31667,1],["Ashhurst",-40.29108,175.75471,81],["Arthurs Point",-44.98333,168.66667,363],["Aokautere",-40.36667,175.66667,47],["Amberley",-43.15589,172.72975,46],["Allanton",-45.91667,170.26667,25],["Albany",-36.71667,174.7,53],["Ahipara",-35.16604,173.15563,14],["Ahaura",-42.34925,171.53928,72],["Opunake",-39.45556,173.85833,32],["Eltham",-39.42917,174.3,219],["Hawera",-39.59167,174.28333,110],["Patea",-39.75833,174.48333,10],["Ratana",-40.04115,175.17707,47],["Foxton",-40.47277,175.28601,8],["Levin",-40.63333,175.275,38],["Otaki",-40.75268,175.13908,15],["Eastbourne",-41.3,174.9,148],["Wairoa",-39.03333,177.36667,58],["Gisborne",-38.65333,178.00417,10],["Waipawa",-41.41222,175.51528,238],["Masterton",-40.95972,175.6575,103],["Hokitika",-42.71667,170.96667,6],["Greymouth",-42.46667,171.2,11],["Westport",-41.75262,171.6037,3],["Bluff",-46.6,168.33333,31],["Riverton",-46.35,168.01667,7],["Winton",-46.15,168.33333,51],["Clifton",-43.56435,172.7492,22],["Mission Bay",-36.85472,174.83167,37],["Bayswater",-36.81556,174.77333,27],["Belmont",-36.8075,174.78639,19],["Takapuna",-36.79167,174.77583,22],["Tauranga",-37.68611,176.16667,18],["Mount Maunganui",-37.64167,176.18611,8],["Waitara",-39.00158,174.23836,8],["Port Chalmers",-45.81664,170.62037,135],["Mosgiel",-45.875,170.34722,20],["Milton",-46.12083,169.96944,20],["Kaitangata",-46.275,169.85,7],["Balclutha",-46.23389,169.75,27],["Paeroa",-37.36667,175.66667,9],["Waihi",-37.38333,175.83333,134],["Papakura",-37.0646,174.94212,14],["Whakatane",-37.95855,176.98545,11],["Opotiki",-38.00915,177.28706,7],["Thames",-37.13832,175.54011,6],["Waitangi",-43.95353,-176.55973,18],["Gore",-46.10282,168.94357,75],["Milford Sound",-44.66836,167.92005,267],["Queenstown",-45.03023,168.66271,328],["Arrowtown",-44.93837,168.81007,652],["Mataura",-46.1784,168.85009,64],["Lake Hawea",-44.60836,169.26008,347],["Cromwell",-45.03837,169.20008,212],["Alexandra",-45.24837,169.37008,152],["Roxburgh",-45.54056,169.31466,101],["Twizel",-44.25842,170.10063,466],["Whataroa",-43.2583,170.36011,64],["Waikouaiti",-45.58837,170.6501,101],["Runanga",-42.39828,171.25013,20],["Kumara",-42.62829,171.18013,86],["Geraldine",-44.09061,171.24458,119],["Waimate",-44.72836,171.05009,61],["Oamaru",-45.09758,170.97087,12],["Palmerston",-45.47837,170.7201,14],["Ashburton",-43.89834,171.73011,106],["Temuka",-44.22834,171.2801,25],["Rangiora",-43.30437,172.58356,36],["Kaiapoi",-43.37832,172.64013,4],["Mount Pleasant",-43.56276,172.71525,106],["Diamond Harbour",-43.62888,172.7254,79],["Lyttelton",-43.60314,172.71765,6],["Sumner",-43.56833,172.76013,6],["Akaroa",-43.80384,172.96817,8],["Inglewood",-39.15824,174.1802,225],["Stratford",-39.33762,174.28368,315],["Marton",-40.0692,175.37823,153],["Raetihi",-39.42877,175.27725,524],["Ohakune",-39.40824,175.40021,588],["Aotea",-39.62824,175.31021,212],["Shannon",-40.54826,175.42021,25],["Greytown",-41.07827,175.4602,60],["Carterton",-41.01827,175.5302,84],["Martinborough",-41.20827,175.4302,22],["Featherston",-41.10827,175.3202,135],["Taihape",-39.67819,175.79799,443],["Pahiatua",-40.45345,175.8406,117],["Woodville",-40.33719,175.86678,89],["Kaitaia",-35.11485,173.26366,19],["Kaikohe",-35.39818,173.80018,192],["Whangarei",-35.73167,174.32391,7],["Ruakaka",-35.90818,174.45019,14],["Helensville",-36.67819,174.45019,15],["Takanini",-37.0393,174.92815,24],["Papatoetoe",-36.9682,174.84019,19],["Otahuhu",-36.9382,174.84019,17],["Manurewa",-37.0182,174.88019,38],["Otara",-36.9482,174.87019,10],["Pakuranga",-36.88333,174.91667,36],["New Lynn",-36.90694,174.68704,21],["Onehunga",-36.9182,174.78019,59],["Mount Eden",-36.88158,174.76204,100],["Remuera",-36.88041,174.79819,88],["Newmarket",-36.86977,174.77566,64],["Ostend",-36.7982,175.04019,17],["Meremere",-37.31901,175.06903,37],["Te Kuiti",-38.33627,175.17014,60],["Taumarunui",-38.87823,175.2602,203],["Te Aroha",-37.52821,175.71021,53],["Morrinsville",-37.64821,175.5202,44],["Matamata",-37.8106,175.76237,67],["Putaruru",-38.04822,175.78021,167],["Acacia Bay",-38.70293,176.03085,408],["Te Teko",-38.03653,176.79358,19],["Cambridge",-37.87822,175.4402,67],["Te Awamutu",-38.00822,175.3302,50],["Rotorua",-38.13874,176.24516,287],["Marahau",-40.99825,173.00017,58],["Te Kopuru",-36.02819,173.90018,36],["Picton",-41.29067,174.00801,13],["Blenheim",-41.51603,173.9528,9],["Mangawhai Heads",-36.08819,174.57019,7],["Snells Beach",-36.40819,174.72019,74],["Newtown",-41.31115,174.77935,25],["Mount Victoria",-41.29696,174.7936,167],["Upper Hutt",-41.13827,175.0502,60],["Te Puke",-37.77822,176.33021,15],["Dannevirke",-40.20549,176.10084,212],["Wairoa",-39.03823,177.42022,8],["Ngaruawahia",-37.66738,175.15554,18],["Temple View",-37.82077,175.2255,49],["Huntly",-37.55821,175.1602,18],["Pegasus",-43.30832,172.69013,8],["Mount Cook Village",-43.73709,170.09926,726],["Cable Bay",-34.99438,173.49283,36],["Unsworth Heights",-36.75374,174.7215,57],["Schnapper Rock",-36.7547,174.69489,86],["Oteha Valley",-36.7201,174.71824,45],["Te Puru",-37.04658,175.52041,8],["Governors Bay",-43.62266,172.64663,87],["Matarangi",-36.73207,175.65684,8],["Kennedys Bush",-43.60324,172.5816,91],["Clarks Beach",-37.14173,174.71463,1],["Jack's Point",-45.07356,168.74828,355],["Windsor Park",-36.73966,174.7423,68],["Victoria",-38.14235,176.25093,290]];
// GeoNames populated places (CC BY 4.0). Entirely local; no coordinate API calls.
function nearbyTown(latitude,longitude,height){
 const rad=Math.PI/180;let nearest=null,best=Infinity;
 for(const [name,lat,lon,elevation] of NZ_TOWNS){const a=Math.sin((lat-latitude)*rad/2)**2+Math.cos(latitude*rad)*Math.cos(lat*rad)*Math.sin((lon-longitude)*rad/2)**2,km=12742*Math.asin(Math.min(1,Math.sqrt(a)));if(km<best){best=km;nearest={name,lat,lon,elevation};}}
 if(!nearest||best>30||!Number.isFinite(height)||Math.abs(height-nearest.elevation)>250)return '';
 // Never use a valley settlement as a label for a substantially higher mountain point.
 if(best<3)return 'Near '+nearest.name;
 const dlon=(longitude-nearest.lon)*rad,p1=nearest.lat*rad,p2=latitude*rad;
 const bearing=(Math.atan2(Math.sin(dlon)*Math.cos(p2),Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dlon))/rad+360)%360;
 const direction=['north','northeast','east','southeast','south','southwest','west','northwest'][Math.round(bearing/45)%8];
 return `${Math.round(best)} km ${direction} of ${nearest.name}`;
}
// Compact charts from static, native model-cell time series.
let pointSeries=null,pointRequest=0,pointKey='';const pointCache=new Map();
const dayFmt=new Intl.DateTimeFormat('en-NZ',{timeZone:'Pacific/Auckland',weekday:'short',day:'numeric',month:'short'});
const hourFmt=new Intl.DateTimeFormat('en-NZ',{timeZone:'Pacific/Auckland',hour:'2-digit',hourCycle:'h23'});
function closePoint(){resetTextForecast();++pointRequest;$('pointPanel').hidden=true;pointKey='';pointSeries=null;}
function openPoint(){
 if(!selected||!T)return;
 $('pointPanel').hidden=false;rollPoint(false);
 return refreshPoint();
}
async function refreshPoint(){ $('pointCharts').textContent='Use the landscape readout for this three-hourly trial.'; }
// Geometric solar-centre altitude, following SunCalc's astronomical formulae
// (Vladimir Agafonkin, BSD-2-Clause; https://github.com/mourner/suncalc).
function pointSun(ms,latitude,longitude){const r=Math.PI/180,d=ms/86400000+2440587.5-2451545,m=r*(357.5291+.98560028*d),l=m+r*(1.9148*Math.sin(m)+.02*Math.sin(2*m)+.0003*Math.sin(3*m)+102.9372)+Math.PI,e=r*23.4397,dec=Math.asin(Math.sin(l)*Math.sin(e)),ra=Math.atan2(Math.sin(l)*Math.cos(e),Math.cos(l)),h=r*(280.16+360.9856235*d+longitude)-ra,p=r*latitude;return Math.asin(Math.sin(p)*Math.sin(dec)+Math.cos(p)*Math.cos(dec)*Math.cos(h));}
function niceStep(range){const raw=Math.max(range,1)/4,p=10**Math.floor(Math.log10(raw));return [1,2,5,10].find(v=>v*p>=raw)*p;}
// Rows are preceding-hour accumulations: the row ending at midnight belongs
// to the day just completed, not the next day. Use local boundaries for DST.
function pointRainDays(rows,initial){
 const days=[];let start=0;
 for(let end=1;end<=rows.length;end++){
  const endHour=Number(hourFmt.format(new Date(initial+end*3600000)));
  if(endHour!==0&&end!==rows.length)continue;
  const startHour=Number(hourFmt.format(new Date(initial+start*3600000)));
  if(startHour===0){
   const values=rows.slice(start,end).map(r=>r[2]);
   days.push({start,end,total:values.every(Number.isFinite)?values.reduce((a,b)=>a+b,0):null,partial:endHour!==0});
  }
  start=end;
 }
 return days;
}
function drawPoint(){
 if(!pointSeries||$('pointPanel').hidden)return;
 const cell=pointSeries,rows=cell.rows.slice(0,pub.timing.display_lead_hours),n=rows.length,initial=Date.parse(pub.timing.initial_utc),date=h=>new Date(initial+h*3600000),x=h=>52+h/n*810;
 const complete=rows.every(r=>Number.isFinite(r[2]));
 $('pointTotal').textContent=complete?`Total precipitation: ${rows.reduce((sum,r)=>sum+r[2],0).toFixed(1)} mm · full ${n}-hour period${rows.some(r=>r.length>8?r[8]>=.05:(r[2]>=0.05&&isSnow(cell.height,r[6])))?' (rain + snow water equivalent)':''}`:'Total precipitation unavailable — missing hourly data';
 $('pointPlace').textContent=nearbyTown(cell.latitude,cell.longitude,cell.height);
 $('pointHeading').textContent=`${Math.abs(cell.latitude).toFixed(3)}°S, ${cell.longitude.toFixed(3)}°E · ${cell.height} m`;
 $('pointNote').textContent=pub.points_version==='v6'?'Nearest displayed model cell · 0.1° IFS model · click a chart to select an hour. Rain/snow: preceding hour, snow as water equivalent. Solid: non-convective; speckled: showery (convective). Purple snow-water is included in total, not additional. Grey shading: sun below horizon.':'Nearest displayed model cell · 0.1° IFS model · click a chart to select an hour. Rain/snow: preceding hour, snow as water equivalent. Snow colouring uses the estimated snow level. Grey shading: sun below horizon.';
 const rainDays=pointRainDays(rows,initial);
 const panels=[{title:'Temperature (green) / dewpoint (orange) · °C',keys:[0,1],colors:['#39c5a1','#f18b43']},{title:pub.points_version==='v6'?'Total: solid / speckled showery · purple alongside: snow-water (included) · mm/h':'Rain (blue) / snow (purple) · mm/h water equivalent',rain:true,colors:['#55b8ff','#bc8cf0']},{title:'Wind · km/h · arrows show flow (N ↑)',wind:true,keys:[3],colors:['#f1c56c']},{title:'Total cloud · %',cloud:true,keys:[5],colors:['#c6d9ee']}];
 let markup='';
 for(const panel of panels){
  const vals=rows.flatMap(r=>panel.rain?[r[2]]:(panel.keys||[]).map(k=>r[k]===null?null:r[k]*(panel.wind?3.6:1))).filter(Number.isFinite);
  const step=niceStep(Math.max(...vals,1)-Math.min(...vals,0)),lo=panel.rain||panel.wind||panel.cloud?0:Math.floor(Math.min(...vals,0)/step)*step,hi=panel.cloud?100:Math.max(lo+step,Math.ceil(Math.max(...vals,1)*(panel.rain?1.3:1)/step)*step),y=v=>118-(v-lo)/(hi-lo)*82;
  let svg=`<svg viewBox="0 0 880 163" role="img" aria-label="${panel.title}" class="pointChart"><text x="52" y="16" fill="#e6f2f7" font-size="12">${panel.title}</text>`;
  for(let h=1;h<=n;h++)if(pointSun(initial+(h-.5)*3600000,cell.latitude,cell.longitude)<0)svg+=`<rect x="${x(h-1)}" y="29" width="${810/n+.1}" height="89" fill="#c2cad4" opacity=".10"/>`;
  for(let v=lo;v<=hi+.001;v+=panel.cloud?25:step)svg+=`<path d="M52 ${y(v)}H862" stroke="#a6bdd5" opacity=".18"/><text x="46" y="${y(v)+4}" text-anchor="end" fill="#a8bccb" font-size="10">${Number(v.toFixed(1))}</text>`;
  for(let h=1;h<=n;h++){const hour=Number(hourFmt.format(date(h)));if(hour%6===0){svg+=`<path d="M${x(h)} 29V123" stroke="#adc1ce" opacity="${hour===0?.45:.15}"/><text x="${x(h)}" y="137" text-anchor="middle" fill="#a9c5d4" font-size="10">${String(hour).padStart(2,'0')}</text>`;}}
  let dayStart=0;for(let h=1;h<=n;h++)if(Number(hourFmt.format(date(h)))===0||h===n){if(h-dayStart>3)svg+=`<text x="${x((dayStart+h)/2)}" y="155" text-anchor="middle" fill="#d4e4ee" font-size="11">${dayFmt.format(date((dayStart+h)/2))}</text>`;dayStart=h;}
  if(panel.rain){
   svg+='<defs><pattern id="public-convective-dots" patternUnits="userSpaceOnUse" width="4" height="4"><rect width="4" height="4" fill="#79bce8"/><circle cx="1" cy="1" r=".7" fill="#163e60"/><circle cx="3" cy="3" r=".7" fill="#163e60"/></pattern></defs>';
   rows.forEach((r,i)=>{if(r[2]===null)return;const total=Math.max(0,r[2]),left=x(i),width=Math.max(.5,810/n-1);
    if(r.length>10){const cp=Math.max(0,Math.min(total,r[10])),snow=Math.max(0,Math.min(total,r[8]||0)),nonconv=total-cp,bw=width*.72;
     svg+=`<g><title>Total ${total.toFixed(2)} mm; non-convective ${nonconv.toFixed(2)} mm; convective ${cp.toFixed(2)} mm; snow-water ${snow.toFixed(2)} mm (included in total)</title><rect x="${left}" y="${y(nonconv)}" width="${bw}" height="${Math.max(0,y(0)-y(nonconv))}" fill="#55b8ff"/><rect x="${left}" y="${y(total)}" width="${bw}" height="${Math.max(0,y(nonconv)-y(total))}" fill="url(#public-convective-dots)"/><rect x="${left+width*.81}" y="${y(snow)}" width="${Math.max(.4,width*.19)}" height="${Math.max(0,y(0)-y(snow))}" fill="#bc8cf0"/></g>`;
    }else{const v=Math.round(total*10)/10;svg+=`<rect x="${left}" y="${y(v)}" width="${width}" height="${Math.max(0,y(0)-y(v))}" fill="${panel.colors[isSnow(cell.height,r[6])?1:0]}"/>`;}
   });
  }

  else{panel.keys.forEach((k,q)=>{let path='',pen=false;rows.forEach((r,i)=>{if(r[k]===null){pen=false;return;}path+=(pen?'L':'M')+x(i+1)+' '+y(r[k]*(panel.wind?3.6:1))+' ';pen=true;});svg+=`<path d="${path}" fill="none" stroke="${panel.colors[q]}" stroke-width="2"/>`;});}
  if(panel.rain)for(const day of rainDays){
   const label=day.total===null?'Total unavailable':`${day.total.toFixed(1)} mm${day.partial?' (morning)':''}`;
   svg+=`<text x="${x((day.start+day.end)/2)}" y="42" text-anchor="middle" fill="#55b8ff" font-size="10" font-weight="600" stroke="#0a1c2a" stroke-width="3" paint-order="stroke" stroke-linejoin="round"><title>${day.partial?'Midnight to end of displayed morning':'Full local calendar day'} · rain plus snow water equivalent</title>${label}</text>`;
  }
  if(panel.wind)rows.forEach((r,i)=>{if((i+1)%3||r[4]===null||r[3]<.3)return;svg+=`<g transform="translate(${x(i+1)},26) rotate(${r[4]+180})"><path d="M0 5V-5M-3 -1L0 -5L3 -1" fill="none" stroke="#e8dcad" stroke-width="1.4"/></g>`;});
  svg+=`<path d="M${x(Number($('hours').value))} 29V123" stroke="#ff5a64" stroke-width="1.5"/></svg>`;markup+=svg;
 }
 $('pointCharts').innerHTML=markup;$('pointTime').textContent=fmt.format(date(Number($('hours').value)));
 for(const svg of $('pointCharts').querySelectorAll('svg'))svg.onclick=e=>{if(loading)return;const box=svg.getBoundingClientRect(),h=Math.round(((e.clientX-box.left)/box.width*880-52)/810*n);$('hours').value=Math.max(1,Math.min(n,h));playing=false;updatePlay();loadHour();};
}
$('pointCharts').textContent='Select a location on the terrain.';
function rollPoint(rolled){
 const panel=$('pointPanel'),button=$('minPoint');
 panel.classList.toggle('pointRolled',rolled);
 button.textContent=rolled?'+':'−';button.title=rolled?'Expand point forecast':'Minimise point forecast';
 button.setAttribute('aria-label',button.title);button.setAttribute('aria-expanded',String(!rolled));
 if(!rolled && panel.style.top){const b=panel.getBoundingClientRect();panel.style.top=Math.max(0,Math.min(innerHeight-b.height,b.top))+'px';panel.style.left=Math.max(0,Math.min(innerWidth-b.width,b.left))+'px';}
}
$('minPoint').onclick=()=>rollPoint(!$('pointPanel').classList.contains('pointRolled'));
$('closePoint').onclick=closePoint;
$('info').addEventListener('click',e=>{if(e.target.closest('#openPoint'))openPoint();});

// Drag only the title area: chart clicks and scrolling retain their own behaviour.
const pointDragHandle=$('pointDragHandle');let panelDrag=null;
pointDragHandle.addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('button'))return;const b=$('pointPanel').getBoundingClientRect();panelDrag={x:e.clientX,y:e.clientY,left:b.left,top:b.top};pointDragHandle.setPointerCapture(e.pointerId);e.preventDefault();});
pointDragHandle.addEventListener('pointermove',e=>{if(!panelDrag)return;const panel=$('pointPanel'),b=panel.getBoundingClientRect();panel.style.left=Math.max(0,Math.min(innerWidth-b.width,panelDrag.left+e.clientX-panelDrag.x))+'px';panel.style.top=Math.max(0,Math.min(innerHeight-b.height,panelDrag.top+e.clientY-panelDrag.y))+'px';panel.style.bottom='auto';});
for(const event of ['pointerup','pointercancel','lostpointercapture'])pointDragHandle.addEventListener(event,()=>{panelDrag=null;});
addEventListener('resize',()=>{const panel=$('pointPanel');if(panel.hidden||!panel.style.top)return;const b=panel.getBoundingClientRect();panel.style.left=Math.max(0,Math.min(innerWidth-b.width,b.left))+'px';panel.style.top=Math.max(0,Math.min(innerHeight-b.height,b.top))+'px';});

// Resize the viewport independently in both dimensions. The fixed heading and
// corner handles stay accessible while the forecast content scrolls inside.
for(const handle of $('pointPanel').querySelectorAll('.pointResize')){
 let resizeStart=null;
 handle.addEventListener('pointerdown',e=>{
  if(e.button!==0)return;
  const panel=$('pointPanel'),b=panel.getBoundingClientRect();
  resizeStart={x:e.clientX,y:e.clientY,left:b.left,top:b.top,right:b.right,bottom:b.bottom,width:b.width,height:b.height};
  panel.style.maxHeight='calc(100vh - 8px)';
  handle.setPointerCapture(e.pointerId);e.preventDefault();e.stopPropagation();
 });
 handle.addEventListener('pointermove',e=>{
  if(!resizeStart)return;
  const s=resizeStart,c=handle.dataset.corner,west=c.includes('w'),north=c.includes('n'),panel=$('pointPanel');
  const maxWidth=west?s.right:innerWidth-s.left,maxHeight=north?s.bottom:innerHeight-s.top;
  const width=Math.max(Math.min(320,maxWidth),Math.min(maxWidth,s.width+(e.clientX-s.x)*(west?-1:1)));
  const height=Math.max(Math.min(240,maxHeight),Math.min(maxHeight,s.height+(e.clientY-s.y)*(north?-1:1)));
  Object.assign(panel.style,{width:width+'px',height:height+'px',left:(west?s.right-width:s.left)+'px',top:(north?s.bottom-height:s.top)+'px',bottom:'auto'});
  e.preventDefault();e.stopPropagation();
 });
 for(const event of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(event,()=>{resizeStart=null;});
}

function displayDailyFacts(facts){return facts.replace(/; total precipitation 0\.0 mm(?: \(including snow water equivalent\))?\./g,'.');}

// Only a current public grid reference is submitted; forecast data stays server-owned.
let textPoint=null,textSerial=0;
function resetTextForecast(){textSerial++;$('forecastText').textContent='';$('generateText').disabled=false;$('generateText').textContent='Generate text forecast';}
$('generateText').hidden=true;
// Local settlement search: no geocoder calls or transmission of typed locations.
function placeSearchKey(value){return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();}
function findPlaces(query){const q=placeSearchKey(query);if(q.length<2)return [];return NZ_TOWNS.filter(p=>placeSearchKey(p[0]).includes(q)).sort((a,b)=>(placeSearchKey(a[0]).startsWith(q)?0:1)-(placeSearchKey(b[0]).startsWith(q)?0:1)||a[0].localeCompare(b[0])).slice(0,10);}
function placeInRegion(place,bounds){const [,lat,lon]=place,[w,e,s,n]=bounds;return lat>=s&&lat<=n&&lon>=w&&lon<=e;}
function choosePlace(place){
 const [name,lat,lon]=place;
 if(!T||!W||loading){$('placeSearchNote').textContent='Please wait for this region to finish loading.';return;}
 if(!placeInRegion(place,T.bounds)){$('placeSearchNote').textContent=name+' is outside the current region. Choose another region to show it.';return;}
 const [x,z]=xy(lat,lon),y=height(x,z);
 if(!Number.isFinite(y)||!Number.isFinite(sample(W.temperature,x,z))){$('placeSearchNote').textContent='Forecast data is unavailable at '+name+'.';return;}
 inspect(new THREE.Vector3(x,y,z));$('placeQuery').value=name;$('placeMatches').replaceChildren();$('placeQuery').setAttribute('aria-expanded','false');
 $('placeSearchNote').textContent='Red marker: '+name+'. Open Point forecast for its nearest model cell.';
}
function renderPlaceMatches(){
 const results=$('placeMatches');results.replaceChildren();const matches=findPlaces($('placeQuery').value);$('placeQuery').setAttribute('aria-expanded',String(matches.length>0));
 $('placeSearchNote').textContent=matches.length?'Select a town or settlement.':($('placeQuery').value.trim().length>=2?'No matching settlement in the local list.':'Type at least two letters.');
 for(const place of matches){const button=document.createElement('button');button.type='button';button.textContent=place[0]+' · '+Math.abs(place[1]).toFixed(2)+'°S, '+place[2].toFixed(2)+'°E'+(T&&!placeInRegion(place,T.bounds)?' · outside region':'');button.onclick=()=>choosePlace(place);results.append(button);
  const fly=document.createElement('button');fly.type='button';fly.textContent='Fly to '+place[0]+' · location orbit';fly.onclick=()=>flyToCity(place);results.append(fly);
 }
}
$('placeQuery').addEventListener('input',renderPlaceMatches);
$('placeQuery').addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();$('placeMatches').querySelector('button')?.focus();}if(e.key==='Escape'){$('placeMatches').replaceChildren();$('placeQuery').setAttribute('aria-expanded','false');}});
$('placeMatches').addEventListener('keydown',e=>{const buttons=[...$('placeMatches').querySelectorAll('button')],i=buttons.indexOf(document.activeElement);if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();buttons[Math.max(0,Math.min(buttons.length-1,i+(e.key==='ArrowDown'?1:-1)))]?.focus();}if(e.key==='Escape'){$('placeMatches').replaceChildren();$('placeQuery').setAttribute('aria-expanded','false');$('placeQuery').focus();}});
$('region').addEventListener('change',()=>{$('placeMatches').replaceChildren();$('placeQuery').setAttribute('aria-expanded','false');$('placeSearchNote').textContent='Search again after the region loads.';});
$('viewCount').textContent='Private local trial';
// Exact height on the two triangles used by makeTerrain (scene kilometres).
function meshHeightAt(grid,x,z,exaggeration){
 const fx=(x/grid.width_km+.5)*(grid.nx-1),fy=(z/grid.depth_km+.5)*(grid.ny-1);
 if(fx<0||fy<0||fx>=grid.nx-1||fy>=grid.ny-1)return NaN;
 const ix=Math.floor(fx),iy=Math.floor(fy),a=fx-ix,b=fy-iy,k=iy*grid.nx+ix;
 if(!grid.valid[k]||!grid.valid[k+1]||!grid.valid[k+grid.nx]||!grid.valid[k+grid.nx+1])return NaN;
 const h=i=>Math.max(0,grid.height[i])*exaggeration/1000;
 return a+b<=1?h(k)*(1-a-b)+h(k+1)*a+h(k+grid.nx)*b:h(k+1)*(1-b)+h(k+grid.nx)*(1-a)+h(k+grid.nx+1)*(a+b-1);
}
// A line crosses a piecewise-planar surface only between grid/diagonal crossings.
// Checking these breakpoints gives terrain occlusion without raycasting every face.
function terrainBlocksSight(grid,eye,target,exaggeration){
 const ax=(eye.x/grid.width_km+.5)*(grid.nx-1),az=(eye.z/grid.depth_km+.5)*(grid.ny-1);
 const bx=(target.x/grid.width_km+.5)*(grid.nx-1),bz=(target.z/grid.depth_km+.5)*(grid.ny-1);
 const cuts=[0,1];
 for(const [a,b,max] of [[ax,bx,grid.nx-1],[az,bz,grid.ny-1],[ax+az,bx+bz,grid.nx+grid.ny-2]]){
  if(Math.abs(b-a)<1e-10)continue;
  for(let v=Math.max(0,Math.ceil(Math.min(a,b)));v<=Math.min(max,Math.floor(Math.max(a,b)));v++){
   const t=(v-a)/(b-a);if(t>0&&t<1)cuts.push(t);
  }
 }
 for(const t of cuts){
  const x=eye.x+(target.x-eye.x)*t,z=eye.z+(target.z-eye.z)*t,y=eye.y+(target.y-eye.y)*t;
  const ground=meshHeightAt(grid,x,z,exaggeration);
  if(Number.isFinite(ground)&&ground>y+.005)return true;
 }
 return false;
}
var markerVisibilityTime=0;
function markerTerrainHeight(x,z){return T?meshHeightAt(T,x,z,Number($('exaggeration').value)):NaN;}
function markerOccluded(target){return terrainBlocksSight(T,camera.position,target,Number($('exaggeration').value));}
// Display relief is independent of the original model-cell weather and height.
function selectTerrain(){
 if(!T)return;
 T.model_height??=T.height;T.model_land??=T.land;
 const detailed=$('detailTerrain').checked&&T.detail_height;
 T.height=detailed?T.detail_height:T.model_height;
 T.land=detailed?T.detail_land:T.model_land;
 $('detailNote').textContent=detailed?'Copernicus relief · weather remains 0.1° IFS':'Model terrain · 0.1° IFS cell heights';
}
$('detailTerrain').onchange=()=>{selectTerrain();updateHeight();colour();if(selected&&W)inspect(selected);};
const TOWN_NAMES=['Bell Block','Ōtaki','Otaki','Wellington','Nelson','Palmerston North','Blenheim','Masterton','Levin','Westport','Greymouth','Hokitika','Christchurch','Timaru','Wanaka','Wānaka','Queenstown','Te Anau','Dunedin','Invercargill','Auckland','Hamilton','Tauranga','Rotorua','Taupo','Taupō','New Plymouth','Napier','Gisborne','Whangarei','Whangārei','Whanganui','Hawera','Stratford','Taumarunui','Turangi','Ohakune','Te Kuiti','Raglan','Tokoroa','Whakatane','Opotiki','Wairoa','Dannevirke','Ashburton','Oamaru','Gore','Balclutha','Kaikoura','Motueka','Takaka','Kaitaia','Kerikeri','Dargaville','Thames','Whitianga','Alexandra','Cromwell'];
// Draw names in the same pass as their ground anchors, before the cloud volume.
var groundTownLabels = NZ_TOWNS.filter(([name]) => TOWN_NAMES.includes(name))
  .sort((a,b) => TOWN_NAMES.indexOf(a[0]) - TOWN_NAMES.indexOf(b[0]))
  .map(([name,lat,lon]) => {
    const title = ({Otaki:'Ōtaki',Taupo:'Taupō',Turangi:'Tūrangi',Whakatane:'Whakatāne',Opotiki:'Ōpōtiki',Kaikoura:'Kaikōura',Hawera:'Hāwera'})[name] || name;
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
    ctx.font = '11px system-ui';
    const width = Math.ceil(ctx.measureText(title).width) + 16, height = 20;
    canvas.width = width * 3;
    canvas.height = height * 3;
    ctx.scale(3,3);
    ctx.font = '11px system-ui';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#000'; ctx.shadowBlur = 4;
    ctx.fillStyle = '#e0e9e6';
    ctx.beginPath(); ctx.arc(4,10,2,0,2*Math.PI); ctx.fill();
    ctx.fillText(title,10,10);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map, transparent:true, opacity:.85, depthWrite:false, depthTest:false, toneMapped:false}));
    sprite.center.set(4/width,.5);
    sprite.visible = false;
    sprite.renderOrder = 1;
    scene.add(sprite);
    return {name,lat,lon,sprite,width,height};
  });
function updateTownMarkers() {
  if (!groundTownLabels || !T) return;
  camera.updateMatrixWorld();
  const now = performance.now(), check = now-markerVisibilityTime > 100;
  if (check) markerVisibilityTime = now;
  if(selectionDot)selectionDot.material.size=12*scenePixels;
  if (selectionDot && selected && selectionDot.visible && check)
    selectionDot.material.opacity = markerOccluded(selectionDot.position) ? 0 : 1;
  const occupied = [], national = $('region').value === 'nz';
  for (const label of groundTownLabels) {
    const {sprite,name,width,height} = label;
    sprite.visible = false;
    if (occupied.length >= (national ? 18 : 24)) continue;
    if (national && !['Otaki','Ōtaki','Wellington','Nelson','Christchurch','Queenstown','Dunedin','Auckland','Hamilton','Tauranga','Napier','New Plymouth','Whangarei','Whangārei','Whanganui','Gisborne','Taupo','Rotorua','Invercargill','Timaru','Blenheim','Kaitaia'].includes(name)) continue;
    const [x,z] = xy(label.lat,label.lon), y = markerTerrainHeight(x,z);
    if (!Number.isFinite(y)) continue;
    sprite.position.set(x,y,z);
    const p = sprite.position.clone().project(camera);
    if (p.z < -1 || p.z > 1 || Math.abs(p.x) > .97 || Math.abs(p.y) > .92) continue;
    if (check || label.terrain !== T) {
      label.blocked = markerOccluded(sprite.position); label.terrain = T;
    }
    if (label.blocked) continue;
    const px = (1+p.x)*innerWidth/(2*scenePixels*desktopSymbolScale), py = (1-p.y)*innerHeight/(2*scenePixels*desktopSymbolScale);
    if (occupied.some(b => Math.abs(py-b.y)<22 && px<b.x+b.w+12 && px+width+12>b.x)) continue;
    const depth = -sprite.position.clone().applyMatrix4(camera.matrixWorldInverse).z;
    const kmPerPixel = 2*scenePixels*desktopSymbolScale*depth/(camera.projectionMatrix.elements[5]*innerHeight);
    sprite.scale.set(width*kmPerPixel,height*kmPerPixel,1);
    sprite.visible = true;
    occupied.push({x:px,y:py,w:width});
  }
}
// View settings live in the URL fragment, never cookies or a saved-view database.
function parseSharedView(hash){
 if(!hash.startsWith('#view='))return null;
 try{
  if(hash.length>3000)throw Error('Too long');
  const v=JSON.parse(decodeURIComponent(hash.slice(6)));
  const vector=a=>Array.isArray(a)&&a.length===3&&a.every(n=>Number.isFinite(n)&&Math.abs(n)<100000);
  if(v.v!==1||!['nz','north','east','west','otaki','alps'].includes(v.r)||!vector(v.p)||!vector(v.t)||Math.hypot(...v.p.map((n,i)=>n-v.t[i]))<.01)throw Error('Invalid camera');
  if(!Array.isArray(v.o)||v.o.length!==2||!v.o.every(n=>Number.isFinite(n)&&Math.abs(n)<=2))throw Error('Invalid offset');
  for(const [key,id] of [['e','exaggeration'],['s','speed'],['d','density']]){
   const input=$(id);if(!Number.isFinite(v[key])||v[key]<Number(input.min)||v[key]>Number(input.max))throw Error('Invalid setting');
  }
  if(typeof v.detail!=='boolean')throw Error('Invalid terrain');
  return v;
 }catch{return null;}
}
$('shareView').onclick=async()=>{
 if(!T||loading)return;
 const rounded=a=>a.map(n=>Number(n.toFixed(5)));
 const view={v:1,r:$('region').value,p:rounded(camera.position.toArray()),t:rounded(controls.target.toArray()),o:camera.view?.enabled?[camera.view.offsetX/camera.view.fullWidth,camera.view.offsetY/camera.view.fullHeight]:[0,0],e:Number($('exaggeration').value),s:Number($('speed').value),d:Number($('density').value),detail:$('detailTerrain').checked};
 const url=new URL(location.href);url.search='';url.hash='view='+encodeURIComponent(JSON.stringify(view));
 history.replaceState(null,'',url);
 $('shareLink').value=url.href;$('shareResult').hidden=false;
 try{await navigator.clipboard.writeText(url.href);$('shareStatus').textContent='Link copied. Share it or bookmark this page. Opens the latest forecast at Now.';}
 catch{$('shareStatus').textContent='Copy this link, or bookmark this page. Opens the latest forecast at Now.';$('shareLink').focus();$('shareLink').select();}
};
async function restoreSharedView(){
 const view=parseSharedView(location.hash);
 if(!view){if(location.hash.startsWith('#view=')){$('shareResult').hidden=false;$('shareStatus').textContent='This view link is invalid. Showing the standard overview.';}return;}
 $('region').value=view.r;previousRegion=view.r;$('exaggeration').value=view.e;$('exLabel').textContent=view.e+'×';$('speed').value=view.s;$('density').value=view.d;$('detailTerrain').checked=view.detail;
 playing=false;updatePlay();
 $('hours').value=nearestForecastHour(Date.now(),pub.timing.initial_utc,Number($('hours').min),Number($('hours').max));
 await loadRegion();if(!T||loading)return;
 const damping=controls.enableDamping;controls.enableDamping=false;controls.update();
 controls.target.fromArray(view.t);camera.position.fromArray(view.p);
 camera.setViewOffset(innerWidth,innerHeight,view.o[0]*innerWidth,view.o[1]*innerHeight,innerWidth,innerHeight);
 controls.update();controls.enableDamping=damping;overviewCamera=false;
}
if(pub)await restoreSharedView();
// Update only after weather is accepted: this labels the visible map, not a pending hour.
function updateMapTime(){
 const el=$('mapTime');if(!el||!pub||!W)return;
 const date=new Date(Date.parse(pub.timing.initial_utc)+W.hour*3600000);
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Pacific/Auckland',year:'numeric',month:'short',day:'numeric',weekday:'short',hour:'numeric',hour12:true}).formatToParts(date);
 const part=type=>parts.find(p=>p.type===type)?.value||'';
 $('mapTimeDate').textContent=part('year')+' '+part('month')+' '+part('day');
 $('mapTimeMain').textContent=part('weekday')+' '+part('hour').padStart(2,' ')+' '+part('dayPeriod');
 $('mapTimeZone').textContent=nzZone(date);el.setAttribute('aria-label',fmt.format(date));el.hidden=false;positionMapTime();
}
function positionMapTime(){
 const el=$('mapTime');if(!el||el.hidden)return;
 const panel=$('panel').getBoundingClientRect(),header=document.querySelector('header').getBoundingClientRect();
 const width=el.getBoundingClientRect().width,right=panel.left-24;
 el.style.left=Math.max(12,right-width)+'px';
 el.style.top=(right-width>header.right+16?28:header.bottom+12)+'px';
}
addEventListener('resize',positionMapTime);
// Clear view changes only interface visibility. Map gestures stay with OrbitControls.
function isClearView(){return document.body.classList.contains('clearView');}
function setClearView(value){
 document.body.classList.toggle('clearView',value);$('restoreControls').textContent=value?'Show controls':'Hide controls';$('restoreControls').setAttribute('aria-expanded',String(!value));
 down=null;positionMapTime();updateClearControls();
 $('restoreControls').focus();
}
function updateClearControls(){
 const button=$('clearPlay');if(!button)return;
 const label=playing?'❚❚ Pause':'▶ Play';
 if(button.textContent!==label){button.textContent=label;button.setAttribute('aria-label',playing?'Pause forecast':'Play forecast');}
 // Keep controls steady while the next frame loads; W is cleared on region changes.
 const h=Number($('hours').value);$('clearBack').disabled=!W||h<=Number($('hours').min);$('clearForward').disabled=!W||h>=Number($('hours').max);button.disabled=!W;$('clearNow').disabled=!W;
}
if(isClearView()){$('restoreControls').textContent='Show controls';$('restoreControls').setAttribute('aria-expanded','false');}
$('restoreControls').onclick=()=>setClearView(!isClearView());
$('clearNow').onclick=()=>{$('nowHour').click();updateClearControls();};
$('clearBack').onclick=()=>stepHour(-1);$('clearForward').onclick=()=>stepHour(1);
$('clearPlay').onclick=()=>{if(!W)return;playing=!playing;lastAdvance=performance.now();updatePlay();updateClearControls();};
addEventListener('keydown',e=>{if(e.key==='Escape'&&isClearView())setClearView(false);});

$('forecastPlaybackSpeed').onchange=e=>{forecastPlaybackRate=Number(e.target.value);lastAdvance=performance.now();};

// Independent panel disclosure; preserves forecast, camera and playback state.
{
 const style=document.createElement('style');
 style.textContent=`
 .panelDisclosure{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}
 .panelDisclosure strong{font:600 12px system-ui;letter-spacing:.06em;color:#a5c3d1}
 .panelDisclosure button{min-width:36px;min-height:36px;padding:3px 8px;font:20px system-ui;line-height:1}
 header.panelRolled,#panel.panelRolled{width:auto;max-width:calc(50vw - 24px);padding:8px 12px;overflow:visible}
 .panelRolled .panelDisclosure{margin-bottom:0}
 .panelContents[hidden]{display:none!important}
 `;
 document.head.append(style);
 for(const [panel,title,id] of [[document.querySelector('header'),'IFS · LOCAL','brisInfoContents'],[$('panel'),'Controls','brisControlsContents']]){
  const content=document.createElement('div');content.id=id;content.className='panelContents';
  while(panel.firstChild)content.append(panel.firstChild);
  const bar=document.createElement('div');bar.className='panelDisclosure';
  const heading=document.createElement('strong');heading.textContent=title;
  const button=document.createElement('button');button.type='button';button.setAttribute('aria-controls',id);
  const setExpanded=expanded=>{content.hidden=!expanded;panel.classList.toggle('panelRolled',!expanded);button.textContent=expanded?'−':'+';button.setAttribute('aria-expanded',String(expanded));button.setAttribute('aria-label',(expanded?'Minimise ':'Expand ')+title);button.title=(expanded?'Minimise ':'Expand ')+title;};
  button.onclick=()=>{setExpanded(content.hidden);positionMapTime();};
  bar.append(heading,button);panel.append(bar,content);setExpanded(id!=='brisInfoContents');
 }
 positionMapTime();
}

// Copy a self-contained forecast and the underlying displayed hourly meteogram.
{
 const button=document.createElement('button');button.id='copyForecast';button.textContent='Copy forecast + meteogram';button.hidden=true;button.style.marginLeft='8px';
 const status=document.createElement('span');status.setAttribute('role','status');status.className='sub';
 $('generateText').after(button,status);
 const output=$('forecastText');
 new MutationObserver(()=>{button.hidden=!output.querySelector('p > strong');status.textContent='';}).observe(output,{childList:true,subtree:true});
 button.onclick=async()=>{
  if(!pointSeries)return;
  const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rows=pointSeries.rows.slice(0,pub.timing.display_lead_hours),initial=Date.parse(pub.timing.initial_utc);
  const headers=['NZ date/time','Temperature °C','Dewpoint °C','Rain mm','Snow mm water equivalent','Wind km/h','Wind from °','Cloud %'];
  const number=v=>Number.isFinite(v)?v.toFixed(1):'—';
  const values=rows.map((r,i)=>{const snow=isSnow(pointSeries.height,r[6]);return [fmt.format(new Date(initial+(i+1)*3600000)),number(r[0]),number(r[1]),number(Number.isFinite(r[2])?(snow?0:r[2]):null),number(Number.isFinite(r[2])?(snow?r[2]:0):null),number(Number.isFinite(r[3])?r[3]*3.6:null),number(r[4]),number(r[5])];});
  const intro=[$('pointPlace').textContent,$('pointHeading').textContent,'Model initialisation: '+pub.timing.initial_utc,$('pointTotal').textContent].filter(Boolean);
  const note='Hourly meteogram: rain and snow amounts cover the preceding hour; snow is water equivalent. Wind direction is the direction the wind comes from. The table covers the full displayed period; the text forecast covers its stated remaining period.';
  const plain=[...intro,'',output.innerText,'','https://www.metservice.com/warnings/home','',note,headers.join('\t'),...values.map(r=>r.join('\t')),'','Source: https://weather3d.neilgordon.me/'].join('\n');
  let html=intro.map(s=>'<p>'+escape(s)+'</p>').join('')+output.innerHTML+'<p>'+escape(note)+'</p><table border="1" cellspacing="0" cellpadding="4"><thead><tr>'+headers.map(s=>'<th>'+escape(s)+'</th>').join('')+'</tr></thead><tbody>'+values.map(r=>'<tr>'+r.map(s=>'<td>'+escape(s)+'</td>').join('')+'</tr>').join('')+'</tbody></table><p>Source: <a href="https://weather3d.neilgordon.me/">weather3d.neilgordon.me</a></p>';
  try{
   // Rasterise the existing SVG charts for clipboard applications that reject SVG.
   const charts=[...$('pointCharts').querySelectorAll('svg')];
   const canvas=document.createElement('canvas');canvas.width=1760;canvas.height=charts.length*326;
   const ctx=canvas.getContext('2d');ctx.fillStyle='#0b1b2c';ctx.fillRect(0,0,canvas.width,canvas.height);
   for(let i=0;i<charts.length;i++){
    const svg=charts[i].cloneNode(true);svg.setAttribute('xmlns','http://www.w3.org/2000/svg');svg.setAttribute('width','1760');svg.setAttribute('height','326');svg.style.fontFamily='Arial, sans-serif';
    const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml'}));
    try{const img=new Image();img.src=url;await img.decode();ctx.drawImage(img,0,i*326,1760,326);}finally{URL.revokeObjectURL(url);}
   }
   html='<p>'+escape($('pointTime').textContent)+'</p>'+html+'<p>'+escape($('pointNote').textContent.replace(' · click a chart to select an hour.','.'))+'</p><img alt="Point forecast meteogram" width="880" src="'+canvas.toDataURL('image/png')+'">';
   if(navigator.clipboard.write&&typeof ClipboardItem!=='undefined')await navigator.clipboard.write([new ClipboardItem({'text/plain':new Blob([plain],{type:'text/plain'}),'text/html':new Blob([html],{type:'text/html'})})]);
   else await navigator.clipboard.writeText(plain);
   status.textContent=' Copied';
  }catch(e){status.textContent=' Copy was blocked by the browser. Please allow clipboard access and try again.';}
 };
}

// Official alert facts are added at display time, separately from model prose.
// This also keeps cached forecasts aligned with the latest CAP snapshot.
function officialAlertSummary(day,cap){
 return (day.alerts||[]).map(alert=>{
  const title=alert.title.replace(/^MetService\s+/i,'');
  const timing=alert.first?`from ${fmt.format(new Date(alert.onset))} until ${fmt.format(new Date(alert.expires))}`:`until ${fmt.format(new Date(alert.expires))}`;
  if(cap?.stale)return `The last checked MetService bulletin lists ${title} for ${alert.area}, ${timing}; check MetService for its current status.`;
  return alert.first?`MetService has issued ${title} for ${alert.area}, ${timing}.`:`MetService’s ${title} for ${alert.area} continues ${timing}.`;
 }).join(' ');
}

// Private trial: continuous RH volume, inspired by WeatherExplorer's ray marcher.
// Pressure-level cells end halfway to the adjacent model geopotential heights.
function cloudLevelSelected(level,selected){return selected==='all'||selected==='low'&&level>=700||selected==='middle'&&level<700&&level>=400||selected==='high'&&level<400||Number(selected)===level;}
// Approximate cloud bands in pressure coordinates; interpolate between sampled
// levels to keep the continuous volume free from artificial horizontal seams.
function cloudBaseThreshold(level){return level>800?90:level>450?75:60;}
function scaledCloudThreshold(base,middle){return Math.max(0,Math.min(100,base*middle/75));}
function cloudColumnBounds(layers,i){
 const heights=layers.map(l=>l.height[i]??44330*(1-Math.pow(l.level/1013.25,.1903)));
 return heights.map((h,k)=>({height:h,lower:k?(heights[k-1]+h)/2:Math.max(0,h-(heights[k+1]-h)/2),upper:k<heights.length-1?(h+heights[k+1])/2:h+(h-heights[k-1])/2}));
}
const cloudTerrainTextures=new WeakMap();
function makeCloudVolume(data,terrain,selected,ex,packed){
 const {voxels,top,ny,nx,nz}=packed,g=data.grid,layers=data.layers,chosen=layers.map(l=>cloudLevelSelected(l.level,selected));
 const volumeTexture=new THREE.Data3DTexture(voxels,nx,ny,nz);volumeTexture.format=THREE.RGBAFormat;volumeTexture.type=THREE.UnsignedByteType;volumeTexture.minFilter=volumeTexture.magFilter=THREE.LinearFilter;volumeTexture.unpackAlignment=1;volumeTexture.needsUpdate=true;
 // 16-bit packed terrain preserves terrain clipping without float-filter extensions.
 const terrainKey=terrain.height;let terrainEntry=cloudTerrainTextures.get(terrainKey);
 if(!terrainEntry){
 const ground=new Uint8Array(terrain.nx*terrain.ny*2);
 for(let i=0;i<terrain.height.length;i++){const h=Math.round(Math.min(1,Math.max(0,terrain.height[i]/8192))*65535);ground[i*2]=h>>8;ground[i*2+1]=h&255;}
 const groundTexture=new THREE.DataTexture(ground,terrain.nx,terrain.ny,THREE.RGFormat);groundTexture.minFilter=groundTexture.magFilter=THREE.LinearFilter;groundTexture.unpackAlignment=1;groundTexture.needsUpdate=true;

 terrainEntry={texture:groundTexture,users:0};cloudTerrainTextures.set(terrainKey,terrainEntry);
 }
 terrainEntry.users++;const groundTexture=terrainEntry.texture;
 const uniforms={...cloudUniforms,raySteps:{value:80},volume:{value:volumeTexture},previousVolume:{value:volumeTexture},frameBlend:{value:1},currentHeightRatio:{value:1},previousHeightRatio:{value:1},ground:{value:groundTexture},terrainHeightRatio:{value:8192/top*Number($('exaggeration').value)/ex},camLocal:{value:new THREE.Vector3()},physicalScale:{value:new THREE.Vector3(g.width_km,top/1000,g.depth_km)}};
 const material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,uniforms,transparent:true,depthWrite:false,depthTest:false,side:THREE.BackSide,
 vertexShader:`out vec3 localPosition;void main(){localPosition=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
 fragmentShader:`precision highp float;precision highp sampler3D;
 uniform sampler3D volume,previousVolume;uniform float frameBlend,currentHeightRatio,previousHeightRatio;uniform sampler2D ground;uniform float terrainHeightRatio;uniform int raySteps;uniform float threshold,density;uniform vec3 camLocal,physicalScale;
 in vec3 localPosition;out vec4 fragColor;
 vec2 hitBox(vec3 o,vec3 d){vec3 a=(vec3(-.5)-o)/d,b=(vec3(.5)-o)/d;vec3 lo=min(a,b),hi=max(a,b);return vec2(max(max(lo.x,lo.y),lo.z),min(min(hi.x,hi.y),hi.z));}
 float landHeight(vec2 uv){vec2 h=texture(ground,uv).rg;return dot(h,vec2(65280.0/65535.0,255.0/65535.0))*terrainHeightRatio/currentHeightRatio;}
 float cloudAmount(vec3 field){
  float localThreshold=clamp(field.b*threshold/75.0,0.0,1.0);
  float amount=localThreshold>=.999?step(.998,field.r):smoothstep(localThreshold,min(1.0,localThreshold+.08),field.r);
  return amount*field.g;
 }
 uniform float textured;uniform highp sampler3D detailNoise;
 float cloudAt(vec3 p){
  vec3 uv=p+.5;if(any(lessThan(uv,vec3(0.0)))||any(greaterThan(uv,vec3(1.0))))return 0.0;
  if(uv.y<landHeight(uv.xz))return 0.0;
  vec3 currentUV=vec3(uv.x,uv.y*currentHeightRatio,uv.z);
  float current=currentUV.y<=1.0?cloudAmount(texture(volume,currentUV).rgb):0.0;
  float amount=current;
  if(frameBlend<1.0){vec3 previousUV=vec3(uv.x,uv.y*previousHeightRatio,uv.z);float previous=previousUV.y<=1.0?cloudAmount(texture(previousVolume,previousUV).rgb):0.0;amount=mix(previous,current,frameBlend);}
  float edge=smoothstep(0.0,.018,min(min(uv.x,1.0-uv.x),min(uv.z,1.0-uv.z)));
  // Smooth humidity edges without adding invented meteorological structure.

  return amount*edge;
 }
 void main(){
  if(density<=0.0)discard;vec3 dir=normalize(localPosition-camLocal);vec2 bounds=hitBox(camLocal,dir);bounds.x=max(bounds.x,0.0);if(bounds.x>=bounds.y)discard;
  int steps=raySteps;float dt=(bounds.y-bounds.x)/float(steps);
  float jitter=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);
  vec3 p=camLocal+dir*(bounds.x+dt*jitter);float physicalStep=length(dir*physicalScale*vec3(.12,1.0,.12))*dt;
  vec3 exitUV=camLocal+dir*bounds.y+.5;
  bool overTerrain=dir.y<0. && exitUV.y<=landHeight(clamp(exitUV.xz,0.,1.))+.001;
  vec3 colour=vec3(0.0);float alpha=0.0;
  for(int i=0;i<steps;i++){
   // Stop at the first terrain intersection, including intervening ridges.
   if(p.y+.5<landHeight(p.xz+.5)){overTerrain=true;break;}
   float c=alpha>.98 ? 0.0 : cloudAt(p);
   if(c>.001){
    float a=1.0-exp(-c*density*physicalStep*1.8);
    vec3 lightOffset=vec3(-.7,1.0,-.3)/physicalScale;
    float shade;
    shade=exp(-(cloudAt(p+lightOffset*.3)+cloudAt(p+lightOffset*.8))*density*1.7);
     if(textured>.5){
       // Broad, low-contrast, world-anchored detail changes lighting only.
       vec3 km=vec3(p.x,p.y+.5,p.z)*physicalScale;
       float softDetail=texture(detailNoise,km*vec3(.08,.20,.08)/32.0).r;
       shade=clamp(shade+.16*(softDetail-.5),0.0,1.0);
     }
     vec3 lit=mix(vec3(.36,.43,.53),vec3(.96,.98,1.0),shade);
    colour+=(1.0-alpha)*a*lit;alpha+=(1.0-alpha)*a;
    if(alpha>.98)break;
   }
   p+=dir*dt;
  }
  if(alpha<.003)discard;fragColor=vec4(colour/alpha,alpha);
 }`});
 const volume=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),material);volume.scale.set(g.width_km,top/1000*ex,g.depth_km);volume.position.y=top/2000*ex;volume.renderOrder=2;
 volume.onBeforeRender=()=>{
  if(volume.userData.transitionStart!==undefined){
   const f=Math.min(1,Math.max(0,(performance.now()-volume.userData.transitionStart)/700));uniforms.frameBlend.value=f*f*(3-2*f);
   if(f===1){volume.userData.previousTexture?.dispose();volume.userData.previousTexture=null;uniforms.previousVolume.value=volumeTexture;delete volume.userData.transitionStart;}
  }
  volume.updateMatrixWorld();uniforms.camLocal.value.copy(camera.position);volume.worldToLocal(uniforms.camLocal.value);};
 volume.userData.disposeTextures=()=>{if(!volume.userData.keepCurrentTexture)volumeTexture.dispose();if(--terrainEntry.users===0){groundTexture.dispose();cloudTerrainTextures.delete(terrainKey);}volume.userData.previousTexture?.dispose();volume.userData.previousTexture=null;};
 volume.userData.exaggeration=ex;
 volume.userData.cloudBounds={top,levels:layers.filter((_,i)=>chosen[i]).map(l=>l.level),verticalSamples:ny};
 return volume;
}

function blendCloudFrames(next,previous){
 const u=next.material.uniforms,currentTop=next.userData.cloudBounds.top,previousTop=previous.userData.cloudBounds.top;
 const boundTop=Math.max(currentTop,previousTop);
 const texture=previous.material.uniforms.volume.value;previous.userData.keepCurrentTexture=true;
 u.previousVolume.value=texture;u.frameBlend.value=0;u.currentHeightRatio.value=boundTop/currentTop;u.previousHeightRatio.value=boundTop/previousTop;
 u.physicalScale.value.y=boundTop/1000;next.scale.y=boundTop/1000*next.userData.exaggeration;next.position.y=next.scale.y/2;
 next.userData.previousTexture=texture;next.userData.transitionStart=performance.now();
}

// Display-only pressure smoothing: Gaussian sigma 0.7 grid cells, then 3x
// bilinear subdivision to reduce triangle faceting. Do not bridge missing data.
function contourPressureGrid(data){
 const src=data.grid,n=src.nx*src.ny,p=data.pressure,blur=new Float64Array(n);
 const kernel=[-2,-1,0,1,2].map(k=>Math.exp(-.5*(k/.7)**2));
 for(let y=0;y<src.ny;y++)for(let x=0;x<src.nx;x++){
  const i=y*src.nx+x;if(!src.valid[i]||p[i]===null){blur[i]=NaN;continue;}
  let sum=0,total=0;
  for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
   const xx=x+dx,yy=y+dy;if(xx<0||xx>=src.nx||yy<0||yy>=src.ny)continue;
   const j=yy*src.nx+xx;if(!src.valid[j]||p[j]===null)continue;
   const w=kernel[dx+2]*kernel[dy+2];sum+=p[j]*w;total+=w;
  }
  blur[i]=sum/total;
 }
 const subdivide=axis=>Array.from({length:(axis.length-1)*3+1},(_,k)=>{const j=Math.min(axis.length-2,Math.floor(k/3)),f=k/3-j;return axis[j]*(1-f)+axis[j+1]*f;});
 const x=subdivide(src.x),y=subdivide(src.y),nx=x.length,ny=y.length,values=[],valid=[];
 for(let yy=0;yy<ny;yy++)for(let xx=0;xx<nx;xx++){
  const ix=Math.min(src.nx-2,Math.floor(xx/3)),iy=Math.min(src.ny-2,Math.floor(yy/3)),fx=xx/3-ix,fy=yy/3-iy,a=iy*src.nx+ix;
  const ids=[a,a+1,a+src.nx,a+src.nx+1],weights=[(1-fx)*(1-fy),fx*(1-fy),(1-fx)*fy,fx*fy];
  let sum=0,ok=true;for(let k=0;k<4;k++){if(weights[k]<=1e-12)continue;if(!Number.isFinite(blur[ids[k]])){ok=false;break;}sum+=blur[ids[k]]*weights[k];}
  values.push(ok?sum:null);valid.push(ok?1:0);
 }
 return {grid:{...src,x,y,nx,ny,valid},pressure:values};
}
const contourPressureCache=new WeakMap();
function pressureForContours(data){if(!contourPressureCache.has(data))contourPressureCache.set(data,contourPressureGrid(data));return contourPressureCache.get(data);}

// Temperature colour is evaluated per fragment from the interpolated temperature.
// Wind retains its 30 km/h hue bands with gentle within-band intensity changes.
let surfaceField='terrain',atmosphere=null,atmosphereKey='',atmosphereRequest=0;
let pressureLines=null,pressureLabels=[],cloudMeshes=[];
const atmospherePending=new Map();
const atmosphereCache=new Map();
// ECMWF OpenCharts 2 m temperature legend, inspected 2026-11-15:
// https://charts.ecmwf.int/products/medium-2t-wind
// Interpolate its 4 C colour anchors continuously without contour overlays.
const temperatureStops=[
 [-48,'#00007f'],[-32,'#00007f'],[-28,'#0000d8'],[-24,'#3f00ff'],
 [-20,'#7f00ff'],[-16,'#007fff'],[-12,'#00ffff'],[-8,'#00ff7f'],
 [-4,'#7fff00'],[0,'#d9ff00'],[4,'#ffff00'],[8,'#fff500'],
 [12,'#ffd900'],[16,'#ffb000'],[20,'#ff7f00'],[24,'#ff4e00'],
 [28,'#ff2500'],[32,'#ff0900'],[36,'#ff0000'],[40,'#ff00ff'],[56,'#ff00ff']
].map(([t,c])=>[t,new THREE.Color(c)]);
// Preserve the existing wind hues; brighten gently through each 30 km/h band.
// The open-ended top band reaches full intensity at 150 km/h and stays there.
const windIntensityFloor=.65;
const windColourScratch=new THREE.Color();
function windIntensity(kmh){const band=windBand(kmh);return windIntensityFloor+(1-windIntensityFloor)*Math.min(1,Math.max(0,(kmh-band*30)/30));}
function windDisplayColour(kmh){return windColourScratch.copy(windColours[windBand(kmh)]).multiplyScalar(windIntensity(kmh));}
function windGradientStyle(i){return `linear-gradient(90deg in srgb-linear,${windColours[i].clone().multiplyScalar(windIntensityFloor).getStyle()},${windColours[i].getStyle()})`;}
// Update the trail legend to the same endpoints as the surface legend.
const trailLegendTitle=Array.from(document.querySelectorAll('#panel .sub')).find(e=>e.textContent==='Wind trails · km/h · thicker = faster');
if(trailLegendTitle)Array.from(trailLegendTitle.nextElementSibling.children).forEach((e,i)=>{e.style.background=windGradientStyle(i);});
const surfaceOpacityValues={rain:50,wind:20};
const surfaceUniforms={field:{value:0},surfaceOpacity:{value:.20}};
// A repeatable world-space texture stays attached to the forecast as the camera moves.
const noiseBytes=new Uint8Array(32**3);
let noiseState=83427;
for(let i=0;i<noiseBytes.length;i++){
 noiseState=(Math.imul(noiseState,1664525)+1013904223)>>>0;
 noiseBytes[i]=noiseState>>>24;
}
const detailNoise=new THREE.Data3DTexture(noiseBytes,32,32,32);
detailNoise.format=THREE.RedFormat;detailNoise.unpackAlignment=1;
detailNoise.wrapS=detailNoise.wrapT=detailNoise.wrapR=THREE.RepeatWrapping;
detailNoise.minFilter=detailNoise.magFilter=THREE.LinearFilter;detailNoise.needsUpdate=true;
const cloudUniforms={textured:{value:1},detailNoise:{value:detailNoise},threshold:{value:65},density:{value:.15}};
const originalColour=colour,originalUpdateHeight=updateHeight;
const originalMakeTerrain=makeTerrain;
const rainLegend=$('legend').innerHTML;
$('surfaceChoices').after($('legend'));
makeTerrain=function(){originalMakeTerrain();installSurfaceBands();colour();};
function installSurfaceBands(){
 const m=mesh.material;
 geo.setAttribute('weatherValue',new THREE.BufferAttribute(new Float32Array(T.height.length),1));
 m.onBeforeCompile=shader=>{
  shader.uniforms.surfaceField=surfaceUniforms.field;
  shader.uniforms.surfaceOpacity=surfaceUniforms.surfaceOpacity;
  shader.vertexShader='attribute float weatherValue; varying float fieldValue;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nfieldValue=weatherValue;');
  shader.fragmentShader='uniform float surfaceField; uniform float surfaceOpacity; varying float fieldValue;\n'+shader.fragmentShader;
  const vec=c=>`vec3(${c.toArray().map(x=>x.toFixed(8)).join(',')})`;
  let temp='vec3 band='+vec(temperatureStops[0][1])+';';
  for(let i=1;i<temperatureStops.length;i++){
   const [lo,lc]=temperatureStops[i-1],[hi,hc]=temperatureStops[i];
   temp+=`if(fieldValue>=${lo.toFixed(1)})band=mix(${vec(lc)},${vec(hc)},clamp((fieldValue-(${lo.toFixed(1)}))/${(hi-lo).toFixed(1)},0.0,1.0));`;
  }
  let wind='vec3 band='+vec(windColours[0])+';';
  windColours.slice(1).forEach((c,i)=>wind+=`if(fieldValue>=${((i+1)*30).toFixed(1)})band=${vec(c)};`);
  wind+=`float windIndex=clamp(floor(max(fieldValue,0.0)/30.0),0.0,4.0);band*=mix(${windIntensityFloor.toFixed(2)},1.0,clamp((fieldValue-windIndex*30.0)/30.0,0.0,1.0));`;
  shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>\nvec3 temperatureColour=vec3(0.0);if(surfaceField==1.0){${temp}temperatureColour=band;}else if(surfaceField==2.0){${wind}diffuseColor.rgb=mix(diffuseColor.rgb,band,surfaceOpacity);}`);
  // Keep the temperature scale saturated under the scene's bright lighting and
  // filmic tone mapping. Retain relief shading, capped at the palette colour.
  shader.fragmentShader=shader.fragmentShader.replace('#include <tonemapping_fragment>',`#include <tonemapping_fragment>
if(surfaceField==1.0){
 float relief=clamp(dot(outgoingLight,vec3(.2126,.7152,.0722))/max(dot(diffuseColor.rgb,vec3(.2126,.7152,.0722)),.001)*.55,.65,1.0);
 gl_FragColor.rgb=temperatureColour*relief;
}`);
 };
 m.needsUpdate=true;
}
colour=function(){
 originalColour();if(!geo||!T)return;
 const field=geo.attributes.weatherValue;
 surfaceUniforms.field.value=surfaceField==='temperature'?1:surfaceField==='wind'?2:0;
 if(field&&W&&(surfaceField==='temperature'||surfaceField==='wind')){for(let i=0;i<T.height.length;i++)field.array[i]=surfaceField==='temperature'?W.temperature[i]:Math.hypot(W.u[i],W.v[i])*3.6;field.needsUpdate=true;}
 updateFieldLegend();refreshAtmosphere();
};
updateHeight=function(){originalUpdateHeight();drawAtmosphere();};
$('surfaceOpacity').oninput=()=>{
 if(surfaceField!=='rain'&&surfaceField!=='wind')return;
 const value=Number($('surfaceOpacity').value);surfaceOpacityValues[surfaceField]=value;
 $('surfaceOpacityValue').textContent=value+'%';
 if(surfaceField==='rain'){rainColourOpacity=value/100;originalColour();}
 else surfaceUniforms.surfaceOpacity.value=value/100;
};
function updateFieldLegend(){
 const hasOpacity=surfaceField==='rain'||surfaceField==='wind';
 $('surfaceOpacityOptions').hidden=!hasOpacity;
 if(hasOpacity){
  $('surfaceOpacityName').textContent=surfaceField==='rain'?'Rain / snow opacity':'Wind colour opacity';
  $('surfaceOpacity').value=surfaceOpacityValues[surfaceField];
  $('surfaceOpacityValue').textContent=surfaceOpacityValues[surfaceField]+'%';
 }
 if(surfaceField==='rain'){$('legend').innerHTML=rainLegend;return;}
 const temp=surfaceField==='temperature',wind=surfaceField==='wind';
 if(!temp&&!wind){$('legend').innerHTML='<strong class="sub">Terrain elevation</strong>';return;}
 if(temp){
  const gradient=temperatureStops.map(([t,c])=>`${c.getStyle()} ${(t+48)/104*100}%`).join(',');
  $('legend').innerHTML='<strong class="sub">2 m air temperature · °C</strong>'+`<div style="height:16px;margin-top:8px;background:linear-gradient(90deg in srgb-linear,${gradient});border-radius:3px"></div>`+'<div class="sub" style="position:relative;height:18px"><span style="position:absolute;left:0">−48</span><span style="position:absolute;left:26.92%;transform:translateX(-50%)">−20</span><span style="position:absolute;left:46.15%;transform:translateX(-50%)">0</span><span style="position:absolute;left:65.38%;transform:translateX(-50%)">20</span><span style="position:absolute;right:0">56</span></div><div class="sub" style="margin-top:6px">ECMWF colours · smooth shading</div>';
  return;
 }
 const colours=['#fff3b0','#ffd12f','#ff851b','#ff334f','#e64dff'],labels=['0–30','30–60','60–90','90–120','≥ 120'];
 $('legend').innerHTML='<strong class="sub">10 m wind speed · km/h</strong><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(72px,1fr));gap:4px;margin-top:8px">'+colours.map((c,i)=>`<span class="sub" style="white-space:nowrap"><i style="display:inline-block;width:24px;height:12px;background:${windGradientStyle(i)};margin-right:4px"></i>${labels[i]}</span>`).join('')+'</div>';
}
$('surfaceChoices').onclick=e=>{const b=e.target.closest('[data-surface]');if(!b)return;surfaceField=b.dataset.surface;for(const c of $('surfaceChoices').children)c.setAttribute('aria-pressed',String(c===b));colour();};
const levelHeights={1000:'~0.1',925:'~0.8',850:'~1.5',700:'~3',600:'~4.2',500:'~5.5',400:'~7',300:'~9',250:'~10.5',200:'~12',150:'~13.5',100:'~16',50:'~20.5'};
for(const p of [1000,925,850,700,600,500,400,300,250,200,150,100,50]){const o=document.createElement('option');o.value=p;o.textContent=`${p} hPa · ${levelHeights[p]} km`; $('cloudLevel').append(o);}
$('cloudLevel').value='all';
$('pressureContours').onchange=refreshAtmosphere;
$('pressureClouds').onchange=()=>{$('cloudOptions').hidden=!$('pressureClouds').checked;refreshAtmosphere();};
$('cloudLevel').onchange=drawAtmosphere;
function updateCloudThreshold(){
 const middle=Number($('cloudThreshold').value);
 cloudUniforms.threshold.value=middle;
 $('cloudThresholdValue').textContent=middle+'%';
 $('cloudThresholdSummary').textContent=`Low ${Math.min(100,middle*1.2).toFixed(0)}% · Middle ${middle}% · High ${(middle*.8).toFixed(0)}%`;
}
$('cloudThreshold').oninput=updateCloudThreshold;
updateCloudThreshold();
$('cloudOpacity').oninput=()=>{cloudUniforms.density.value=Number($('cloudOpacity').value)/100;$('cloudOpacityValue').textContent=$('cloudOpacity').value+'%';};
function releaseClouds(clouds){for(const c of clouds){c.userData.disposeTextures?.();dispose(c);}}
function clearAtmosphere(){dispose(pressureLines);pressureLines=null;for(const p of pressureLabels)dispose(p);pressureLabels=[];releaseClouds(cloudMeshes);cloudMeshes=[];}
async function fetchAtmosphere(cycle,region,hour){
 const mode=$('cloudMode')?.value!=='humidity'?'cover':'hour';
 const key=cycle+':'+region+':'+hour+':'+mode;
 if(atmosphereCache.has(key))return atmosphereCache.get(key);
 if(atmospherePending.has(key))return atmospherePending.get(key);
 const version=pub.atmosphere_version;
 const request=json(`/atmosphere/${version}/${cycle}/${region}/${mode}-${String(hour).padStart(3,'0')}.json`).then(data=>{
  atmosphereCache.set(key,data);if(atmosphereCache.size>6)atmosphereCache.delete(atmosphereCache.keys().next().value);return data;
 }).finally(()=>atmospherePending.delete(key));
 atmospherePending.set(key,request);return request;
}
async function refreshAtmosphere(){
 if(!T||!W){clearAtmosphere();return;}
 const wanted=$('fallingRain').checked||$('fallingSnow').checked||$('pressureContours').checked||$('pressureClouds').checked;
 if(!wanted){++atmosphereRequest;clearAtmosphere();$('atmosphereStatus').textContent='';return;}
 if(!pub.atmosphere_version){clearAtmosphere();$('atmosphereStatus').textContent='Pressure and cloud layers are unavailable for this forecast.';return;}
 const key=pub.cycle+':'+$('region').value+':'+W.hour;
 if(key===atmosphereKey&&atmosphere){drawAtmosphere();return;}
 const sameRegion=atmosphereKey.split(':').slice(0,2).join(':')===key.split(':').slice(0,2).join(':');
 if(!sameRegion)clearAtmosphere();
 const request=++atmosphereRequest;$('atmosphereStatus').textContent=sameRegion?'Updating clouds…':'Loading pressure and cloud levels…';
 try{
  const data=await fetchAtmosphere(pub.cycle,$('region').value,W.hour);
  if(request!==atmosphereRequest)return;
  atmosphere=data;atmosphereKey=key;$('atmosphereStatus').textContent='';drawAtmosphere();
  const nextHour=data.hour+3;if(nextHour<=Number($('hours').max))fetchAtmosphere(pub.cycle,$('region').value,nextHour).catch(()=>{});
 }catch(e){if(request===atmosphereRequest){atmosphere=null;atmosphereKey='';clearAtmosphere();$('atmosphereStatus').textContent='Pressure / cloud data unavailable. Try switching the overlay off and on.';}}
}
const packedClouds=new WeakMap();let cloudBusy=false,refreshCloudAfter=false;
async function needPacked(data,level){
 if(cloudBusy){refreshCloudAfter=true;return;}
 cloudBusy=true;
 try{const value=await background('cloud',{data,selected:level,ny:72});packedClouds.set(data,{level,value});}
 catch(e){$('atmosphereStatus').textContent='Cloud rendering unavailable.';return;}
 finally{cloudBusy=false;}
 const rerun=refreshCloudAfter;refreshCloudAfter=false;
 if(rerun||data===atmosphere)drawAtmosphere();
}
function drawAtmosphere(){
 syncCloudExaggeration();
 if(!atmosphere||!W||atmosphereKey!==pub.cycle+':'+$('region').value+':'+W.hour)return;
 const level=$('cloudMode')?.value!=='humidity'?'cover':$('cloudLevel').value,packed=packedClouds.get(atmosphere);
 if($('pressureClouds').checked&&packed?.level!==level){needPacked(atmosphere,level);return;}
 const previousClouds=cloudMeshes;cloudMeshes=[];clearAtmosphere();
 const g=atmosphere.grid,ex=Number($('exaggeration').value);
 const pos=i=>[g.x[i%g.nx]*g.width_km,g.y[Math.floor(i/g.nx)]*g.depth_km];
 if($('pressureContours').checked){
  const contours=pressureForContours(atmosphere),g=contours.grid,p=contours.pressure;
  const pos=i=>[g.x[i%g.nx]*g.width_km,g.y[Math.floor(i/g.nx)]*g.depth_km];
  const points=[],labels=new Map();
  for(let y=0;y<g.ny-1;y++)for(let x=0;x<g.nx-1;x++){
   const a=y*g.nx+x;
   for(const tri of [[a,a+g.nx,a+1],[a+1,a+g.nx,a+g.nx+1]]){
    if(tri.some(i=>p[i]===null||!g.valid[i]))continue;
    const lo=Math.ceil(Math.min(...tri.map(i=>p[i]))/2)*2,hi=Math.max(...tri.map(i=>p[i]));
    for(let level=lo;level<=hi;level+=2){
     const cross=[];
     for(let edge=0;edge<3;edge++){const i=tri[edge],j=tri[(edge+1)%3];if((p[i]<level)===(p[j]<level))continue;const f=(level-p[i])/(p[j]-p[i]),a=pos(i),b=pos(j);cross.push([a[0]+f*(b[0]-a[0]),a[1]+f*(b[1]-a[1])]);}
     if(cross.length!==2)continue;
     const xyz=cross.map(([x,z])=>[x,height(x,z)+Math.max(.08,ex*.02),z]);if(xyz.flat().some(v=>!Number.isFinite(v)))continue;
     for(let step=0;step<5;step++){const ends=[step/5,(step+1)/5].map(f=>{const x=cross[0][0]+f*(cross[1][0]-cross[0][0]),z=cross[0][1]+f*(cross[1][1]-cross[0][1]);return [x,height(x,z)+Math.max(.08,ex*.02),z];});if(ends.flat().every(Number.isFinite))points.push(...ends.flat());}if(!labels.has(level)&&x>g.nx*.2&&x<g.nx*.8&&y>g.ny*.15&&y<g.ny*.85)labels.set(level,xyz[0]);
    }
   }
  }
  const geom=new THREE.BufferGeometry();geom.setAttribute('position',new THREE.Float32BufferAttribute(points,3));pressureLines=new THREE.LineSegments(geom,new THREE.LineBasicMaterial({color:(surfaceField==='temperature'||surfaceField==='wind')?'#182a41':'#f4f7fd',transparent:true,opacity:.9,depthTest:true}));scene.add(pressureLines);
  for(const [level,xyz] of labels){const c=document.createElement('canvas');c.width=128;c.height=48;const ctx=c.getContext('2d');ctx.fillStyle='#102031dd';ctx.fillRect(0,0,128,48);ctx.font='bold 32px system-ui';ctx.textAlign='center';ctx.fillStyle='white';ctx.fillText(level,64,35);const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;const s=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,depthTest:false,depthWrite:false,toneMapped:false}));s.renderOrder=1000;s.position.set(...xyz);// Sprite shader cancels perspective shrinkage; scale in CSS pixels.
   s.material.sizeAttenuation=false;
   s.frustumCulled=false;
   s.onBeforeRender=()=>{
    const unitsPerPixel=2*scenePixels/(renderer.domElement.clientHeight*camera.projectionMatrix.elements[5]);
    s.scale.set(44*unitsPerPixel,16.5*unitsPerPixel,1);
    s.updateMatrixWorld();
   };
   scene.add(s);pressureLabels.push(s);}
 }
 if($('pressureClouds').checked){
  const selected=$('cloudMode')?.value!=='humidity'?'cover':$('cloudLevel').value,cloudEx=cloudDisplayExaggeration(),context=pub.cycle+':'+$('region').value+':'+selected+':'+ex+':'+cloudEx;
  const previous=previousClouds[0];
  if(previous&&previous.userData.frameKey===atmosphereKey&&previous.userData.context===context&&previous.userData.terrainRef===T.height){cloudMeshes=previousClouds;return;}
  const cloud=makeCloudVolume(atmosphere,T,selected,cloudEx,packed.value);
  cloud.userData.context=context;cloud.userData.frameKey=atmosphereKey;cloud.userData.terrainRef=T.height;
  if(previous&&previous.userData.context===context&&previous.userData.terrainRef===T.height)blendCloudFrames(cloud,previous);
  scene.add(cloud);cloudMeshes.push(cloud);
 }
 releaseClouds(previousClouds);
}

if(mesh&&geo){installSurfaceBands();colour();}

$('viewerHelp').onclick=()=>$('viewerHelpDialog').showModal();

const helpBar=$('panel').querySelector('.panelDisclosure');
helpBar.style.gap='6px';helpBar.insertBefore($('viewerHelp'),helpBar.lastElementChild);

// Called by the render loop, also before this module's initial asynchronous load finishes.
var cityFlight,pausedFlight,flightSerial=0;
function offerResume(f){
 pausedFlight=f;
 for(const id of ['resumeOrbit','resumeClearOrbit'])$(id).hidden=!f;
}

function cancelCityFlight(){
 ++flightSerial;
 if(cityFlight){offerResume(cityFlight);$('placeSearchNote').textContent='Orbit paused. Choose Resume orbit to continue.';cityFlight=null;}
}
controls.addEventListener('start',cancelCityFlight);
for(const id of ['resetView','topDownView'])$(id).addEventListener('click',cancelCityFlight);
for(const id of ['region','detailTerrain','exaggeration'])$(id).addEventListener('input',cancelCityFlight);
const turnMs=800,approachMs=1800;
let circuitMs=60000,orbitKm=100,altitudeKm=60;
function setOrbitOptions(){
 altitudeKm=Number($('orbitHeight').value);orbitKm=Number($('orbitDistance').value);circuitMs=1000*Number($('orbitPeriod').value);
 $('heightRead').textContent=altitudeKm+' km';$('distanceRead').textContent=orbitKm+' km';$('periodRead').textContent=circuitMs/1000+' s';
}
for(const id of ['orbitHeight','orbitDistance','orbitPeriod'])$(id).oninput=setOrbitOptions;
$('region').addEventListener('change',()=>{cancelCityFlight();offerResume(null);$('orbitSettings').hidden=true;});
function resumeOrbit(){
 const f=pausedFlight;if(!f)return;f.stay=false;
 offerResume(null);overviewCamera=false;camera.clearViewOffset();f.ex=Number($('exaggeration').value);f.city.y=markerTerrainHeight(f.city.x,f.city.z);
 f.bearing=Math.atan2(camera.position.x-f.city.x,camera.position.z-f.city.z);f.start.copy(camera.position);f.resumeTarget=controls.target.clone();
 f.began=performance.now()-turnMs;f.approachDuration=900;f.stage='approach';f.lastOrbit=null;cityFlight=f;
 $('placeSearchNote').textContent='Resuming orbit around '+f.name+'…';
}
$('resumeOrbit').onclick=$('resumeClearOrbit').onclick=resumeOrbit;
function orbitEye(out,city,bearing,ex){
 const x=city.x+orbitKm*Math.sin(bearing),z=city.z+orbitKm*Math.cos(bearing);
 return out.set(x,altitudeKm*ex,z);
}
const easeFlight=t=>t*t*(3-2*t);
function advanceCityFlight(now){
 const f=cityFlight;if(!f)return false;
 const elapsed=Math.max(0,now-f.began);
 if(elapsed<turnMs){
  // Shortest horizontal turn with a level horizon, pivoting in place.
  const u=easeFlight(elapsed/turnMs),a=f.yaw+u*f.turn,b=THREE.MathUtils.lerp(f.pitch,f.endPitch,u);
  controls.target.set(Math.sin(a)*Math.cos(b),Math.sin(b),Math.cos(a)*Math.cos(b)).multiplyScalar(THREE.MathUtils.lerp(f.distance,f.endDistance,u)).add(f.start);
  camera.position.copy(f.start);
  if(f.offset)camera.setViewOffset(innerWidth,innerHeight,f.offset.x*(1-u),f.offset.y*(1-u),innerWidth,innerHeight);
 }else{
  if(f.stage==='turn'){camera.clearViewOffset();f.stage='approach';$('placeSearchNote').textContent='Flying towards '+f.name+'…';}
  controls.target.copy(f.city);
  if(elapsed<turnMs+f.approachDuration){
   const u=easeFlight((elapsed-turnMs)/f.approachDuration);
   if(f.resumeTarget)controls.target.lerpVectors(f.resumeTarget,f.city,u);
   camera.position.lerpVectors(f.start,orbitEye(f.eye,f.city,f.bearing,f.ex),u);
   const ground=markerTerrainHeight(camera.position.x,camera.position.z);
   if(Number.isFinite(ground))camera.position.y=Math.max(camera.position.y,ground+f.ex*.2);
  }else{
   if(f.stay){f.stage='stay';orbitEye(camera.position,f.city,f.bearing,f.ex);camera.lookAt(controls.target);controls.update();offerResume(f);cityFlight=null;$('placeSearchNote').textContent='At '+f.name+'. Choose Start orbit to circle.';return true;}
   const delta=now-(f.lastOrbit??(f.began+turnMs+f.approachDuration));f.lastOrbit=now;
   f.bearing=(f.bearing+Math.max(0,delta)*2*Math.PI/circuitMs)%(2*Math.PI);
   const a=f.bearing;
   orbitEye(camera.position,f.city,a,f.ex);
   if(f.stage!=='orbit'){$('placeSearchNote').textContent='Circling '+f.name+'. Drag to take control.';f.stage='orbit';}
  }
 }
 camera.lookAt(controls.target);return true;
}
function flyToCity(place,stay=false){
 const note=$('placeSearchNote');
 if(!T||!W||loading){note.textContent='Please wait for the forecast to load.';return;}
 if(!placeInRegion(place,T.bounds)){note.textContent=place[0]+' is outside this region. Choose a region containing it to fly there.';return;}
 const [x,z]=xy(place[1],place[2]),floor=markerTerrainHeight(x,z),ex=Number($('exaggeration').value);
 if(!Number.isFinite(floor)){note.textContent='No terrain available at '+place[0]+'.';return;}
 cancelCityFlight();choosePlace(place);overviewCamera=false;offerResume(null);$('orbitSettings').hidden=false;$('orbitCity').textContent=place[0]+' orbit';
 const start=camera.position.clone(),city=new THREE.Vector3(x,floor,z),dir=camera.getWorldDirection(new THREE.Vector3()),to=city.clone().sub(start),endDistance=to.length();to.normalize();
 const yaw=Math.atan2(dir.x,dir.z),delta=Math.atan2(to.x,to.z)-yaw,bearing=stay?0:Math.atan2(start.x-x,start.z-z);
 const eye=orbitEye(new THREE.Vector3(),city,bearing,ex);
 cityFlight={stay,name:place[0],approachDuration:approachMs,lastOrbit:null,city,start,eye,ex,bearing,yaw,turn:Math.atan2(Math.sin(delta),Math.cos(delta)),pitch:Math.asin(THREE.MathUtils.clamp(dir.y,-1,1)),endPitch:Math.asin(THREE.MathUtils.clamp(to.y,-1,1)),distance:Math.max(.25,controls.target.distanceTo(start)),endDistance,offset:camera.view?.enabled?{x:camera.view.offsetX,y:camera.view.offsetY}:null,began:performance.now(),stage:'turn'};
 if(matchMedia('(prefers-reduced-motion: reduce)').matches){camera.clearViewOffset();controls.target.copy(city);camera.position.copy(eye);controls.update();offerResume(cityFlight);cityFlight=null;note.textContent='Stationary view (reduced motion). Choose Resume orbit to circle.';return;}
 note.textContent='Turning towards '+place[0]+'…';
}

// Fixed geographic bounds. Tile vertices at every level share one sampling grid.
const terrainGrids={west:[96,5],nz:[136,7],north:[84,6],east:[132,5],otaki:[88,5],alps:[102,6]};
function regionalTerrain() {
 const cache=new Map(),visible=new Map();
 let cells,side,depth,tileCount,region,lookup,westCoast,westLoading=false,retryWest=0;
 const compact=matchMedia('(pointer:coarse)').matches;
 const maxLeaves=compact?28:46;
 let terrain, material, rainMap, fieldMap, lastColour=-1, lastField=-1;
 let lastPlan=-Infinity, jobs=0, enabled=false, failed=false, scale=1;
 const frustum=new THREE.Frustum(), projection=new THREE.Matrix4();
 const sea=new THREE.Color('#102f42');
 const parentGround=markerTerrainHeight;
 function dataMap(){
  const tex=new THREE.DataTexture(new Uint8Array(T.nx*T.ny*4),T.nx,T.ny);
  tex.magFilter=tex.minFilter=THREE.LinearFilter;tex.needsUpdate=true;
  return tex;
 }
 function setup(){
  terrain=T;region=$('region').value;[cells,depth]=terrainGrids[region];
  side=cells+1;tileCount=2**depth;lookup=new Array(tileCount*tileCount);rainMap=dataMap();fieldMap=dataMap();
  material=mesh.material.clone();
  material.customProgramCacheKey=()=> 'adaptive-terrain-'+region;
  material.onBeforeCompile=function(sh){
   mesh.material.onBeforeCompile(sh);
   Object.assign(sh.uniforms,{rainMap:{value:rainMap},fieldMap:{value:fieldMap},coast:{value:this.coastTexture||westCoast},coastTransform:{value:this.coastTransform},sea:{value:sea}});
   sh.uniforms.shapeBlend={value:1};this.userData.shapeBlend=sh.uniforms.shapeBlend;
   sh.vertexShader='attribute float parentDelta;uniform float shapeBlend;varying vec2 regionUV;\n'+sh.vertexShader.replace('fieldValue=weatherValue;','regionUV=uv; transformed.y+=parentDelta*(1.0-shapeBlend);');
   sh.fragmentShader='varying vec2 regionUV;uniform vec4 coastTransform;uniform sampler2D rainMap,fieldMap,coast;uniform vec3 sea;\n'+sh.fragmentShader;
   const code=`vec2 grid=(regionUV*vec2(${T.nx-1}.0,${T.ny-1}.0)+0.5)/vec2(${T.nx}.0,${T.ny}.0);
    vec4 rain=texture2D(rainMap,grid); vec2 val=texture2D(fieldMap,grid).rg;
    float localField=val.r*255.0+val.g-100.0;
    diffuseColor.rgb=mix(sea,diffuseColor.rgb,texture2D(coast,regionUV*coastTransform.xy+coastTransform.zw).r)*rain.a+rain.rgb;`;
   sh.fragmentShader=sh.fragmentShader.replaceAll('fieldValue','localField').replace('varying float localField;','').replace('#include <color_fragment>','#include <color_fragment>\n'+code);
  };
  material.defines={...material.defines,USE_UV:''};
  lastColour=lastField=-1;
 }
 function weather(){
  const c=geo.attributes.color,f=geo.attributes.weatherValue;
  if(c.version===lastColour&&f.version===lastField)return;
  const rain=rainMap.image.data,field=fieldMap.image.data;
  for(let k=0;k<T.height.length;k++){
   const weight=surfaceField==='rain'&&W&&displayPrecip()[k]>=.1?1-rainColourOpacity:1;
   for(let ch=0;ch<3;ch++)rain[4*k+ch]=Math.round(255*Math.max(0,c.array[3*k+ch]-baseSurface[3*k+ch]*weight));
   rain[4*k+3]=Math.round(255*weight);
   const v=Math.min(255,Math.max(0,f.array[k]+100));
   field[4*k]=Math.floor(v);field[4*k+1]=Math.round((v%1)*255);
  }
  rainMap.needsUpdate=fieldMap.needsUpdate=true;lastColour=c.version;lastField=f.version;
 }
 function node(level,x,y){
  const key=level+'/'+x+'-'+y;
  if(cache.has(key))return cache.get(key);
  const count=2**level,w=T.width_km/count,d=T.depth_km/count;
  const t={key,level,x,y,w,d,left:x*w-T.width_km/2,top:y*d-T.depth_km/2,used:performance.now()};
  t.box=new THREE.Box3(new THREE.Vector3(t.left,0,t.top),new THREE.Vector3(t.left+w,4*scale,t.top+d));
  cache.set(key,t);return t;
 }
 function makeMesh(t,h){
  const size=h.length?cells:1, n=size+1,verts=[],uv=[],col=[],idx=[],delta=[];
  const parent=t.level?cache.get((t.level-1)+'/'+(t.x>>1)+'-'+(t.y>>1)):null;
  function add(x,y){
   const m=h.length?h[y*side+x]:0;
   verts.push(t.left+t.w*x/size,m/1000,t.top+t.d*y/size);
   delta.push(x>0&&x<size&&y>0&&y<size&&parent?.h?(sampleTile(parent,verts[verts.length-3],verts[verts.length-1],false)/scale-m/1000):0);
   uv.push((t.x+x/size)/2**t.level,(t.y+y/size)/2**t.level);
   const colour=ramp(m,terrainStops);col.push(colour.r,colour.g,colour.b);
  }
  for(let y=0;y<n;y++)for(let x=0;x<n;x++)add(x,y);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){const a=y*n+x;idx.push(a,a+n,a+1,a+1,a+n,a+n+1);}
  const g=new THREE.BufferGeometry();g.setIndex(idx);
  for(const [attr,values,k] of [['position',verts,3],['uv',uv,2],['color',col,3],['parentDelta',delta,1]])g.setAttribute(attr,new THREE.Float32BufferAttribute(values,k));
  g.computeVertexNormals();const tileMaterial=material.clone();
  tileMaterial.customProgramCacheKey=material.customProgramCacheKey;
  tileMaterial.onBeforeCompile=material.onBeforeCompile;
  tileMaterial.coastTexture=t.mask||westCoast;
  const factor=2**t.level;
  tileMaterial.coastTransform=t.mask?new THREE.Vector4(factor,factor,-t.x,-t.y):new THREE.Vector4(1,-1,0,1);
  const obj=new THREE.Mesh(g,tileMaterial);obj.scale.y=scale;
  obj.onBeforeRender=()=>{if(tileMaterial.userData.shapeBlend)tileMaterial.userData.shapeBlend.value=t.blend??1;};
  return obj;
 }
 async function load(t){
  if(t.object||t.busy||jobs>=3||performance.now()<(t.retry||0))return;
  jobs++;t.busy=true;
  try{
   const west=region==='west';
   const base=west?'west-v1':'adaptive-v1/'+region;
   const res=await fetch('/terrain-assets/'+base+'/tiles/'+t.key+'.bin');if(!res.ok)throw Error(res.status);
   const bytes=await res.arrayBuffer();
   if(cache.get(t.key)!==t)return;
   const offset=west||!bytes.byteLength?0:2048;
   if(bytes.byteLength!==offset&&bytes.byteLength!==offset+2*side*side)throw Error('incomplete tile');
   const h=new Int16Array(bytes,offset);
   if(!west){
    const bits=new Uint8Array(bytes,0,offset),pixels=new Uint8Array(offset?128*128:1);
    for(let i=0;i<bits.length;i++)for(let j=0;j<8;j++)pixels[i*8+j]=(bits[i]&(128>>j))?255:0;
    t.mask=new THREE.DataTexture(pixels,offset?128:1,offset?128:1,THREE.RedFormat);
    t.mask.magFilter=t.mask.minFilter=THREE.LinearFilter;t.mask.needsUpdate=true;
   }
   t.h=h;t.object=makeMesh(t,h);failed=false;
  }catch{t.retry=performance.now()+5000;failed=true;}
  finally{jobs--;t.busy=false;lastPlan=-Infinity;}
 }
 function sampleTile(t,x,z,blend=true){
  if(!t.h.length)return 0;
  const fx=Math.max(0,Math.min(cells,(x-t.left)/t.w*cells)),fy=Math.max(0,Math.min(cells,(z-t.top)/t.d*cells));
  const i=Math.min(cells-1,Math.floor(fx)),j=Math.min(cells-1,Math.floor(fy)),a=fx-i,b=fy-j,k=j*side+i;
  const attributes=t.object.geometry.attributes;
  const morph=blend?1-(t.blend??1):0;
  const hAt=index=>attributes.position.getY(index)+morph*attributes.parentDelta.getX(index);
  return scale*(a+b<=1?hAt(k)*(1-a-b)+hAt(k+1)*a+hAt(k+side)*b:
   hAt(k+1)*(1-b)+hAt(k+side)*(1-a)+hAt(k+side+1)*(a+b-1));
 }
 // Match each fine edge to the coarsest visible surface touching that vertex.
 // Work coarse-to-fine so corners shared by three resolutions also coincide.
 function stitchEdges(leaves){
  for(const t of [...leaves.values()].sort((a,b)=>a.level-b.level)){
   if(!t.h.length)continue;
   const pos=t.object.geometry.attributes.position,span=tileCount>>t.level;
   let edited=false;
   function edge(x,y){
    const u=t.x*span+x*span/cells,v=t.y*span+y*span/cells;
    let owner=t;
    for(let j=Math.max(0,Math.ceil(v)-1);j<=Math.min(tileCount-1,Math.floor(v));j++){
     for(let i=Math.max(0,Math.ceil(u)-1);i<=Math.min(tileCount-1,Math.floor(u));i++){
      const neighbor=lookup[j*tileCount+i];
      if(neighbor.level<owner.level)owner=neighbor;
     }
    }
    const k=y*side+x;
    const h=Math.fround(owner===t?t.h[k]/1000:sampleTile(owner,pos.getX(k),pos.getZ(k),false)/scale);
    if(pos.getY(k)!==h){pos.setY(k,h);edited=true;}
   }
   for(let i=0;i<=cells;i++){
    edge(i,0);edge(i,cells);
    if(i>0&&i<cells){edge(0,i);edge(cells,i);}
   }
   if(edited){pos.needsUpdate=true;t.object.geometry.computeVertexNormals();}
  }
 }

 function ground(x,z){
  if(!enabled||terrain!==T||!visible.size)return parentGround(x,z);
  const u=x/T.width_km+.5,v=z/T.depth_km+.5;if(u<0||u>1||v<0||v>1)return NaN;
  const t=lookup[Math.min(tileCount-1,Math.floor(v*tileCount))*tileCount+Math.min(tileCount-1,Math.floor(u*tileCount))];if(t)return sampleTile(t,x,z);
  return parentGround(x,z);
 }
 function score(t){
  t.box.max.y=4*scale;
  if(t.level===depth||!frustum.intersectsBox(t.box))return 0;
  return Math.max(t.w,t.d)/cells*renderer.domElement.clientHeight*camera.projectionMatrix.elements[5]/(2*Math.max(.05,t.box.distanceToPoint(camera.position)));
 }
 function invalidate(){
  if(particles)for(const particle of particles)for(const pt of particle.history)pt[1]=trailHeight(pt[0],pt[2]);
  for(const l of groundTownLabels)l.terrain=null;
  markerVisibilityTime=-Infinity;updateSelectionDot();
  for(const f of [cityFlight,pausedFlight])if(f)f.city.y=ground(f.city.x,f.city.z);
  if(pressureLines){const p=pressureLines.geometry.attributes.position;for(let i=0;i<p.count;i++)p.setY(i,ground(p.getX(i),p.getZ(i))+Math.max(.08,scale*.02));p.needsUpdate=true;
   for(const l of pressureLabels)l.position.y=ground(l.position.x,l.position.z)+Math.max(.08,scale*.02);}
 }
 function plan(now){
  camera.updateMatrixWorld();frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
  const root=node(0,0,0);if(!root.object){load(root);return;}
  const former=new Map(visible);
  const leaves=new Map([[root.key,root]]),queue=[{t:root,s:score(root)}];
  while(queue.length&&leaves.size+3<=maxLeaves){
   queue.sort((a,b)=>a.s-b.s);const {t,s}=queue.pop();if(s<3.2)break; if(t.parent&&t.blend<1)continue;
   const kids=[];
   for(let j=0;j<2;j++)for(let i=0;i<2;i++){const child=node(t.level+1,t.x*2+i,t.y*2+j);child.used=now;kids.push(child);if(!child.object)load(child);}
   if(kids.some(k=>!k.object))continue;
   leaves.delete(t.key);for(const k of kids){leaves.set(k.key,k);queue.push({t:k,s:score(k)});}
  }
  let changed=false;
  for(const [key,t] of visible)if(!leaves.has(key)){scene.remove(t.object);visible.delete(key);changed=true;}
  for(const [key,t] of leaves){t.used=now;if(!visible.has(key)){
    const parent=former.get((t.level-1)+'/'+(t.x>>1)+'-'+(t.y>>1));
    t.parent=parent;t.start=parent?now:0;t.blend=parent?0:1;
    scene.add(t.object);visible.set(key,t);changed=true;}}
  mesh.visible=false;
  if(changed){
   for(const t of leaves.values()){
    const span=tileCount>>t.level;
    for(let j=t.y*span;j<(t.y+1)*span;j++)lookup.fill(t,j*tileCount+t.x*span,j*tileCount+(t.x+1)*span);
   }
   stitchEdges(leaves);
   invalidate();
  }
  if(cache.size>maxLeaves*2){
   for(const t of [...cache.values()].sort((a,b)=>a.used-b.used)){
    if(cache.size<=maxLeaves*2||now-t.used<1000)break;
    if(t.level&&!visible.has(t.key)&&!t.busy){t.object?.geometry.dispose();t.object?.material.dispose();t.mask?.dispose();cache.delete(t.key);}
   }
  }
  const finest=Math.max(0,...Array.from(leaves.values(),t=>frustum.intersectsBox(t.box)?t.level:0));
  $('tileStatus').textContent='Copernicus terrain · finest visible grid ≈ '+Math.round(Math.max(T.depth_km,T.width_km)*1000/(cells*2**finest))+' m'+(failed?' · retrying tile':'');
 }
 function update(){
  if(loading&&!W)return;
  const west=$('region').value==='west';
  if(west&&!westCoast&&!westLoading&&Date.now()>=retryWest&&$('detailTerrain').checked){
   westLoading=true;
   new THREE.TextureLoader().loadAsync('/terrain-assets/west-v1/coast.png').then(texture=>{
    westCoast=texture;texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
   }).catch(()=>{retryWest=Date.now()+30000;}).finally(()=>{westLoading=false;});
  }
  const active=T&&(!west||westCoast)&&$('detailTerrain').checked;
  if(!active||terrain!==T){
   if(terrain&&(!active||terrain!==T)){for(const t of visible.values())scene.remove(t.object);visible.clear();for(const t of cache.values()){t.object?.geometry.dispose();t.object?.material.dispose();t.mask?.dispose();}cache.clear();material.dispose();rainMap.dispose();fieldMap.dispose();terrain=null;enabled=false;if(mesh)mesh.visible=true;invalidate();}
   $('tileStatus').hidden=!active;
   if(!active)return;
   setup();lastPlan=-Infinity;
  }
  enabled=true;scale=Number($('exaggeration').value);
  let settled=false;
  for(const t of visible.values()){
   t.object.scale.y=scale;
   if(t.parent){t.blend=Math.min(1,(performance.now()-t.start)/240);if(t.blend===1){t.parent=null;settled=true;}}
  }
  if(settled)invalidate();
  weather();const now=performance.now();if(now-lastPlan>170){lastPlan=now;plan(now);}
 }
 const oldOccluded=markerOccluded;
 markerOccluded=function(p){
  if(!enabled||terrain!==T||!visible.size)return oldOccluded(p);
  const eye=camera.position,dx=p.x-eye.x,dz=p.z-eye.z,dy=p.y-eye.y;
  // Check every crossed grid edge and triangle diagonal within each active tile.
  for(const t of visible.values()){
   if(!t.h.length)continue;
   let a=0,b=1;
   for(const [o,d,min,max] of [[eye.x,dx,t.left,t.left+t.w],[eye.z,dz,t.top,t.top+t.d]]){
    if(!d){if(o<min||o>max)b=-1;}else{const i=(min-o)/d,j=(max-o)/d;a=Math.max(a,Math.min(i,j));b=Math.min(b,Math.max(i,j));}
   }
   if(a>=b)continue;
   const blocked=f=>sampleTile(t,eye.x+dx*f,eye.z+dz*f)>eye.y+dy*f+.005;
   if(blocked(a)||blocked(b))return true;
   const x=(eye.x-t.left)*cells/t.w,z=(eye.z-t.top)*cells/t.d,vx=dx*cells/t.w,vz=dz*cells/t.d;
   for(const [o,d] of [[x,vx],[z,vz],[x+z,vx+vz]]){
    const lo=o+d*a,hi=o+d*b;
    for(let k=Math.ceil(Math.min(lo,hi));d&&k<=Math.max(lo,hi);k++)if(blocked((k-o)/d))return true;
   }
  }
  return false;
 };
 const oldHeight=height;
 height=(x,z)=>enabled?ground(x,z):oldHeight(x,z);
 markerTerrainHeight=ground;
 const oldTrail=trailHeight;
 trailHeight=(x,z)=>enabled?ground(x,z)+.01*scale:oldTrail(x,z);
 return {update,surfaces:()=>enabled&&visible.size?Array.from(visible.values(),t=>t.object):[mesh]};
}
regional=regionalTerrain();

function cloudSwitches(){
  const slider=$('cloudOpacity');slider.disabled=false;
  slider.oninput();cloudUniforms.textured.value=+$('textureCloud').checked;
 }
 $('textureCloud').onchange=cloudSwitches;
 cloudSwitches();
 $('fallingRain').onchange=$('fallingSnow').onchange=refreshAtmosphere;

// Regional forecast data supplies intensity and phase. A cached diagnosed base
// is independent of the cloud display controls and their humidity thresholds.
let baseSource=null,bases=null;
function updateBases(data){
 if(baseSource===data)return;
 const defaultMiddle=Number($('cloudThreshold').defaultValue);
 baseSource=data;const {grid,layers}=data;bases=new Float32Array(grid.nx*grid.ny);bases.fill(NaN);
 for(let i=0;i<bases.length;i++){
  for(let k=0;k<layers.length;k++){
   const l=layers[k],h=l.height[i];if(h==null||l.rh[i]==null||l.rh[i]<scaledCloudThreshold(cloudBaseThreshold(l.level),defaultMiddle))continue;
   const below=layers[k-1]?.height[i],above=layers[k+1]?.height[i];
   bases[i]=Math.max(0,below!=null?(h+below)/2000:(h-(above!=null?(above-h)*.5:300))/1000);break;
  }
 }
}
function axisCell(axis,v){
 let lo=0,hi=axis.length-1;
 while(hi-lo>1){const mid=(lo+hi)>>1;if(axis[mid]<=v)lo=mid;else hi=mid;}
 return [lo,Math.max(0,Math.min(1,(v-axis[lo])/(axis[hi]-axis[lo])))];
}
function baseAt(x,z,floor){
 if(!baseSource)return floor+1;
 const g=baseSource.grid,[i,a]=axisCell(g.x,x/T.width_km),[j,b]=axisCell(g.y,z/T.depth_km);
 let sum=0,weight=0;
 for(let y=0;y<2;y++)for(let k=0;k<2;k++){
  const v=bases[(j+y)*g.nx+i+k],w=(k?a:1-a)*(y?b:1-b);
  if(Number.isFinite(v)){sum+=w*v;weight+=w;}
 }
 return weight>.01?Math.max(floor+.06,sum/weight):floor+1;
}

// Prime the initial frame too; subsequent frames load both fields together.
prepareRain=async(cycle,region,hour)=>pub.atmosphere_version
 ? fetchAtmosphere(cycle,region,hour).catch(()=>null) : null;
if(W){
 const initial=W,data=await prepareRain(pub.cycle,$('region').value,initial.hour);
 if(data && W===initial){filterLightRain(data,W);originalColour();}
}
$('cloudThreshold').addEventListener('input',()=>{
 if(rainFilterWeather===W && W){
  filterLightRain(rainFilterSource,W);
  if(surfaceField==='rain')originalColour();
 }
});

// Use physical DEM elevation (km ASL), independent of vertical exaggeration.
function groundSnowShare(x,z,ground,rate){
 if(!(rate>=.1)||!W.snow_water||!W.snow_level)return 0;
 const snow=sample(W.snow_water,x,z);
 if(!(snow>=.05)||!isSnow(ground*1000,sample(W.snow_level,x,z)))return 0;
 return Math.min(1,snow/rate);
}

function precipitationDensity(rate){
 if(rate<=1)return .03+.097*Math.max(0,rate);
 if(rate<=4)return .127+(rate-1)*(.627-.127)/3;
 return .627+(Math.min(10,rate)-4)*(1-.627)/6;
}
const maxParticleHeightKm=.5;
const particleScale=6;
const overhead={value:0}; const distanceEmphasis={value:0};

function snowLayer(max){
 const position=new THREE.BufferAttribute(new Float32Array(max*3),3).setUsage(THREE.DynamicDrawUsage);
 const opacity=new THREE.BufferAttribute(new Float32Array(max),1).setUsage(THREE.DynamicDrawUsage);
 const flakeSize=new THREE.BufferAttribute(new Float32Array(max),1).setUsage(THREE.DynamicDrawUsage);
 const g=new THREE.BufferGeometry();g.setAttribute('flakeSize',flakeSize);g.setAttribute('position',position);g.setAttribute('strength',opacity);
 const mat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{pixelRatio:{value:1},distanceEmphasis},
  vertexShader:`attribute float flakeSize,strength;uniform float pixelRatio,distanceEmphasis;varying float a;
   void main(){vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;
   gl_PointSize=${particleScale.toFixed(1)}*flakeSize*pixelRatio*clamp(1.6+14./max(1.,-mv.z),1.6,6.);a=min(1.,strength*(1.+.6*distanceEmphasis));}`,
  fragmentShader:`varying float a;void main(){vec2 p=gl_PointCoord-.5;
   float angle=atan(p.y,p.x+.00001);
   float r=length(p)*(1.08+.16*cos(6.*angle));
   float shadow=smoothstep(.23,.41,r)*smoothstep(-.18,.22,p.x+p.y);
   vec3 flake=mix(vec3(1.),vec3(.33,.40,.45),shadow);
   gl_FragColor=vec4(flake,a*(1.-smoothstep(.36,.48,r)));}`});
 const obj=new THREE.Points(g,mat);
 obj.frustumCulled=false;obj.renderOrder=1;scene.add(obj);g.setDrawRange(0,0);
 return {obj,g,mat,position,opacity,flakeSize};
}
function rainLayer(max){
 const g=new THREE.InstancedBufferGeometry();
 g.setAttribute('position',new THREE.Float32BufferAttribute([0,-1,0,1,-1,0,0,1,0,1,1,0],3));
 g.setIndex([0,1,2,2,1,3]);
 function attribute(name,size){
  const attr=new THREE.InstancedBufferAttribute(new Float32Array(max*size),size).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute(name,attr);return attr;
 }
 const head=attribute('head',3),tail=attribute('tail',3),opacity=attribute('strength',1);
 const widthScale=attribute('widthScale',1);
 const viewport=new THREE.Vector2();
 const screenScale={value:1},lengthScale={value:1};
 const mat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,uniforms:{viewport:{value:viewport},screenScale,lengthScale,distanceEmphasis,overhead},
 vertexShader:`attribute vec3 head,tail;attribute float strength,widthScale;uniform vec2 viewport;uniform float screenScale,lengthScale,distanceEmphasis,overhead;varying float a,edge,along,headDistance;
 void main(){
  vec4 h=projectionMatrix*modelViewMatrix*vec4(head,1.),t=projectionMatrix*modelViewMatrix*vec4(tail,1.);
  a=strength*mix(1.,.22+.18*distanceEmphasis,position.x);edge=position.y;along=position.x;
  if(min(h.w,t.w)<=0.){gl_Position=vec4(2.,2.,2.,1.);return;}
  vec2 d=(t.xy/t.w-h.xy/h.w)*viewport;
  vec2 normal=vec2(-d.y,d.x)/max(.00001,length(d));
  gl_Position=mix(h,t,position.x);
  // At oblique regional scales, give the projected tail a legible screen length.
  // Its head stays anchored to the simulated drop above the local relief.
  vec2 direction=d/max(.00001,length(d));
  float extra=max(0.,84.*widthScale-length(d));
  gl_Position.xy+=position.x*direction*(screenScale*lengthScale*distanceEmphasis*extra+(screenScale*lengthScale-1.)*length(d))/viewport*gl_Position.w;
  float radius=1.2*widthScale*screenScale*(1.+2.25*distanceEmphasis)*${particleScale.toFixed(1)};
  float streakLength=lengthScale*screenScale*(length(d)+distanceEmphasis*extra);
  headDistance=position.x*max(2.,streakLength/max(.001,radius));
  gl_Position.xy+=normal*edge*radius/viewport*gl_Position.w;
  // Keep the round head aligned with the projected streak while blending.
  vec2 axis=length(d)>.00001?direction:vec2(1.,0.);
  vec2 across=vec2(-axis.y,axis.x);
  vec2 dotOffset=(axis*(2.*along-1.)+across*edge)*radius*2./viewport;
  gl_Position=mix(gl_Position,vec4(h.xy+dotOffset*h.w,h.zw),overhead);
  a=mix(a,strength,overhead);
 }`,fragmentShader:`uniform float distanceEmphasis,overhead;varying float a,edge,along,headDistance;void main(){
  // The leading tip stays at the simulated head. Round the cap inside the streak.
  float taper=1.-.72*distanceEmphasis*smoothstep(0.,1.,along);
  float outline=length(vec2(edge/taper,max(0.,1.-headDistance)));
  outline=mix(outline,length(vec2(2.*along-1.,edge)),overhead);
  vec3 distant=mix(vec3(.71,.87,1.),vec3(.17,.32,.49),smoothstep(.05,.8,edge));
  gl_FragColor=vec4(mix(vec3(.55,.77,.94),distant,distanceEmphasis),min(1.,a*(1.+distanceEmphasis))*(1.-smoothstep(.75,1.,outline)));
 }`});
 const obj=new THREE.Mesh(g,mat);
 obj.frustumCulled=false;obj.renderOrder=1;g.instanceCount=0;scene.add(obj);
 return {obj,g,head,tail,opacity,widthScale,viewport,screenScale,lengthScale};
}
// Distant precipitation is unresolved. Overlapping translucent columns show
// the footprint, while the near field uses streaks and flakes.
function shaftLayer(){
 const n=17,verts=n*n*4,g=new THREE.BufferGeometry();
 const pos=new THREE.BufferAttribute(new Float32Array(verts*3),3);
 const shade=new THREE.BufferAttribute(new Float32Array(verts*2),2);
 const uv=[],idx=[];
 for(let i=0;i<n*n;i++){uv.push(0,0,1,0,0,1,1,1);const k=i*4;idx.push(k,k+2,k+1,k+1,k+2,k+3);}
 g.setIndex(idx);g.setAttribute('position',pos);g.setAttribute('shaft',shade);g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
 const material=new THREE.ShaderMaterial({transparent:true,side:THREE.DoubleSide,depthWrite:false,
 vertexShader:`attribute vec2 shaft;varying vec2 vUV,params;void main(){vUV=uv;params=shaft;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
 fragmentShader:`varying vec2 vUV,params;void main(){float profile=sin(3.14159*vUV.x);float a=params.x*profile*profile*smoothstep(0.,.13,vUV.y)*(1.-smoothstep(.78,1.,vUV.y));gl_FragColor=vec4(mix(vec3(.42,.56,.68),vec3(.85,.92,.98),params.y),a);}`});
 const mesh=new THREE.Mesh(g,material);mesh.frustumCulled=false;mesh.renderOrder=1;scene.add(mesh);
 let next=0;
 return active=>{
  mesh.visible=active;if(!active||performance.now()<next)return;next=performance.now()+180;
  const ex=Number($('exaggeration').value),axis=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0);
  const stride=3,cx=Math.round(controls.target.x/stride),cz=Math.round(controls.target.z/stride);let out=0;
  const jitter=(x,z)=>{const a=Math.sin(x*127.1+z*311.7)*43758.5453;return a-Math.floor(a);};
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){
   const ix=cx+i-(n>>1),iz=cz+j-(n>>1),x=(ix+.65*jitter(ix,iz))*stride,z=(iz+.65*jitter(iz,ix))*stride;
   const rate=sample(displayPrecip(),x,z),floor=markerTerrainHeight(x,z)/ex,dist=Math.hypot(camera.position.x-x,camera.position.z-z);
   if(!(rate>=.1)||!Number.isFinite(floor)||dist<7)continue;
   const top=baseAt(x,z,floor),share=groundSnowShare(x,z,floor,rate);
   if(share===0 && hiddenLiquidAt(x,z,rate))continue;
   const visibleShare=($('fallingRain').checked?1-share:0)+($('fallingSnow').checked?share:0);
   if(!visibleShare)continue;
   const alpha=visibleShare*Math.min(.18,.07*Math.log1p(rate))*Math.min(1,(dist-7)/12);
   const width=stride*(1.1+.4*jitter(ix+32,iz)),fall=Math.min(top-floor,2);
   const driftX=sample(W.u,x,z)*.035*fall,driftZ=-sample(W.v,x,z)*.035*fall;
   const corners=[];
   for(const sign of [-1,1]){
    const xx=x+axis.x*sign*width,zz=z+axis.z*sign*width;
    corners.push([xx,markerTerrainHeight(xx,zz),zz]);
   }
   if(corners.some(c=>!Number.isFinite(c[1])))continue;
   for(let k=0;k<4;k++){const [xx,yy,zz]=corners[k%2];pos.setXYZ(out*4+k,xx-(k>=2?driftX:0),k>=2?Math.max(top*ex,yy):yy,zz-(k>=2?driftZ:0));shade.setXY(out*4+k,alpha,share);}
   out++;
  }
  g.setDrawRange(0,out*6);pos.needsUpdate=shade.needsUpdate=true;
 };
}
const updateShafts=shaftLayer();

const count=matchMedia('(pointer:coarse)').matches?2400:3600;
const rainCapacity=count*2;
const impactLifetimeMs=270;
const drops=rainLayer(rainCapacity),flakes=snowLayer(rainCapacity);
// One short-lived impact per particle, batched into a single point draw.
const impacts=new THREE.BufferGeometry();
const impactPositions=new THREE.BufferAttribute(new Float32Array(rainCapacity*3),3).setUsage(THREE.DynamicDrawUsage);
const impactAges=new THREE.BufferAttribute(new Float32Array(rainCapacity),1).setUsage(THREE.DynamicDrawUsage);
impacts.setAttribute('position',impactPositions);impacts.setAttribute('progress',impactAges);
const splashMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,
 uniforms:{distanceEmphasis,overhead,pixelRatio:{value:1}},
 vertexShader:`attribute float progress;uniform float pixelRatio,distanceEmphasis,overhead;varying float age,alpha;
 void main(){age=progress;alpha=0.5*max(overhead,distanceEmphasis)*(1.-progress*progress);
 gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
 gl_PointSize=pixelRatio*mix(8.,28.,progress)*mix(1.,2./3.,overhead);}`,
 fragmentShader:`uniform float overhead;varying float age,alpha;void main(){
 vec2 p=gl_PointCoord-.5;
 float ring=1.-smoothstep(.055,.14,abs(length(p*vec2(1.,mix(2.6,1.,overhead)))-.34));
 float spray=1.-smoothstep(.045,.13,length(vec2(abs(p.x)-.24,p.y+.17*sin(age*3.14159))));
 gl_FragColor=vec4(.84,.94,1.,alpha*max(ring,spray));}`});
const splashes=new THREE.Points(impacts,splashMaterial);
splashes.frustumCulled=false;splashes.renderOrder=1;impacts.setDrawRange(0,0);scene.add(splashes);
// Equal budgets and the same density curve for liquid and snow-water rates.
const rainViewDirection=new THREE.Vector3();
const seeds=Array.from({length:rainCapacity*2},(_,i)=>({active:false,snow:i>=rainCapacity}));
function seed(p,ex){
 const radius=Math.max(2,2*camera.position.distanceTo(controls.target)*Math.tan(camera.fov*Math.PI/360)*Math.max(1,camera.aspect));
 const left=Math.max(-T.width_km/2,controls.target.x-radius),right=Math.min(T.width_km/2,controls.target.x+radius);
 const near=Math.max(-T.depth_km/2,controls.target.z-radius),far=Math.min(T.depth_km/2,controls.target.z+radius);
 if(right<=left||far<=near)return false;
 p.x=left+Math.random()*(right-left);p.z=near+Math.random()*(far-near);
 const total=sample(displayPrecip(),p.x,p.z),floor=markerTerrainHeight(p.x,p.z)/ex;
 if(!(total>=.1)||!Number.isFinite(floor))return false;
 const snowRate=total*groundSnowShare(p.x,p.z,floor,total);
 const liquidRate=Math.max(0,total-(W.snow_water?sample(W.snow_water,p.x,p.z):0));
 p.rate=p.snow?snowRate:liquidRate;
 if(!(p.rate>=.05)||(!p.snow&&hiddenLiquidAt(p.x,p.z,total))||Math.random()>precipitationDensity(p.rate))return false;
 if(p.snow)p.flakeSize=.65+.35*(Math.random()+Math.random());
 p.ceiling=floor+maxParticleHeightKm;
 p.y=p.ceiling-.02;p.fallSpeed=(p.y-floor)/(2*1.5);
 p.phase=Math.random()*6.283;p.age=0;p.streakFrames=0;p.streakSeconds=0;p.active=true;
 return true;
}
let precipitationTerrain;
updatePrecipitation=dt=>{
 if(precipitationTerrain!==T){
  precipitationTerrain=T;baseSource=null;bases=null;
  for(const p of seeds){p.active=false;p.retry=0;p.impactUntil=0;}
 }
 const distance=camera.position.distanceTo(controls.target);
 const tilt=Math.sin(controls.getPolarAngle());
 distanceEmphasis.value=THREE.MathUtils.smoothstep(distance,20,70)*THREE.MathUtils.smoothstep(tilt,.15,.65);
 const rainOn=$('fallingRain').checked,snowOn=$('fallingSnow').checked,active=(rainOn||snowOn)&&!!W;
 drops.obj.visible=rainOn&&!!W;flakes.obj.visible=snowOn&&!!W;
 splashes.visible=drops.obj.visible&&$('rainSplashes').checked&&(distanceEmphasis.value>0||overhead.value>0);
 updateShafts(active);if(!active)return;
 if(atmosphere&&atmosphereKey===pub.cycle+':'+$('region').value+':'+W.hour)updateBases(atmosphere);
 const ex=Number($('exaggeration').value);
 const now=performance.now();
 overhead.value=1-THREE.MathUtils.smoothstep(tilt,.08,.45);
 camera.getWorldDirection(rainViewDirection);
 let nr=0,ns=0,ni=0;
 for(const p of seeds){
  if(p.snow?!snowOn:!rainOn){p.active=false;continue;}
  if(!p.active){
   if(p.retry>performance.now())continue;
   if(!seed(p,ex)){p.retry=performance.now()+350+Math.random()*600;continue;}
   p.hideForPerspective=false;
   if(camera.isPerspectiveCamera && !p.snow){
    const groundY=(p.ceiling-maxParticleHeightKm)*ex;
    const depth=(p.x-camera.position.x)*rainViewDirection.x+
     (groundY-camera.position.y)*rainViewDirection.y+(p.z-camera.position.z)*rainViewDirection.z;
    // Horizontal ground area projects in proportion to camera height / depth cubed.
    // Use the orbit target as reference; soften the correction near the horizon.
    const heightRatio=Math.abs(camera.position.y-groundY)/Math.max(.001,Math.abs(camera.position.y-controls.target.y));
    const areaRatio=heightRatio*Math.pow(distance/Math.max(.001,depth),3);
    const keep=THREE.MathUtils.clamp(Math.pow(areaRatio,.8),.15,1);
    p.hideForPerspective=Math.random()>keep;
   }
  }
  const previousFrames=p.streakFrames, previousSeconds=p.streakSeconds;
  p.streakFrames=0;p.streakSeconds=0;
  const snow=p.snow;
  // Accelerated illustrative fall at kilometre-scale viewing distances.
  const fall=p.fallSpeed,t=dt*2;p.age+=dt;
  p.y-=fall*t;
  const ground=markerTerrainHeight(p.x,p.z)/ex;
  if(!Number.isFinite(ground)||p.age>24){p.active=false;continue;}
  if(p.y<=ground){
   if(!snow && splashes.visible && previousFrames>=2 && previousSeconds>=.09){
    {
     p.impactX=p.x;p.impactZ=p.z;p.impactGround=ground;p.impactUntil=now+impactLifetimeMs;
    }
   }
   p.active=false;continue;
  }
  const ceiling=Math.min(p.ceiling,ground+maxParticleHeightKm);
  if(p.y>=ceiling || p.hideForPerspective)continue;
  const alpha=.72*Math.min(1,p.age/.15);
  if(p.snow){
   // Independent phases give each flake a soft glint as it tumbles.
   const glint=.5+.5*Math.sin(p.phase+p.age*(2.2+.18*p.phase));
   flakes.position.setXYZ(ns,p.x,p.y*ex,p.z);
   flakes.flakeSize.setX(ns,p.flakeSize);
   flakes.opacity.setX(ns++,Math.min(1,alpha*1.6)*(.72+.28*glint));
  }
  else{
   const len=Math.min(ceiling-p.y,(particleScale*.65)*Math.min(.085,.28*(ceiling-ground)));
   const tailX=p.x,tailZ=p.z;
   const tailGround=markerTerrainHeight(tailX,tailZ)/ex;
   const tailY=Math.min(p.y+len,tailGround+maxParticleHeightKm);
   if(!Number.isFinite(tailY)||tailY<=p.y)continue;
   drops.head.setXYZ(nr,p.x,p.y*ex,p.z);
   drops.tail.setXYZ(nr,tailX,tailY*ex,tailZ);
   drops.widthScale.setX(nr,.55);
   drops.opacity.setX(nr++,alpha);
   if(alpha>=.20){
    p.streakFrames=previousFrames+1;p.streakSeconds=previousSeconds+dt;
   }
  }
 }
 // Draw impacts on the contact frame, including those whose particle was recycled.
 if(splashes.visible)for(const p of seeds){
  if(!(p.impactUntil>now))continue;
  impactPositions.setXYZ(ni,p.impactX,p.impactGround*ex+.001,p.impactZ);
  impactAges.setX(ni++,1-(p.impactUntil-now)/impactLifetimeMs);
 }
 impacts.setDrawRange(0,ni);
 if(ni){impactPositions.needsUpdate=impactAges.needsUpdate=true;splashMaterial.uniforms.pixelRatio.value=renderer.getPixelRatio()*scenePixels;}
 drops.g.instanceCount=nr;drops.lengthScale.value=.5;
 // Preserve the normal on-screen width when orbit playback downsamples the canvas.
 renderer.getSize(drops.viewport).divideScalar(scenePixels);
 const shortSide=Math.min(drops.viewport.x,drops.viewport.y);
 // Use the physical screen's short side so phone landscape keeps the same size.
 const phoneRainScale=matchMedia('(pointer:coarse)').matches&&Math.min(screen.width,screen.height)<=500?2:1;
 drops.screenScale.value=desktopSymbolScale*phoneRainScale*THREE.MathUtils.lerp(.33,1,THREE.MathUtils.smoothstep(shortSide,440,740));
 drops.viewport.multiplyScalar(Math.min(initialPixelRatio*initialSceneScale,matchMedia('(pointer:coarse)').matches || innerWidth/scenePixels<=700?1.25:2));
 drops.widthScale.needsUpdate=drops.head.needsUpdate=drops.tail.needsUpdate=drops.opacity.needsUpdate=true;
 flakes.g.setDrawRange(0,ns);flakes.flakeSize.needsUpdate=flakes.position.needsUpdate=flakes.opacity.needsUpdate=true;
 flakes.mat.uniforms.pixelRatio.value=renderer.getPixelRatio()*scenePixels;
};

function installVideoRecorder(){
 const source=renderer.domElement,format=$('videoFrame'),quality=$('videoQuality'),button=$('videoRecord');
 const dialog=$('clipDialog'),preview=$('clipPreview'),guide=$('videoGuide');
 const toolbar=$('clearToolbar');
 toolbar.append($('videoTools'));
 const adjustToolbar=()=>document.body.style.setProperty('--video-toolbar-height',toolbar.offsetHeight+'px');
 new ResizeObserver(adjustToolbar).observe(toolbar);
 adjustToolbar();
 const aspects={wide:16/9,square:1,tall:9/16};
 let take=null,clip=null,clipURL=null;
 function framing(w,h,aspect){
  const width=Math.min(w,h*aspect),height=width/aspect;
  return {x:(w-width)/2,y:(h-height)/2,width,height};
 }
 function frameGuide(){
  const rect=source.getBoundingClientRect(),aspect=take?.aspect||aspects[format.value];
  guide.hidden=(!take&&!$('uiRecording')?.open)||!aspect||format.value==='view';
  if(guide.hidden)return;
  const r=framing(rect.width,rect.height,aspect);
  Object.assign(guide.style,{left:(rect.left+r.x)+'px',top:(rect.top+r.y)+'px',width:r.width+'px',height:r.height+'px'});
 }
 for(const select of [format,quality]){
  try{const value=localStorage.getItem(select.id);if([...select.options].some(o=>o.value===value))select.value=value;}catch{}
  select.onchange=()=>{try{localStorage.setItem(select.id,select.value);}catch{}frameGuide();};
 }
 addEventListener('resize',frameGuide);addEventListener('record-setup-visibility',frameGuide);frameGuide();
 function paint(s){
  const {ctx,w,h}=s,r=framing(source.width,source.height,s.aspect);
  ctx.drawImage(source,r.x,r.y,r.width,r.height,0,0,w,h);
  const unit=Math.min(w,h)/720,pad=20*unit;
  ctx.shadowColor='#06131e';ctx.shadowBlur=5*unit;ctx.fillStyle='white';ctx.textAlign='right';
  ctx.font='bold '+32*unit+'px monospace';
  const time=$('mapTimeMain').textContent.trim();
  ctx.fillText(time,w-pad,pad+27*unit);
  const timeWidth=ctx.measureText(time).width;
  ctx.font='bold '+19*unit+'px monospace';
  ctx.fillText($('mapTimeDate').textContent,w-pad-timeWidth-10*unit,pad+27*unit);
  ctx.font='600 '+15*unit+'px system-ui';ctx.fillText($('mapTimeZone').textContent,w-pad,pad+48*unit);
  ctx.shadowBlur=0;
  const gradient=ctx.createLinearGradient(0,h-75*unit,0,h);
  gradient.addColorStop(0,'transparent');gradient.addColorStop(1,'rgba(3,15,25,.85)');
  ctx.fillStyle=gradient;ctx.fillRect(0,h-75*unit,w,75*unit);
  ctx.textAlign='left';ctx.fillStyle='white';ctx.font='bold '+19*unit+'px system-ui';
  ctx.fillText('Weather Explorer · Local trial',pad,h-pad-18*unit);
  ctx.font=14*unit+'px system-ui';ctx.fillText('IFS 0.1° · ECMWF Open Data · CC BY 4.0',pad,h-pad);
 }
 function ready(){
  button.textContent='● Record';button.disabled=false;format.disabled=quality.disabled=false;
 }
 function result(s,error){
  for(const track of s.stream.getTracks())track.stop();
  take=null;videoCaptureActive=false;ready();frameGuide();
  clip=new Blob(s.chunks,{type:s.recorder.mimeType||s.chunks[0]?.type});
  const ok=clip.size>0,ext=clip.type.includes('mp4')?'mp4':'webm';
  $('clipName').value=s.name+'.'+ext;
  if(ok){clipURL=URL.createObjectURL(clip);preview.src=clipURL;}
  preview.hidden=$('clipView').hidden=$('clipNameLabel').hidden=$('clipSave').hidden=!ok;
  const appleMobile=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const photos=appleMobile&&ext==='mp4';
  $('clipShare').hidden=!ok||(!photos&&!navigator.canShare?.({files:[videoFile()]}));
  $('clipShare').textContent=photos?'Save to Photos…':'Share';
  $('clipSave').textContent=appleMobile?'Download to Files':'Save video';
  $('clipHeading').textContent=ok?'Recording ready':'Recording interrupted';
  $('clipStatus').textContent=error||(!ok?'The browser did not return any video frames.':photos?'Choose Save Video in the share sheet to add the clip to Photos.':'');
  dialog.showModal();
 }
 function videoFile(){
  const ext=clip.type.includes('mp4')?'mp4':'webm';
  const name=$('clipName').value.trim().replace(/[\\/:*?"<>|]/g,'-').replace(/\.(mp4|webm)$/i,'')||'Weather3D';
  return new File([clip],name+'.'+ext,{type:clip.type.split(';')[0]});
 }
 $('clipView').onclick=()=>preview.play().catch(e=>{$('clipStatus').textContent=e.message;});
 $('clipSave').onclick=async()=>{
  const file=videoFile();
  try{
   if(window.showSaveFilePicker){
    const handle=await showSaveFilePicker({suggestedName:file.name});
    const writer=await handle.createWritable();await writer.write(file);await writer.close();
   }else{const a=document.createElement('a');a.href=clipURL;a.download=file.name;a.click();}
  }catch(e){if(e.name!=='AbortError')$('clipStatus').textContent=e.message;}
 };
 $('clipShare').onclick=async()=>{
  const fallback='Choose Download to Files, then open the clip in Files and tap Share → Save Video.';
  try{
   if(!navigator.share){$('clipStatus').textContent=fallback;return;}
   await navigator.share({files:[videoFile()]});
  }catch(e){
   if(e.name!=='AbortError')$('clipStatus').textContent=$('clipShare').textContent.startsWith('Save to Photos')?fallback:e.message;
  }
 };
 $('clipClose').onclick=()=>dialog.close();
 dialog.onclose=()=>{preview.pause();preview.removeAttribute('src');preview.load();if(clipURL)URL.revokeObjectURL(clipURL);clipURL=null;clip=null;};
 if(!window.MediaRecorder||!HTMLCanvasElement.prototype.captureStream){button.textContent='Recording unavailable';return;}
 ready();
 button.onclick=()=>{
  if(take){if(take.recorder.state==='recording'){button.disabled=true;button.textContent='Finishing…';take.recorder.stop();}return;}
  if(!W)return;
  let stream;
  try{
   const aspect=aspects[format.value]||source.width/source.height;
   const short=Number(quality.value),long=short*16/9;
   let h=Math.min(short/Math.min(1,aspect),long/Math.max(1,aspect));
   const canvas=document.createElement('canvas');
   const w=canvas.width=Math.max(2,2*Math.round(h*aspect/2));h=canvas.height=Math.max(2,2*Math.round(h/2));
   const ctx=canvas.getContext('2d',{alpha:false});
   const region=$('region').selectedOptions[0].textContent.trim();
   const name=[region,$('mapTimeDate').textContent,$('mapTimeMain').textContent.trim(),$('mapTimeZone').textContent].join('_').replace(/\s+/g,'-').replace(/\//g,'-');
   const manual=typeof CanvasCaptureMediaStreamTrack!=='undefined'&&'requestFrame' in CanvasCaptureMediaStreamTrack.prototype;
   stream=canvas.captureStream(manual?0:30);
   const mimeType=['video/mp4;codecs=avc1','video/mp4','video/webm;codecs=vp9','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));
   const recorder=new MediaRecorder(stream,{...(mimeType?{mimeType}:{}),...(short>=2160?{videoBitsPerSecond:24000000}:{})});
   const s={stream,recorder,ctx,aspect,w,h,name,chunks:[],start:performance.now(),last:performance.now()-1000/30,error:''};
   recorder.ondataavailable=e=>{if(e.data.size)s.chunks.push(e.data);};
   recorder.onerror=e=>{s.error=e.error?.message||'The browser interrupted recording.';};
   recorder.onstop=()=>result(s,s.error);
   renderer.render(scene,camera);paint(s);recorder.start(1000);stream.getVideoTracks()[0].requestFrame?.();take=s;videoCaptureActive=true;button.textContent='■ Stop 0:00';format.disabled=quality.disabled=true;
  }catch(e){stream?.getTracks().forEach(track=>track.stop());alert('Could not start recording. '+e.message);}
 };
 return ()=>{
  if(!take||take.recorder.state!=='recording')return;
  const now=performance.now();if(now-take.last<1000/30-1)return;
  paint(take);take.stream.getVideoTracks()[0].requestFrame?.();take.last=now-((now-take.last)%(1000/30));
  const seconds=Math.floor((now-take.start)/1000);
  button.textContent='■ Stop '+Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');
 };
}
captureVideoFrame=installVideoRecorder();

 function cloudDisplayExaggeration(){return Math.max(Number($('exaggeration').value),Number($('cloudExaggeration')?.value||5));}
 function syncCloudExaggeration(){const c=$('cloudExaggeration');if(!c)return;const terrain=Number($('exaggeration').value);c.min=terrain;c.value=cloudDisplayExaggeration();$('cloudExLabel').textContent=c.value+'×';}
 
// Group the existing controls into focused panels.
{
 const mobile=matchMedia('(max-width:700px), (max-height:520px) and (pointer:coarse)');
 const make=(tag,attrs={},text='')=>{const e=document.createElement(tag);Object.assign(e,attrs);if(text)e.textContent=text;return e;};
 const button=(text,fn)=>{const b=make('button',{type:'button'},text);b.onclick=fn;return b;};
 const helpButton=$('viewerHelp');
 const panel=$('panel'),old=$('brisControlsContents');old.hidden=true;old.id='uiLegacy';document.body.append(old);
 const oldHeader=document.querySelector('header');oldHeader.hidden=true;
 panel.replaceChildren();panel.className='glass uiPanel';panel.setAttribute('aria-label','Viewer settings');
 const bar=make('div',{className:'uiHeading'}),panelClose=button('×',()=>setPanel(false));panelClose.className='uiWindowClose';panelClose.setAttribute('aria-label','Close settings');panelClose.title='Close';bar.append(make('strong',{},'Explore the forecast'),panelClose);panel.append(bar);
 const scroll=make('div',{className:'uiScroll'});panel.append(scroll);
 function move(id,parent){const e=$(id);if(e)parent.append(e);return e;}
 function field(id,parent){const input=$(id),label=document.querySelector(`label[for="${id}"]`);if(label)parent.append(label);if(input)parent.append(input);return input;}
 function check(id,parent,text){const input=$(id),label=input.closest('label');if(text){for(const n of [...label.childNodes])if(n!==input)n.remove();label.append(document.createTextNode(text));}parent.append(label);return input;}
 function heading(text,parent){parent.append(make('h3',{},text));}
 function note(text,parent){parent.append(make('p',{className:'sub'},text));}
 field('region',scroll);document.querySelector('label[for=region]').textContent='Region';
 move('placeSearch',scroll);$('placeQuery').placeholder='Search a town or place…';
 $('placeQuery').addEventListener('input',()=>{for(const b of $('placeMatches').querySelectorAll('button'))if(b.textContent.startsWith('Fly to '))b.remove();});
 const placeCard=make('section',{id:'uiPlace',hidden:true});placeCard.append(make('strong',{id:'uiPlaceName'},'Selected location'));move('info',placeCard);
 const placeActions=make('div',{className:'uiRow'});const forecast=button('Forecast',()=>{openPoint();if(mobile.matches)setPanel(false);});
 const fly=button('Fly to & orbit',()=>{if(!selected)return;const [lat,lon]=coords(selected.x,selected.z);flyToCity([$('uiPlaceName').textContent,lat,lon]);selectTab('view');});
 const stay=button('Fly to & stay',()=>{if(!selected)return;const [lat,lon]=coords(selected.x,selected.z);flyToCity([$('uiPlaceName').textContent,lat,lon],true);selectTab('view');});placeActions.append(stay,fly);placeActions.classList.add('uiPlaceActions');placeCard.append(placeActions);scroll.append(placeCard);
 const tabs=make('div',{className:'uiTabs'});tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Control categories');scroll.append(tabs);
 const weather=make('section',{id:'uiWeather'}),view=make('section',{id:'uiView',hidden:true});
 const tabButtons={};for(const [key,label,target] of [['weather','Weather',weather],['view','View & orbit',view]]){const b=button(label,()=>selectTab(key));b.id='uiTab'+key;b.setAttribute('role','tab');b.setAttribute('aria-controls',target.id);target.setAttribute('role','tabpanel');target.setAttribute('aria-labelledby',b.id);tabs.append(b);tabButtons[key]=b;}
 function selectTab(key){weather.hidden=key!=='weather';view.hidden=key!=='view';for(const k in tabButtons){tabButtons[k].setAttribute('aria-selected',String(k===key));tabButtons[k].tabIndex=k===key?0:-1;}}
 tabs.onkeydown=e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const key=weather.hidden?'weather':'view';selectTab(key);tabButtons[key].focus();}};
 scroll.append(weather,view);selectTab('weather');
 heading('Surface colours',weather);const choices=move('surfaceChoices',weather);choices.prepend(choices.querySelector('[data-surface=terrain]'));move('legend',weather);move('surfaceOpacityOptions',weather);
 heading('3D layers',weather);const windLabel=make('label',{className:'check'});const wind=make('input',{type:'checkbox',id:'uiWind',checked:true});wind.onchange=()=>{if(trail)trail.visible=wind.checked;};windLabel.append(wind,document.createTextNode('Wind trails'));weather.append(windLabel);
 for(const [id,text] of [['pressureClouds','3D clouds'],['pressureContours','Isobars · 2 hPa']])check(id,weather,text);
 const precipitationLabel=make('label',{className:'check'}),precipitationSwitch=make('input',{id:'uiPrecipitation',type:'checkbox',checked:$('fallingRain').checked&&$('fallingSnow').checked});
 precipitationLabel.append(precipitationSwitch,document.createTextNode('Falling rain & snow'));
 weather.insertBefore(precipitationLabel,$('pressureContours').closest('label'));
 precipitationSwitch.onchange=()=>{for(const id of ['fallingRain','fallingSnow']){const e=$(id);e.checked=precipitationSwitch.checked;e.dispatchEvent(new Event('change',{bubbles:true}));}};
 move('atmosphereStatus',weather);
 const windLegend=make('details',{className:'uiLegend'});windLegend.append(make('summary',{},'Wind colours · km/h'));
 if(trailLegendTitle){windLegend.append(trailLegendTitle.nextElementSibling);weather.append(windLegend);}
 heading('Camera',view);move('viewButtons',view);field('exaggeration',view);note('1× is true scale. Terrain and clouds can be stretched separately.',view);
 const cloudHeightLabel=make('label',{htmlFor:'cloudExaggeration'});cloudHeightLabel.append(document.createTextNode('Cloud height '),make('strong',{id:'cloudExLabel'},'5×'));
 const cloudHeight=make('input',{id:'cloudExaggeration',type:'range',min:'1',max:'20',step:'0.5',value:'5'});view.append(cloudHeightLabel,cloudHeight);cloudHeight.oninput=()=>{syncCloudExaggeration();drawAtmosphere();};
 $('exaggeration').addEventListener('input',syncCloudExaggeration);syncCloudExaggeration();
 note('Cloud height is measured from sea level and cannot be less than terrain height. Raising terrain raises clouds if needed. These are display adjustments.',view);
 const orbit=move('orbitSettings',view);const orbitActions=make('div',{className:'uiRow'}),orbitToggle=button('Pause orbit',()=>{if(cityFlight)cancelCityFlight();else resumeOrbit();}),orbitExit=button('Exit orbit',()=>{cancelCityFlight();offerResume(null);orbit.hidden=true;});orbitActions.append(orbitToggle,orbitExit);orbit.prepend(orbitActions);
 const orbitNote=make('p',{id:'uiOrbitHint',className:'sub'},'Choose a location above, then Fly to & stay or Fly to & orbit.');view.append(orbitNote);$('resumeOrbit').hidden=true;
 const footer=make('div',{className:'uiFooter'}),advancedButton=button('Advanced settings',()=>openWindow(advanced,advancedButton));footer.append(advancedButton);move('shareView',footer);move('shareResult',footer);scroll.append(footer);
 // Advanced controls retain their original handlers and values.
 const advanced=make('dialog',{id:'uiAdvanced',className:'uiDialog'});advanced.setAttribute('aria-labelledby','uiAdvancedTitle');document.body.append(advanced);
 const advHead=make('div',{className:'uiHeading'});advHead.append(make('h2',{id:'uiAdvancedTitle'},'Advanced settings'),button('Close',()=>advanced.close()));advanced.append(advHead);
 note('Fine-tune the display. These settings do not change the underlying forecast.',advanced);
 function group(title){const s=make('section',{className:'uiAdvancedGroup'});heading(title,s);advanced.append(s);return s;}
 const wg=group('Wind appearance');field('density',wg);note('The middle setting keeps the usual number of trails. Move right for up to twice as many.',wg);field('speed',wg);note('Trail speed changes motion on screen, not the forecast wind or timeline.',wg);
 const cg=group('Cloud interpretation & appearance');move('cloudOptions',cg);$('cloudOptions').hidden=false;
 note('Texture adds gentle shading only. Cloud coverage and density stay the same with texture on or off.',cg);
 // Keep interpretation settings available with cloud rendering off: the rain filter uses them too.
 const cloudChange=$('pressureClouds').onchange;$('pressureClouds').onchange=()=>{cloudChange();$('cloudOptions').hidden=false;};
 note('Precipitation amounts are independent of cloud mode and humidity threshold.',cg);
 const densityWrapper=make('div',{id:'uiCloudDensity'});field('cloudOpacity',densityWrapper);$('cloudOptions').append(densityWrapper);
 const pg=group('Precipitation effects');check('rainSplashes',pg,'Rain splashes');note('Rain and snow fall close to the terrain. Their density reflects the liquid-water rate. Distant rain is thinned to account for perspective. Distant precipitation is emphasised automatically.',pg);
 const tg=group('Terrain');check('detailTerrain',tg);move('detailNote',tg);move('tileStatus',tg);note('Adaptive Copernicus relief refines as you approach. Weather stays on the 0.1° IFS forecast grid.',tg);
 function resetGroup(parent,values){parent.append(button('Restore defaults',()=>{for(const [id,value]of Object.entries(values)){const el=$(id);if(typeof value==='boolean')el.checked=value;else el.value=value;el.dispatchEvent(new Event(el.type==='range'?'input':'change',{bubbles:true}));}}));}
 resetGroup(wg,{density:2,speed:1.6});resetGroup(cg,{cloudThreshold:65,cloudLevel:'all',textureCloud:true,cloudOpacity:15});resetGroup(pg,{rainSplashes:true});resetGroup(tg,{detailTerrain:true});document.body.append(advanced);
 // Keep branding, help and clean-view access out of the settings scroll.
 const top=make('div',{id:'uiTop'});top.append(make('span',{className:'uiBrand'},'Local'),make('span',{className:'uiBadge'},'IFS · LOCAL'));
 top.append(helpButton);top.append(button('About',e=>openWindow(about,e.currentTarget)),button('Clean view',()=>setClearView(true)));document.body.append(top);
 const about=make('dialog',{className:'uiDialog',id:'uiAbout'});about.append(button('Close',()=>about.close()),make('h2',{},'About Weather3D'));const aboutContent=$('brisInfoContents');aboutContent.hidden=false;about.append(aboutContent);document.body.append(about);
 // Existing Help stays detailed, but its navigation text follows this test layout.
 const help=$('viewerHelpDialog');help.innerHTML=help.innerHTML.replace(/<h3>Other controls<\/h3><p>.*?<\/p>/s,'<h3>Settings and sharing</h3><p>Region and search are at the top of Settings. Weather selects surface colours and 3D layers. View &amp; orbit contains camera controls. Advanced settings holds cloud interpretation, wind appearance, terrain details and rain splashes. Share this view opens the latest forecast for the selected view. Clean view hides panels; Settings brings them back.</p>').replace('Choose a frame and resolution in the bottom toolbar, then press Record.','Choose Record… in the bottom toolbar, choose a frame and resolution, then press Start recording.').replace('beneath the location search','in View &amp; orbit').replace('under <b>Explore</b>','under <b>Region</b>').replace('Switch off texture to adjust cloud density.','In Advanced settings, switch off texture to adjust cloud density.');
 help.innerHTML=help.innerHTML.replace('You can switch falling rain and falling snow on independently.','Falling rain &amp; snow switches both particle types on or off together.');
 // Recording options are only shown when needed. The original recorder owns all capture/save logic.
 const recordDialog=make('dialog',{id:'uiRecording',className:'uiDialog'});recordDialog.setAttribute('aria-labelledby','uiRecordTitle');recordDialog.append(make('h2',{id:'uiRecordTitle'},'Record this view'));
 const tools=$('videoTools');for(const [id,text]of [['videoFrame','Framing'],['videoQuality','Resolution']]){const l=make('label',{htmlFor:id},text);recordDialog.append(l);move(id,recordDialog);}
 const recordStart=$('videoRecord');recordStart.textContent='Start recording';recordDialog.append(recordStart,button('Cancel',()=>recordDialog.close()));tools.remove();document.body.append(recordDialog);
 const recordOpen=button('Record…',()=>{if(videoCaptureActive)recordStart.click();else {openWindow(recordDialog,recordOpen);dispatchEvent(new Event('record-setup-visibility'));}});recordOpen.id='uiRecord';$('clearToolbar').append(recordOpen);
 recordStart.addEventListener('click',()=>{if(videoCaptureActive)recordDialog.close();});
 recordDialog.addEventListener('close',()=>{dispatchEvent(new Event('record-setup-visibility'));if(!videoCaptureActive)$('videoGuide').hidden=true;});
 const settings=$('restoreControls');settings.textContent='Settings';settings.title='Open or close viewer settings';settings.setAttribute('aria-controls','panel');
 let panelOpen=!mobile.matches;
 function setPanel(open){panelOpen=open;panel.hidden=!open;settings.setAttribute('aria-expanded',String(open));document.body.classList.toggle('uiPanelOpen',open);if(open)document.body.classList.remove('uiClean');positionMapTime();}
 isClearView=()=>document.body.classList.contains('uiClean');
 setClearView=value=>{document.body.classList.remove('clearView');document.body.classList.toggle('uiClean',value);setPanel(!value);down=null;};
 settings.onclick=()=>{document.body.classList.remove('uiClean');setPanel(!panelOpen);};
 document.body.classList.remove('clearView');setPanel(panelOpen);
 // Fixed timestamp placement, independent of scroll position in the new panel.
 positionMapTime=()=>{const el=$('mapTime');el.style.left='auto';el.style.top='';el.style.right=(!mobile.matches&&panelOpen?'350px':'16px');};positionMapTime();
 const originalChoose=choosePlace;choosePlace=place=>{originalChoose(place);if(selected&&T&&placeInRegion(place,T.bounds))$('uiPlaceName').textContent=place[0];};
 const originalFly=flyToCity;flyToCity=async (place,stay=false)=>{await originalFly(place,stay);selectTab('view');};
 const originalInspect=inspect;inspect=p=>{const changed=!selected||Math.abs(selected.x-p.x)+Math.abs(selected.z-p.z)>.00001;originalInspect(p);if(changed){$('uiPlaceName').textContent='Selected location';if(mobile.matches){document.body.classList.remove('uiClean');setPanel(true);}}};
 $('region').addEventListener('change',()=>{placeCard.hidden=true;});
 // Restore a desktop panel after changing orientation/size; phones keep the map clear.
 mobile.addEventListener('change',()=>setPanel(!mobile.matches));
 const originalUpdateClear=updateClearControls;updateClearControls=()=>{originalUpdateClear();};
 const selectedForecastName=make('div',{className:'sub',id:'uiForecastLocation'});$('pointDragHandle').append(selectedForecastName);
 let previousSelected=null;
 setInterval(()=>{
  placeCard.hidden=!selected;
  selectedForecastName.textContent=selected?'Selected: '+$('uiPlaceName').textContent+' · forecast for the nearest model cell':'';
  if(selected!==previousSelected)previousSelected=selected;
  orbitToggle.textContent=cityFlight?(cityFlight.stay?'Pause flight':'Pause orbit'):pausedFlight?.stay?'Start orbit':'Resume orbit';const flight=cityFlight||pausedFlight;if(flight){$('orbitCity').textContent=flight.name+(flight.stay?' view':' orbit');orbitExit.textContent=flight.stay?'Exit location view':'Exit orbit';}$('resumeOrbit').hidden=true;orbitNote.hidden=!orbit.hidden;
  densityWrapper.hidden=false;
  recordOpen.disabled=recordStart.disabled;recordOpen.textContent=videoCaptureActive?recordStart.textContent:'Record…';if(!videoCaptureActive)recordStart.textContent='Start recording';
  if(pub){const d=new Date(pub.timing.initial_utc);$('cycle').textContent='Model run: '+new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'UTC',hourCycle:'h23'}).format(d)+' UTC';}
 },350);
 // Consistent windows: fixed header, independently scrolling body, native close semantics.
 const floatingWindows=[advanced,help,about,recordDialog];
 function frameWindow(dialog,titleElement,title,floating=false,closeButton=null){
  const content=make('div',{className:'uiWindowBody'}),header=make('div',{className:'uiWindowHeader'});
  if(!titleElement)titleElement=make('h2',{},title);
  if(!titleElement.id)titleElement.id=dialog.id+'Title';
  titleElement.remove();
  dialog.querySelector(':scope > .uiHeading')?.remove();
  dialog.querySelector(':scope > form[method=dialog]')?.remove();
  for(const child of [...dialog.children])if(child.tagName==='BUTTON'&&['Close','Cancel'].includes(child.textContent))child.remove();
  while(dialog.firstChild)content.append(dialog.firstChild);
  const close=closeButton||button('×',()=>dialog.close());close.textContent='×';close.classList.add('uiWindowClose');close.setAttribute('aria-label','Close '+title);close.title='Close';
  header.append(titleElement,close);dialog.append(header,content);dialog.removeAttribute('style');dialog.classList.add('uiWindow');dialog.setAttribute('aria-labelledby',titleElement.id);
  if(floating){
   dialog.classList.add('uiFloating');header.title='Drag to move this window';
   header.tabIndex=0;header.setAttribute('aria-label',title+' window; drag or use arrow keys to move');
   let drag=null;
   const place=(x,y)=>{const r=dialog.getBoundingClientRect();dialog.style.inset='auto';dialog.style.left=Math.max(0,Math.min(innerWidth-r.width,x))+'px';dialog.style.top=Math.max(0,Math.min(innerHeight-r.height,y))+'px';};
   header.addEventListener('pointerdown',e=>{if(mobile.matches||e.button!==0||e.target.closest('button'))return;const r=dialog.getBoundingClientRect();drag={x:e.clientX,y:e.clientY,left:r.left,top:r.top};header.setPointerCapture(e.pointerId);e.preventDefault();});
   header.addEventListener('pointermove',e=>{if(drag)place(drag.left+e.clientX-drag.x,drag.top+e.clientY-drag.y);});
   for(const event of ['pointerup','pointercancel','lostpointercapture'])header.addEventListener(event,()=>{drag=null;});
   header.addEventListener('keydown',e=>{if(e.target!==header||mobile.matches||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const r=dialog.getBoundingClientRect(),step=e.shiftKey?40:10;place(r.left+(e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0),r.top+(e.key==='ArrowDown'?step:e.key==='ArrowUp'?-step:0));});
   addEventListener('resize',()=>{if(!dialog.open)return;if(mobile.matches)dialog.style.cssText='';else {const r=dialog.getBoundingClientRect();place(r.left,r.top);}});
  }
  dialog.addEventListener('close',()=>{dialog._opener?.focus({preventScroll:true});});
 }
 function openWindow(dialog,opener){
  for(const other of floatingWindows)if(other!==dialog&&other.open)other.close();
  dialog._opener=opener;dialog.show();dialog.querySelector('.uiWindowClose').focus({preventScroll:true});
 }
 frameWindow(advanced,$('uiAdvancedTitle'),'Advanced settings',true);
 frameWindow(help,$('viewerHelpTitle'),'Help',true);
 frameWindow(about,about.querySelector('h2'),'About',true);
 frameWindow(recordDialog,$('uiRecordTitle'),'Recording',true);
 frameWindow($('clipDialog'),$('clipHeading'),'video preview',false,$('clipClose'));
 helpButton.onclick=()=>openWindow(help,helpButton);
 document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;const open=floatingWindows.find(d=>d.open);if(open){open.close();e.preventDefault();}else if(!document.querySelector('dialog[open]'))setPanel(false);});
}

// Local trial integration; no live Weather3D forecast calls.
const modeLabel=document.createElement('label');modeLabel.textContent='Cloud display';
const mode=document.createElement('select');mode.id='cloudMode';mode.setAttribute('aria-label','Cloud display');
mode.innerHTML='<option value="humidity">Humidity volumes · 13 pressure levels</option><option value="cover">Low / middle / high cloud cover</option>';
mode.value='cover';
const modeNote=document.createElement('p');modeNote.className='sub';
function updateMode(){
 modeNote.textContent=mode.value==='cover'?'IFS cloud fractions. Layer heights are illustrative; they do not predict cloud base or top.':'Clouds inferred from IFS relative humidity at forecast pressure-level heights.';
 $('cloudLevel').disabled=mode.value==='cover';$('cloudThreshold').disabled=mode.value==='cover';
 drawAtmosphere();
}
if(pub.clouds==='cover'){mode.value='cover';mode.options[0].disabled=true;}
mode.onchange=()=>{atmosphereKey='';++atmosphereRequest;updateMode();refreshAtmosphere();};
const cloudSwitch=$('pressureClouds').closest('label');cloudSwitch.after(modeLabel,mode,modeNote);updateMode();
// The parent globe sends a selected point only to this same-origin frame.
window.addEventListener('message',async e=>{
 if(e.origin!==location.origin||e.data?.type!=='local-location')return;
 const {lat,lon,name}=e.data;
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||!T||!W||loading)return;
 if(placeInRegion([name,lat,lon],T.bounds))flyToCity([name,lat,lon],true);
});
window.localTrialState=()=>({ready:!!T&&!!W&&!loading,region:$('region').value,hour:W?.hour,mode:mode.value,terrain:!!regional,cloudMeshes:cloudMeshes.length,run:pub?.cycle});
const initialLocation=new URLSearchParams(location.search);
if(initialLocation.has('lat')&&initialLocation.has('lon')){
 const place=[initialLocation.get('name')||'Selected location',Number(initialLocation.get('lat')),Number(initialLocation.get('lon'))];
 if(place.every((v,i)=>i===0||Number.isFinite(v)))setTimeout(async()=>{await flyToCity(place,true);$('uiTabweather').click();},300);
}
const credit=document.createElement('div');credit.id='localCredit';credit.textContent='Data: © 2026 ECMWF, CC BY 4.0. Regridded and unit-converted. IFS 0.1° · 3-hourly. Clouds illustrative.';
Object.assign(credit.style,{position:'fixed',bottom:'2px',left:'8px',fontSize:'10px',color:'#a8becb',pointerEvents:'none'});document.body.append(credit);
$('generateText').hidden=true;
document.querySelectorAll('#openPoint,#copyForecast,#pointText,#shareView').forEach(e=>e.hidden=true);
