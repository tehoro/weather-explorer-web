import * as THREE from 'three';
import {forecastUrl} from './forecast-host.mjs';
import {chooseLod} from './cloud-tile-grid.mjs';
import {detailNoise} from './cloud-detail.mjs';
import {vertex,fragment} from './cloud-volume-shader.mjs';
import {composite} from './cloud-composite.mjs';
const TOP=20,G=65,V=128;
const texture=raw=>{const t=new THREE.Data3DTexture(new Uint8Array(raw),G,V,G);t.format=THREE.RGBAFormat;t.minFilter=t.magFilter=THREE.LinearFilter;t.unpackAlignment=1;t.needsUpdate=true;return t;};
export class CloudVolumes{
 constructor(weather){
  this.weather=weather;this.serial=0;this.lod=0;this.readyKey='';this.pending='';this.retry=0;this.manifests=new Map();this.pairs=new Map();
  this.worker=new Worker(new URL('./cloud-volume-worker.mjs',import.meta.url),{type:'module'});
  this.worker.onmessage=({data:r})=>{if(r.id!==this.serial)return;clearTimeout(this.deadline);this.pending='';if(r.error){this.failedRequest();return;}
   const pair={...this.requestInfo,a:texture(r.a),b:texture(r.b)};this.pairs.set(this.requestKey,pair);this.retry=0;this.failedKey='';
   // Keep the displayed pair and one neighbour on either side. Never dispose a bound texture.
   while(this.pairs.size>3){const key=[...this.pairs.keys()].find(k=>k!==this.readyKey&&k!==this.requestKey);const old=this.pairs.get(key);old.a.dispose();old.b.dispose();this.pairs.delete(key);}
  };
  this.worker.onerror=()=>this.failedRequest();
  const noise=new THREE.Data3DTexture(detailNoise(),48,48,48);noise.format=THREE.RedFormat;noise.minFilter=noise.magFilter=THREE.LinearFilter;noise.wrapS=noise.wrapT=noise.wrapR=THREE.RepeatWrapping;noise.unpackAlignment=1;noise.needsUpdate=true;
  this.depth=new THREE.WebGLRenderTarget(1,1);this.depth.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);
  this.u={texA:{value:null},texB:{value:null},detailMap:{value:noise},mixTime:{value:0},standardBlend:{value:1},volumeReady:{value:0},standardA:{value:null},standardB:{value:null},weatherUV:{value:new THREE.Vector4()},enabledBands:{value:new THREE.Vector3(1,1,1)},opacity:{value:.65},tint:{value:0},fixedMode:{value:0},areaWidth:{value:1},areaSize:{value:new THREE.Vector2()},top:{value:TOP},detailEnabled:{value:1},adaptiveOpacity:{value:1},groundSize:{value:G},groundMap:{value:null},terrainDepth:{value:this.depth.depthTexture},viewport:{value:new THREE.Vector2()},cameraToLocal:{value:new THREE.Matrix4()},inverseProjection:{value:new THREE.Matrix4()},camLocal:{value:new THREE.Vector3()},cameraFar:{value:12000},logarithmicDepth:{value:1}};
  this.material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,uniforms:this.u,vertexShader:vertex,fragmentShader:fragment,transparent:true,depthWrite:false,depthTest:false,side:THREE.BackSide});
  this.material.userData.logDepthReady=true;
  this.mesh=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),this.material);this.mesh.renderOrder=2;this.mesh.frustumCulled=false;weather.group.add(this.mesh);
  this.mesh.onBeforeRender=(renderer,scene,camera)=>{this.mesh.updateMatrixWorld();this.u.camLocal.value.copy(camera.position);this.mesh.worldToLocal(this.u.camLocal.value);this.u.cameraToLocal.value.copy(this.mesh.matrixWorld).invert().multiply(camera.matrixWorld);this.u.inverseProjection.value.copy(camera.projectionMatrixInverse);this.u.cameraFar.value=camera.far;this.u.logarithmicDepth.value=+renderer.capabilities.logarithmicDepthBuffer;const target=renderer.getRenderTarget();if(target)this.u.viewport.value.set(target.width,target.height);else renderer.getDrawingBufferSize(this.u.viewport.value);};
  const status=document.createElement('p');status.id='cloudStatus';status.innerHTML='<small>Standard cloud layers.</small>';document.getElementById('cloudOpacity').after(status);this.status=status;
 }
 setStatus(text){if(this.status.textContent!==text)this.status.textContent=text;}
 failedRequest(){this.failedKey=this.requestKey;if(this.readyKey){clearTimeout(this.deadline);this.pending='';this.serial++;this.retry=performance.now()+60000;}else this.fallback();}
 fallback(){clearTimeout(this.deadline);this.pending='';this.serial++;this.readyKey='';this.u.volumeReady.value=0;this.retry=performance.now()+60000;this.setStatus('Standard cloud layers · detailed cloud data unavailable.');}
 bind(){const w=this.weather,c=w.context(),b=w.bounds,r=w.current.region,margin=100;
  const dx=margin/(b.east-b.west)*r.lonSpan,dy=margin/(b.south-b.north)*r.latSpan;
  const north=Math.min(90,r.north+dy),south=Math.max(-90,r.north-r.latSpan-dy);
  this.region={west:r.west-dx,north,lonSpan:Math.min(359,r.lonSpan+2*dx),latSpan:north-south};
  this.bounds=c.bounds(this.region);const q=this.bounds,width=q.east-q.west,height=q.south-q.north;
  this.mesh.scale.set(width,TOP*(c.cloudScale||1),height);this.mesh.position.set((q.west+q.east)/2,TOP*(c.cloudScale||1)/2,(q.north+q.south)/2);this.u.areaSize.value.set(width,height);
  this.u.weatherUV.value.set((q.west-b.west)/(b.east-b.west),(q.north-b.north)/(b.south-b.north),width/(b.east-b.west),height/(b.south-b.north));
  this.u.standardA.value=w.textures[0];this.u.standardB.value=w.textures[1];this.updateGround(c);
 }
 updateGround(c){const w=this.weather,b=this.bounds,key=JSON.stringify(b)+'/'+c.terrainRevision+'/'+document.getElementById('terrainScale').value;if(key===this.groundKey)return;this.groundKey=key;const a=new Float32Array(G*G),scale=Number(document.getElementById('terrainScale').value)||1;for(let j=0;j<G;j++)for(let i=0;i<G;i++)a[j*G+i]=Math.max(0,c.ground(b.west+i/(G-1)*(b.east-b.west),b.north+j/(G-1)*(b.south-b.north)))/scale;this.u.groundMap.value?.dispose();const t=new THREE.DataTexture(a,G,G,THREE.RedFormat,THREE.FloatType);t.minFilter=t.magFilter=THREE.LinearFilter;t.needsUpdate=true;this.u.groundMap.value=t;}
 async manifest(run){let entry=this.manifests.get(run);if(entry&&entry.expires>performance.now())return entry.value;const r=await fetch(await forecastUrl(`/global-data/${run}/cloud-v2/manifest.json`),{cache:'no-store',signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('Cloud manifest unavailable');const m=await r.json();if(m.version!==2||m.run!==run||m.vertical!==V||m.topKm!==TOP||m.channels!==4)throw Error('Invalid cloud manifest');this.manifests.set(run,{value:m,expires:performance.now()+300000});return m;}
 async request(key,i,j,region,level,domain){const id=++this.serial;this.pending=key;this.requestKey=key;this.requestInfo={i,domain};clearTimeout(this.deadline);this.deadline=setTimeout(()=>{if(id===this.serial)this.failedRequest();},45000);try{const m=await this.manifest(this.weather.data.meta.run);if(id!==this.serial)return;const steps=[this.weather.data.meta.steps[i],this.weather.data.meta.steps[j]];if(!steps.every(s=>m.steps.includes(s)))throw Error('Cloud time unavailable');this.worker.postMessage({id,run:m.run,steps,region,G,V,level,res:m.levels[level]});}catch(e){if(id===this.serial){this.pending='';this.failedRequest();}}}
 tick(){const w=this.weather;if(!w.current)return;const c=w.context(),b=w.bounds;this.mesh.scale.y=TOP*(c.cloudScale||1);this.mesh.position.y=TOP*(c.cloudScale||1)/2;this.updateGround(c);const states=['cloudLow','cloudMiddle','cloudHigh'].map(id=>+document.getElementById(id).checked);this.u.enabledBands.value.set(...states);this.u.opacity.value=Number(document.getElementById('cloudOpacity').value)/100;this.mesh.visible=states.some(Boolean)&&this.u.opacity.value>0;this.u.standardBlend.value=w.blend;
  const f=w.displayFrame??w.frame,i=Math.min(w.data.meta.steps.length-2,Math.floor(f));this.lod=chooseLod(c.distance,this.lod);
  const domain=w.data.meta.run+'/'+JSON.stringify(this.region)+'/'+this.lod,key=domain+'/'+i;this.desiredKey=key;
  const pair=this.pairs.get(key);
  if(pair){this.readyKey=key;this.u.texA.value=pair.a;this.u.texB.value=pair.b;}
  const active=this.pairs.get(this.readyKey),holding=key!==this.failedKey&&active&&active.domain===domain&&Math.abs(active.i-i)<=1;
  this.u.mixTime.value=Math.max(0,Math.min(1,f-(active?.i??i)));this.u.volumeReady.value=+(!!pair||!!holding);
  if(pair)this.setStatus('Humidity-guided clouds · liquid/ice optical thickness.');
  else if(holding)this.setStatus('Liquid/ice clouds · holding last time while loading…');
  else if(this.retry)this.setStatus('Standard cloud layers · detailed cloud data unavailable.');
  else this.setStatus('Standard cloud layers · preparing detailed clouds…');
  if(this.mesh.visible&&!this.pending&&performance.now()>=this.retry){
   // Fetch the next interval while displaying this one, including when paused.
   const next=pair?i+1:i,nextKey=domain+'/'+next;
   if(next<w.data.meta.steps.length-1&&!this.pairs.has(nextKey))void this.request(nextKey,next,next+1,this.region,this.lod,domain);
  }
 }
 async ensure(signal){
  this.tick();
  while(this.mesh.visible&&!this.pairs.has(this.desiredKey)&&this.pending){signal?.throwIfAborted();await new Promise(resolve=>setTimeout(resolve,30));this.tick();}
  signal?.throwIfAborted();this.tick();
 }
 render(renderer,scene,camera,fullQuality=this.weather.exporting){
  if(!this.mesh.visible||!this.weather.group.visible){renderer.render(scene,camera);return;}
  const size=renderer.getDrawingBufferSize(this.renderSize??=new THREE.Vector2());
  camera.updateMatrixWorld();scene.updateMatrixWorld();
  const context=this.weather.context(),terrain=context.terrainMeshes();
  // Geometry, projection and viewport determine depth. Forecast colours do not.
  const depthKey=[size.x,size.y,context.terrainRevision,...camera.matrixWorld.elements,...camera.projectionMatrix.elements,
   ...terrain.flatMap(o=>[o.id,o.visible,...o.matrixWorld.elements]),this.mesh.scale.y].join('/');
  const target=renderer.getRenderTarget(),hidden=[];
  const isolate=keep=>scene.traverse(o=>{if(o.visible&&(o.isMesh||o.isLine||o.isPoints||o.isSprite)&&!keep.has(o)){hidden.push(o);o.visible=false;}});
  const restore=()=>{for(const o of hidden)o.visible=true;hidden.length=0;};
  if(depthKey!==this.depthKey){
   if(this.depth.width!==size.x||this.depth.height!==size.y)this.depth.setSize(size.x,size.y);
   // Detailed tiles have baked positions. Skip their lighting, snow and colour
   // shading for depth; keep custom/displaced materials on their original path.
   const swapped=[];this.depthMaterials??=new Map();
   const depthTerrain=terrain.filter(o=>Array.isArray(o.material)||o.material.depthWrite);
   for(const o of depthTerrain){const m=o.material;
    if(m.isMeshStandardMaterial&&!m.displacementMap&&!m.alphaTest){
     let d=this.depthMaterials.get(m.side);if(!d){d=new THREE.MeshDepthMaterial({side:m.side,colorWrite:false});this.depthMaterials.set(m.side,d);}
     swapped.push([o,m]);o.material=d;
    }
   }
   isolate(new Set(depthTerrain));
   try{renderer.setRenderTarget(this.depth);renderer.render(scene,camera);this.depthKey=depthKey;}
   finally{renderer.setRenderTarget(target);restore();for(const [o,m] of swapped)o.material=m;}
  }
  // Export always uses the original full-resolution, 80-sample path.
  if(fullQuality){renderer.render(scene,camera);return;}
  if(!this.cloudTarget){
   this.cloudTarget=new THREE.WebGLRenderTarget(1,1,{depthBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
   this.compositeMaterial=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,uniforms:{...this.u,cloudImage:{value:this.cloudTarget.texture},cloudSize:{value:new THREE.Vector2()}},
    vertexShader:vertex,fragmentShader:fragment.replace('void main(){if(opacity','void traceCloud(){if(opacity')+composite,
    transparent:true,depthWrite:false,depthTest:false,side:THREE.BackSide});
   this.compositeMaterial.userData.logDepthReady=true;
  }
  const width=Math.max(1,Math.ceil(size.x/2)),height=Math.max(1,Math.ceil(size.y/2));
  const cloudKey=depthKey+'/'+[this.readyKey,this.u.mixTime.value,this.u.standardBlend.value,this.u.volumeReady.value,this.u.opacity.value,
   ...this.u.enabledBands.value.toArray(),this.u.detailEnabled.value,this.u.adaptiveOpacity.value,this.groundKey,
   this.weather.displayFrame??this.weather.frame,this.u.standardA.value?.uuid,this.u.standardB.value?.uuid,this.u.tint.value,this.u.fixedMode.value,...this.u.weatherUV.value.toArray(),...this.mesh.matrixWorld.elements].join('/');
  if(cloudKey!==this.cloudKey){
   if(this.cloudTarget.width!==width||this.cloudTarget.height!==height)this.cloudTarget.setSize(width,height);
   this.compositeMaterial.uniforms.cloudSize.value.set(width,height);
   const background=scene.background,alpha=renderer.getClearAlpha(),colour=renderer.getClearColor(new THREE.Color()).clone();
   isolate(new Set([this.mesh]));scene.background=null;
   // Store straight colour/alpha; the normal scene composite blends it once.
   const blending=this.material.blending;this.material.blending=THREE.NoBlending;
   try{renderer.setClearColor(0,0);renderer.setRenderTarget(this.cloudTarget);renderer.render(scene,camera);this.cloudKey=cloudKey;}
   finally{this.material.blending=blending;scene.background=background;renderer.setClearColor(colour,alpha);renderer.setRenderTarget(target);restore();}
  }
  this.mesh.material=this.compositeMaterial;
  try{renderer.render(scene,camera);}finally{this.mesh.material=this.material;}
 }
}
