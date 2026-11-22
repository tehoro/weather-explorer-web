import {frameAtTime,timeAtFrame} from './forecast-position.mjs';
import * as THREE from 'three';
// Same OLR frames, opacity transfer and three forecast hours/second as app.js.
export class GlobeClouds{
 constructor(globe,clock){
  this.clock=clock;this.textures=[];this.pending=new Map();this.heldTime=null;this.pos=0;this.held=0;
  this.uniforms={A:{value:null},B:{value:null},mixT:{value:0},grid:{value:new THREE.Vector2(720,361)}};
  const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,depthTest:false,uniforms:this.uniforms,
   vertexShader:'varying vec2 coord;void main(){coord=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
   fragmentShader:`uniform sampler2D A,B;uniform float mixT;uniform vec2 grid;varying vec2 coord;void main(){
    vec2 uv=vec2(coord.x+.5/grid.x,(coord.y*(grid.y-1.)+.5)/grid.y);
    float v=mix(texture2D(A,uv).r,texture2D(B,uv).r,mixT);
    gl_FragColor=vec4(vec3(1.),smoothstep(.22,.85,v)*.92);
   }`});
  this.mesh=new THREE.Mesh(new THREE.SphereGeometry(1.003,128,96),material);this.mesh.renderOrder=1;this.mesh.visible=false;globe.add(this.mesh);
  this.load().catch(()=>{clock.textContent='Cloud forecast unavailable';});
 }
 async load(){
  const r=await fetch('data/globe/meta.json');if(!r.ok)throw Error();const m=await r.json();
  this.meta=m;this.uniforms.grid.value.set(m.nx,m.ny);
  this.times=m.frames.map(f=>Date.parse(f.valid_time));this.first=0;
  this.times.forEach((t,i)=>{if(t<=Date.now())this.first=i;});
  this.last=Math.max(this.first,this.times.findLastIndex(t=>t<=this.times[this.first]+72*3600000));this.pos=this.first;
  this.requestHeld();
  for(let i=this.first;i<=this.last;i++)await this.texture(i).catch(()=>{});
 }
 texture(i){
  if(this.textures[i])return Promise.resolve(this.textures[i]);
  if(!this.pending.has(i))this.pending.set(i,new THREE.TextureLoader().loadAsync(`data/${this.meta.path}/${String(i).padStart(3,'0')}.webp`).then(tex=>{tex.wrapS=THREE.RepeatWrapping;tex.minFilter=THREE.LinearMipmapLinearFilter;tex.magFilter=THREE.LinearFilter;this.textures[i]=tex;return tex;}));
  return this.pending.get(i);
 }
 time(){return new Date(this.heldTime??(this.times?timeAtFrame(this.times,this.pos):Date.now())).toISOString();}
 hold(time){const t=Date.parse(time);this.heldTime=Number.isFinite(t)?t:Date.parse(this.time());this.requestHeld();}
 requestHeld(){if(this.heldTime==null||!this.times)return;const f=frameAtTime(this.times,this.heldTime);void Promise.all([this.texture(Math.floor(f)),this.texture(Math.ceil(f))]).catch(()=>{});}
 tick(dt,reduced){
  if(this.heldTime!=null){
   if(!this.times)return;
   const outside=this.heldTime<this.times[0]||this.heldTime>this.times.at(-1),position=frameAtTime(this.times,this.heldTime),a=Math.floor(position),b=Math.ceil(position);
   this.mesh.visible=!outside&&!!this.textures[a]&&!!this.textures[b];
   if(this.mesh.visible){this.uniforms.A.value=this.textures[a];this.uniforms.B.value=this.textures[b];this.uniforms.mixT.value=position-a;}
   this.clock.textContent=(outside?'Cloud forecast unavailable for ':this.mesh.visible?'Cloud forecast · ':'Loading cloud forecast · ')+new Date(this.heldTime).toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'});
   return;
  }
  const i=Math.floor(this.pos),a=this.textures[i];if(!a)return;
  if(!reduced){if(this.pos>=this.last){this.held+=dt;if(this.held>1.5){this.held=0;this.pos=this.first;}}
   else if(this.textures[i+1])this.pos=Math.min(this.last,this.pos+dt*3/((this.times[i+1]-this.times[i])/3600000));}
  const f=Math.floor(this.pos);this.uniforms.A.value=this.textures[f];this.uniforms.B.value=this.textures[Math.min(this.last,f+1)]||this.textures[f];this.uniforms.mixT.value=this.pos-f;this.mesh.visible=true;
  this.clock.textContent='Cloud forecast · '+new Date(this.times[f]+(this.times[Math.min(this.last,f+1)]-this.times[f])*(this.pos-f)).toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'});
 }
}
