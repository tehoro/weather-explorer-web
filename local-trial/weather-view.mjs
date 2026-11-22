import {updateCloudTerrain} from './cloud-terrain.mjs';
import {particleBudget,updateParticleAttribute} from './particle-budget.mjs';
import {forecastOrder} from './forecast-order.mjs';
import {RunRefresh,nearestTime} from './run-refresh.mjs?v=20261122j';
import {PrecipitationStreaks} from './precipitation-streaks.mjs?v=20261122u';
import {IsobarLines} from './isobar-lines.mjs?v=20261120s';
import {isobarInterval,pressureAnomalies} from './isobars.mjs?v=20261120o';
import {makePrecipitation,precipitationDensity} from './precipitation-display.mjs?v=20261120h';
import {updateForecastClock} from './local-time.mjs?v=20261122l';
import * as THREE from 'three';
import {WeatherData,bilinear,clamp} from './weather-data.mjs?v=20261122j';
const $=id=>document.getElementById(id);
const N=1300,L=24;

export class WeatherView{
 constructor(scene,context){
  this.scene=scene;this.context=context;this.data=new WeatherData();this.group=new THREE.Group();scene.add(this.group);this.token=0;this.frame=0;this.playing=false;this.elapsed=0;this.blend=1;this.particles=[];this.rain=[];this.meshes=[];
  $('cloudOpacity').oninput=()=>this.options();
  for(const id of ['windLayer','cloudLow','cloudMiddle','cloudHigh','rainLayer','pressureLayer','surfaceField','precipitationStyle'])$(id).onchange=()=>this.options();
  $('forecastTime').oninput=()=>{this.playing=false;this.playLabel();this.load(Math.round(Number($('forecastTime').value)));};
  $('retryBuffer').onclick=()=>this.prepare();
  $('weatherPlay').onclick=()=>{this.playing=!this.playing;this.elapsed=0;this.playLabel();};
  for(const [id,delta]of [['previousFrame',-1],['nextFrame',1]])$(id).onclick=()=>{this.playing=false;this.playLabel();this.load(clamp(this.frame+delta,0,(this.data.meta?.times.length||1)-1));};
  $('forecastNow').onclick=()=>{if(!this.data.meta)return;const times=this.data.meta.times.map(t=>Math.abs(Date.parse(t)-Date.now()));this.playing=false;this.playLabel();this.load(times.indexOf(Math.min(...times)));};
  $('weatherRetry').onclick=()=>this.load(this.requestedFrame??this.frame,true);
  this.data.init().then(m=>{const requested=m.steps.indexOf(Number(new URLSearchParams(location.search).get('step')));if(requested>=0)this.frame=this.requestedFrame=requested;
   else{const time=Date.parse(new URLSearchParams(location.search).get('time'))||Date.now();if(Number.isFinite(time)){const delta=m.times.map(t=>Math.abs(Date.parse(t)-time));this.frame=this.requestedFrame=delta.indexOf(Math.min(...delta));}}$('forecastTime').max=m.times.length-1;$('forecastTime').disabled=false;$('weatherPlay').disabled=false;this.refresh(true);}).catch(e=>this.error(e));
  this.runRefresh=new RunRefresh({active:()=>this.data,view:()=>this.current&&this.regionKey?{key:this.regionKey,region:this.region,time:Date.parse(this.data.meta.times[this.frame])}:null,apply:(data,grids,key)=>this.adoptRun(data,grids,key),report:text=>{$('runRefreshStatus').textContent=text;$('runRefreshStatus').hidden=!text;}});
  this.runTimer=setInterval(()=>this.runRefresh.check(),30000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)this.runRefresh.check();});
 }
 async adoptRun(data,grids,key){
  if(key!==this.regionKey)return;
  const frame=nearestTime(data.meta.times,Date.parse(this.data.meta.times[this.frame]));
  // Invalidate old requests before swapping all fields and the run metadata.
  this.token++;this.prepareId=(this.prepareId||0)+1;this.loading=false;
  this.data.dispose?.();this.data=data;this.prepared={region:key,grids};this.requestedFrame=frame;
  $('forecastTime').max=data.meta.times.length-1;
  await this.load(frame);this.prepare();
 }
 async prepare(){
  if(!this.current||this.loading)return;
  const id=this.prepareId=(this.prepareId||0)+1,region=this.regionKey;
  this.preparing=true;this.monitoringTerrain=true;$('prepareStatus').hidden=false;$('retryBuffer').hidden=true;
  const valid=()=>id===this.prepareId&&region===this.regionKey;
  const grids=this.prepared?.region===region?this.prepared.grids:new Map([[this.frame,this.current]]);this.prepared={region,grids};let done=false,error=null;
  // All times for this viewport, with imminent frames first. Never download a global forecast here.
  void (async()=>{try{while(valid()){const f=forecastOrder(this.requestedFrame??this.frame,this.data.meta.times.length).find(f=>!grids.has(f));if(f===undefined)break;grids.set(f,await this.data.grid(f,this.region,129,valid));}}catch(e){error=e;}finally{done=true;}})();
  try{
   while(valid()){
    const terrain=this.context().preloadStatus();
    $('prepareStatus').textContent=done?'Refining map detail…':'Loading forecast…';
    if(error)throw error;
    if(done&&!this.detailStartedForPrepare?.has(id)){this.detailStartedForPrepare=new Set([id]);void this.refineWeather(grids,valid,this.region);}
    if(done)this.preparing=false;
    // Failures and counts belong in Loading details, not over the map.
    $('prepareStatus').hidden=done&&(terrain.failed>0||terrain.ready===terrain.total);
    if(done&&!terrain.failed&&terrain.ready===terrain.total&&terrain.total)return;
    await new Promise(resolve=>setTimeout(resolve,300));
   }
  }catch(e){if(valid()){$('prepareStatus').textContent=e.message;$('retryBuffer').hidden=false;}}
  finally{if(id===this.prepareId){this.preparing=false;this.monitoringTerrain=false;}}
 }
 async refineWeather(grids,valid,region){
  if(!this.data.detailGrid)return;
  const data=this.data,total=data.meta.times.length;
  try{
   while(valid()&&this.data===data){
    const f=forecastOrder(this.requestedFrame??this.frame,total).find(f=>grids.get(f)?.quality!=='fine');if(f===undefined)break;
    const detail=await data.detailGrid(f,region,129,valid);
    if(!valid()||this.data!==data)return;grids.set(f,detail);
    if(this.frame===f&&!this.loading&&(!this.timeTransition||this.blend===1)){const elapsed=this.elapsed;await this.load(f);this.elapsed=elapsed;}
    $('weatherDetailStatus').textContent=`Detailed weather ${[...grids.values()].filter(g=>g.quality==='fine').length}/${total} times ready. Global preview remains available.`;
   }
   $('weatherDetailStatus').textContent='Detailed weather ready for this view.';
  }catch(e){if(valid()){$('weatherDetailStatus').textContent='Detailed weather delayed; using the global preview. Retry loading this view to try again.';$('retryBuffer').hidden=false;}}
 }
 playLabel(){$('weatherPlay').textContent=this.playing?'Pause':'Play';}
 error(e){$('weatherLoad').textContent=e.message+' — retry weather.';$('weatherRetry').hidden=false;this.playing=false;this.playLabel();$('prepareStatus').textContent=e.message+' — retry weather in Settings.';}
 refresh(force=false){
  if(!this.data.meta)return;updateForecastClock(this.data.meta,this.displayFrame??this.frame,this.context().centre);
  const c=this.context(),r=c.region,key=[r.west,r.north,r.lonSpan,r.latSpan].map(v=>v.toFixed(3)).join('/');
  const terrain=c.preloadStatus(),changed=terrain.key!==this.terrainKey;this.terrainKey=terrain.key;
  if(!force&&key===this.regionKey){if(changed&&!this.monitoringTerrain&&!this.loading&&terrain.ready<terrain.total)this.prepare();return;}
  this.data.setRegion?.(JSON.stringify(r));this.regionKey=key;this.region=r;this.prepareId=(this.prepareId||0)+1;this.preparing=true;this.prepared=null;$('prepareStatus').hidden=false;$('prepareStatus').textContent='Loading weather for this view… You can keep moving around.';
  // Keep the previous forecast moving in its own geographic footprint. Rebase
  // its geometry with the camera instead of applying old weather to new land.
  if(this.current){const b=c.bounds(this.current.region);if(!this.bounds||b.west!==this.bounds.west||b.north!==this.bounds.north||b.east!==this.bounds.east)this.build(true);}
  this.load(this.requestedFrame??this.frame,true);
 }
 async load(frame,moved=false){
  if(!this.data.meta||!this.region)return;this.data.prioritise?.(frame);const token=++this.token;this.requestedFrame=frame;this.loading=true;
  $('weatherLoad').textContent='Loading IFS for this view…';$('weatherRetry').hidden=true;
  try{const prepared=this.prepared?.region===this.regionKey?this.prepared.grids.get(frame):null;let grid=prepared||await this.data.grid(frame,this.region,129,()=>token===this.token);if(token!==this.token)return;const detail=this.prepared?.region===this.regionKey?this.prepared.grids.get(frame):null;if(detail?.quality==='fine')grid=detail;
   const old=this.current,oldFrame=this.frame;
   this.timeTransition=Boolean(!moved&&old&&this.playing&&frame===oldFrame+1);
   this.fromFrame=this.timeTransition?oldFrame:frame;
   this.current=grid;this.previous=!moved&&old&&(this.timeTransition||frame===oldFrame)?old:grid;this.frame=frame;this.blend=this.previous===grid?1:0;
   this.build(moved);this.group.visible=true;this.loading=false;this.elapsed=0;
   this.updateTimeDisplay();
   $('weatherLoad').textContent=(grid.quality==='coarse'?'IFS 1° global preview · run ':'IFS 0.1° · run ')+this.data.meta.initial_utc.slice(0,16).replace('T',' ')+' UTC';this.readout();if(moved||this.prepared?.region!==this.regionKey)this.prepare();
  }catch(e){if(token===this.token){this.loading=false;if(this.playing){this.elapsed=0;this.retryWait=3;$('weatherLoad').textContent='Waiting for the next weather frame… Retrying automatically.';$('weatherRetry').hidden=false;}else this.error(e);}}
 }
 texture(grid,keys){const pressure=keys.includes('pressure')?pressureAnomalies(grid.fields.pressure,grid.n):null;const a=new Float32Array(grid.n*grid.n*4);for(let i=0;i<grid.n*grid.n;i++)keys.forEach((k,j)=>a[i*4+j]=k==='pressure'?pressure[i]:grid.fields[k][i]);const t=new THREE.DataTexture(a,grid.n,grid.n,THREE.RGBAFormat,THREE.FloatType);t.minFilter=t.magFilter=THREE.LinearFilter;t.needsUpdate=true;return t;}
 build(moved){
  for(const mesh of this.meshes){this.group.remove(mesh);mesh.geometry.dispose();mesh.material.dispose();}this.meshes=[];
  for(const t of this.textures||[])t.dispose();
  this.textures=[this.texture(this.previous,['low','middle','high','rain']),this.texture(this.current,['low','middle','high','rain']),this.texture(this.previous,['temperature','pressure','u','v']),this.texture(this.current,['temperature','pressure','u','v'])];
  const context=this.context(),r=this.current.region;this.bounds=context.bounds(r);this.ground=context.ground;
  const {west,east,north,south}=this.bounds,w=east-west,h=south-north;
  this.uniforms={cloudA:{value:this.textures[0]},cloudB:{value:this.textures[1]},surfaceA:{value:this.textures[2]},surfaceB:{value:this.textures[3]},blend:{value:this.blend},clock:{value:0},mode:{value:0},isobars:{value:0},isobarStep:{value:2},weatherGridSize:{value:this.current.n},extent:{value:new THREE.Vector2(w,h)}};
  const geometry=(alt=0)=>{const g=new THREE.PlaneGeometry(w,h,64,64);g.rotateX(-Math.PI/2);const p=g.attributes.position,uv=g.attributes.uv;for(let i=0;i<p.count;i++){const x=p.getX(i)+(west+east)/2,z=p.getZ(i)+(north+south)/2;p.setXYZ(i,x,Math.max(0,this.ground(x,z))+(alt||.07),z);uv.setY(i,1-uv.getY(i));}g.userData.alt=alt||.07;g.userData.terrainRevision=context.terrainRevision;g.computeBoundingSphere();return g;};
  const vertex=`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
  this.surfaceUniforms??={};
  for(const [key,uniform]of Object.entries(this.uniforms)){this.surfaceUniforms[key]??={value:uniform.value};this.surfaceUniforms[key].value=uniform.value;}
  this.surfaceUniforms.weatherBounds??={value:new THREE.Vector4()};this.surfaceUniforms.weatherBounds.value.set(west,north,w,h);
  this.attachSurfaces();
  this.clouds=[];
  // Smooth forecast coverage: synthetic fine noise stretched into horizontal
  // streaks in oblique views. Schematic heights are not forecast cloud bases.
  for(let layer=0;layer<3;layer++)for(let slab=0;slab<3;slab++){
   const uniforms={...this.uniforms,layer:{value:layer},slab:{value:slab},opacity:{value:layer===2?.12:.23}};
   const mesh=new THREE.Mesh(geometry([1.2,4,8][layer]+slab*[.3,.5,.35][layer]),new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,uniforms,vertexShader:vertex,fragmentShader:`varying vec2 vUv;uniform sampler2D cloudA,cloudB;uniform float blend,layer,slab,clock,opacity;uniform vec2 extent;
void main(){vec4 c=mix(texture2D(cloudA,vUv),texture2D(cloudB,vUv),blend);float cover=layer<.5?c.r:layer<1.5?c.g:c.b;float edge=smoothstep(0.,.025,vUv.x)*smoothstep(0.,.025,vUv.y)*smoothstep(0.,.025,1.-vUv.x)*smoothstep(0.,.025,1.-vUv.y);float a=smoothstep(.02,.85,cover)*cover*opacity*edge;gl_FragColor=vec4(vec3(.84,.88,.92),a);\n#include <colorspace_fragment>\n}`}));
   mesh.userData.layer=layer;this.clouds.push(mesh);this.meshes.push(mesh);this.group.add(mesh);
  }
  if(!this.wind)this.makeWind();if(!this.drops)this.makeRain();
  if(moved)this.streaks?.reset();
  if(moved||!this.particles.length){this.particles=Array.from({length:N},()=>this.spawn());this.rain=Array.from({length:900},()=>this.spawnRain());}
  this.isobarLines??=new IsobarLines(this.group);this.isobarLines.key='';this.isobarLines.elapsed=2;this.options();
 }
 attachSurfaces(){
  for(const mesh of this.context().terrainMeshes()){
   const material=mesh.material;if(material.userData.weather)continue;material.userData.weather=true;
   const beforeCompile=material.onBeforeCompile;
   material.onBeforeCompile=shader=>{
    beforeCompile.call(material,shader);
    // Only attach weather inputs. The coarse terrain owns an `extent` vec4;
    // copying all view uniforms replaced it with the weather extent vec2.
    for(const key of ['surfaceA','surfaceB','cloudA','cloudB','blend','mode','isobars','isobarStep','weatherGridSize','weatherBounds'])shader.uniforms[key]=this.surfaceUniforms[key];
    shader.vertexShader='varying vec3 weatherPosition;\n'+shader.vertexShader;
    // Coarse relief displaces its vertices in its own shader rather than the
    // standard material chunks. Sample weather at those same world positions.
    if(material.userData.coarseRelief){
     shader.vertexShader=shader.vertexShader.replace('gl_Position=projectionMatrix*modelViewMatrix*vec4(p.x,elevation*.0015,p.y,1.);','weatherPosition=vec3(p.x,elevation*.0015,p.y);gl_Position=projectionMatrix*modelViewMatrix*vec4(weatherPosition,1.);');
     shader.fragmentShader=shader.fragmentShader.replace('gl_FragColor=vec4(elevation<.1?sea:c*shade,1.);','vec4 diffuseColor=vec4(elevation<.1?sea:c*shade,1.);\n#include <color_fragment>\ngl_FragColor=diffuseColor;');
    }
    shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>','weatherPosition=(modelMatrix*vec4(transformed,1.)).xyz;\n#include <project_vertex>');
    shader.fragmentShader='varying vec3 weatherPosition; uniform sampler2D surfaceA,surfaceB,cloudA,cloudB; uniform float blend,mode,isobars,isobarStep,weatherGridSize; uniform vec4 weatherBounds;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
     vec2 weatherUV=(weatherPosition.xz-weatherBounds.xy)/weatherBounds.zw;
     if(all(greaterThanEqual(weatherUV,vec2(0)))&&all(lessThanEqual(weatherUV,vec2(1)))){
      vec2 sampleUV=(weatherUV*(weatherGridSize-1.)+.5)/weatherGridSize;
      vec4 s=mix(texture2D(surfaceA,sampleUV),texture2D(surfaceB,sampleUV),blend);
      float rain=mix(texture2D(cloudA,sampleUV).a,texture2D(cloudB,sampleUV).a,blend);
      vec3 colour=diffuseColor.rgb;float alpha=0.;
      if(mode>.5&&mode<1.5){colour=mix(vec3(.10,.35,.85),vec3(.95,.27,.08),clamp((s.r+10.)/45.,0.,1.));alpha=.48;}
      else if(mode>1.5&&mode<2.5){colour=mix(vec3(.18,.65,.72),vec3(1.,.38,.04),clamp(length(s.ba)/25.,0.,1.));alpha=.48;}
      else if(mode>2.5){colour=mix(vec3(.1,.5,1.),vec3(.8,.15,.85),clamp(rain/10.,0.,1.));alpha=clamp(sqrt(rain)*.35,0.,.7);}
      diffuseColor.rgb=mix(diffuseColor.rgb,colour,alpha);

     }`);
   };
   material.customProgramCacheKey=()=> 'local-weather-g-'+Boolean(material.userData.coarseRelief);material.needsUpdate=true;
  }
 }
 sample(name,x,z){if(!this.current)return NaN;const b=this.bounds,n=this.current.n,px=(x-b.west)/(b.east-b.west)*(n-1),py=(z-b.north)/(b.south-b.north)*(n-1);return bilinear(this.previous.fields[name],n,px,py)*(1-this.blend)+bilinear(this.current.fields[name],n,px,py)*this.blend;}
 spawn(){const b=this.bounds,c=this.liveContext||this.context(),distance=c.distance,r=Math.min(distance*.9,Math.max(b.east-b.west,b.south-b.north)/2);let x,z;
  // Most particles stay near the camera target; a quarter cover the whole footprint.
  if(Math.random()<.75){x=clamp(c.target.x+(Math.random()-.5)*r*2,b.west,b.east);z=clamp(c.target.z+(Math.random()-.5)*r*2,b.north,b.south);}else{x=b.west+Math.random()*(b.east-b.west);z=b.north+Math.random()*(b.south-b.north);}
  return {x,z,age:Math.random()*12,history:Array.from({length:L},()=>[x,Math.max(0,this.ground(x,z))+.15,z])};
 }
 makeWind(){
  // Weather3D's screen-space ribbon technique keeps trails legible at any zoom.
  const count=N*(L-1),g=new THREE.InstancedBufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([0,-1,0,1,-1,0,0,1,0,1,1,0],3));g.setIndex([0,1,2,2,1,3]);
  for(const [name,size]of [['start',3],['end',3],['tint',3],['width',1],['fade',1]])g.setAttribute(name,new THREE.InstancedBufferAttribute(new Float32Array(count*size),size).setUsage(THREE.DynamicDrawUsage));g.instanceCount=count;
  const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,uniforms:{viewport:{value:new THREE.Vector2()}},vertexShader:`attribute vec3 start,end,tint;attribute float width,fade;uniform vec2 viewport;varying vec3 colour;varying float edge,alpha;void main(){vec4 a=projectionMatrix*modelViewMatrix*vec4(start,1.),b=projectionMatrix*modelViewMatrix*vec4(end,1.);colour=tint;edge=position.y;alpha=fade;if(a.w<=0.||b.w<=0.){gl_Position=vec4(2,2,2,1);return;}vec2 d=(b.xy/b.w-a.xy/a.w)*viewport;vec2 normal=length(d)>.001?normalize(vec2(-d.y,d.x)):vec2(0);vec4 p=mix(a,b,position.x);p.xy+=normal*position.y*width/viewport*p.w;gl_Position=p;}`,fragmentShader:`varying vec3 colour;varying float edge,alpha;void main(){gl_FragColor=vec4(colour,alpha*(1.-smoothstep(.6,1.,abs(edge))));\n#include <colorspace_fragment>\n}`});
  this.wind=new THREE.Mesh(g,material);this.wind.frustumCulled=false;this.group.add(this.wind);
 }
 spawnRain(){const p=this.spawn();return {x:p.x,z:p.z,phase:Math.random()};}
 makeRain(){this.streaks=new PrecipitationStreaks(this.group);this.precipitation=makePrecipitation(this.group,900);this.drops=this.precipitation.rain.obj;this.flakes=this.precipitation.snow.obj;}

 options(){if(!this.current)return;this.wind.visible=$('windLayer').checked;this.drops.visible=this.flakes.visible=$('rainLayer').checked&&$('precipitationStyle').value==='symbols';this.streaks.visible($('rainLayer').checked&&$('precipitationStyle').value==='streaks');for(const c of this.clouds)c.visible=$(['cloudLow','cloudMiddle','cloudHigh'][c.userData.layer]).checked;this.uniforms.mode.value=['none','temperature','wind','rain'].indexOf($('surfaceField').value);this.uniforms.isobars.value=+$('pressureLayer').checked;this.surfaceUniforms.mode.value=this.uniforms.mode.value;this.surfaceUniforms.isobars.value=this.uniforms.isobars.value;for(const c of this.clouds)c.material.uniforms.opacity.value=(c.userData.layer===2?.12:.23)*Number($('cloudOpacity').value)/100;}
 readout(){const c=this.context(),b=this.bounds;if(c.target.x<b.west||c.target.x>b.east||c.target.z<b.north||c.target.z>b.south){$('weather').textContent='Loading weather at view centre…';return;}const v=k=>this.sample(k,c.target.x,c.target.z);$('weather').textContent=`At view centre · interpolated IFS\nWind ${Math.hypot(v('u'),v('v')).toFixed(1)} m/s · ${v('temperature').toFixed(1)} °C\nMSL ${v('pressure').toFixed(1)} hPa · precip ${v('rain').toFixed(2)} mm/h\nCloud low / middle / high: ${['low','middle','high'].map(k=>Math.round(v(k)*100)+'%').join(' / ')}`;}
 updateTimeDisplay(){
  this.displayFrame=this.timeTransition?this.fromFrame+(this.frame-this.fromFrame)*this.blend:this.frame;
  $('forecastTime').value=this.displayFrame;
  updateForecastClock(this.data.meta,this.displayFrame,this.context().centre);
 }
 advanceTime(dt){
  this.elapsed+=dt;
  if(this.timeTransition){if(this.playing)this.blend=Math.min(1,this.blend+dt*Number($('playbackSpeed').value)/3);}
  else this.blend=Math.min(1,this.blend+dt/1.2);
  if(this.playing&&!this.loading&&this.blend===1){
   if(this.retryWait>0){this.retryWait=Math.max(0,this.retryWait-dt);return;}
   if(this.frame===this.data.meta.times.length-1){this.playing=false;this.playLabel();}
   else this.load(this.frame+1);
  }
 }
 tick(dt){
  if(!this.current||!this.group.visible)return;this.liveContext=this.context();const viewWidth=2*this.liveContext.distance*Math.tan(this.liveContext.camera.fov*Math.PI/360)*this.liveContext.camera.aspect;this.isobarSpacing=isobarInterval(viewWidth,this.isobarSpacing);this.surfaceUniforms.isobarStep.value=this.isobarSpacing;this.advanceTime(dt);this.updateTimeDisplay();this.uniforms.blend.value=this.blend;this.surfaceUniforms.blend.value=this.blend;this.uniforms.clock.value+=dt;this.isobarLines?.update(this,dt,this.isobarSpacing,$('pressureLayer').checked);
  this.readClock=(this.readClock||0)+dt;if(this.readClock>.4){this.readClock=0;this.readout();}
  this.terrainClock=(this.terrainClock||0)+dt;
  if(this.terrainClock>2){this.terrainClock=0;this.attachSurfaces();}
  updateCloudTerrain(this.meshes,this.ground,this.liveContext.terrainRevision);
  this.wind.material.uniforms.viewport.value.set(innerWidth,innerHeight);
  // Fixed-rate histories avoid display refresh rate changing trail length.
  this.accumulator=(this.accumulator||0)+dt;if(this.accumulator<1/30)return;const step=Math.min(.1,this.accumulator);this.accumulator=0;
  this.streaks.update(this,step);
  const b=this.bounds,attrs=this.wind.geometry.attributes,distance=this.liveContext.distance,speed=2*Math.max(.06,distance*.006);
  const windCount=particleBudget(N,distance);
  this.wind.geometry.instanceCount=windCount*(L-1);
  if(this.activeWindCount!==undefined&&windCount>this.activeWindCount)for(let i=this.activeWindCount;i<windCount;i++)this.particles[i]=this.spawn();
  this.activeWindCount=windCount;
  if(this.wind.visible)for(let i=0;i<windCount;i++){
   let p=this.particles[i],u=this.sample('u',p.x,p.z),v=this.sample('v',p.x,p.z);p.x+=u*step*speed;p.z-=v*step*speed;p.age+=step;
   if(p.age>18||p.x<b.west||p.x>b.east||p.z<b.north||p.z>b.south)p=this.particles[i]=this.spawn();
   const point=p.history.pop();point[0]=p.x;point[1]=Math.max(0,this.ground(p.x,p.z))+.15;point[2]=p.z;p.history.unshift(point);
   const strength=clamp(Math.hypot(u,v)/25,0,1),colour=new THREE.Color().setRGB(1,1-strength*.35,.85-strength*.8);
   for(let j=0;j<L-1;j++){const k=i*(L-1)+j;attrs.start.setXYZ(k,...p.history[j]);attrs.end.setXYZ(k,...p.history[j+1]);attrs.tint.setXYZ(k,colour.r,colour.g,colour.b);attrs.width.setX(k,1+strength*2);attrs.fade.setX(k,(1-j/L)*.9);}
  }
  if(this.wind.visible)for(const name of ['start','end','tint','width','fade'])updateParticleAttribute(attrs[name],windCount*(L-1));
  if(this.drops.visible){
   const {rain:drops,snow:flakes,overhead,distanceEmphasis}=this.precipitation;
   const view=this.context(),direction=this.cameraDirection??=new THREE.Vector3();
   direction.copy(view.target).sub(view.camera.position).normalize();
   const tilt=Math.sqrt(1-direction.y*direction.y);
   distanceEmphasis.value=THREE.MathUtils.smoothstep(distance,20,70)*THREE.MathUtils.smoothstep(tilt,.15,.65);
   overhead.value=1-THREE.MathUtils.smoothstep(tilt,.15,.45);
   drops.viewport.set(innerWidth,innerHeight);drops.screenScale.value=4/3;drops.lengthScale.value=.5;flakes.mat.uniforms.pixelRatio.value=Math.min(devicePixelRatio,2);
   let nr=0,ns=0;
   for(let i=0;i<particleBudget(this.rain.length,distance);i++){
    let p=this.rain[i];const rain=this.sample('rain',p.x,p.z),snow=this.sample('snow',p.x,p.z),isSnow=(i%100)/100<clamp(snow/Math.max(.001,rain),0,1);
    p.x+=step*this.sample('u',p.x,p.z)*.02;p.z-=step*this.sample('v',p.x,p.z)*.02;
    p.phase-=step*(isSnow?.18:.55);if(p.phase<0){this.rain[i]=this.spawnRain();continue;}
    if(rain<.05||((i*37)%101)/101>precipitationDensity(rain))continue;
    const ground=Math.max(0,this.ground(p.x,p.z)),y=ground+.05+p.phase*.5,alpha=.6;
    if(isSnow){flakes.position.setXYZ(ns,p.x,y,p.z);flakes.opacity.setX(ns,alpha);flakes.flakeSize.setX(ns++,.8*1.33);}
    else{const length=Math.min(.5*(1-p.phase),.3);drops.head.setXYZ(nr,p.x,y,p.z);drops.tail.setXYZ(nr,p.x-this.sample('u',p.x,p.z)*.001,y+length,p.z+this.sample('v',p.x,p.z)*.001);drops.widthScale.setX(nr,.55);drops.opacity.setX(nr++,alpha);}
   }
   drops.g.instanceCount=nr;flakes.g.setDrawRange(0,ns);
   for(const a of [drops.head,drops.tail,drops.widthScale,drops.opacity,flakes.position,flakes.opacity,flakes.flakeSize])a.needsUpdate=true;

  }
 }
}
