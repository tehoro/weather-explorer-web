import * as THREE from 'three';
// Same OLR frames, opacity transfer and three forecast hours/second as app.js.
export class GlobeClouds{
 constructor(globe,clock){
  this.clock=clock;this.textures=[];this.pos=0;this.held=0;
  this.uniforms={A:{value:null},B:{value:null},mixT:{value:0}};
  const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:this.uniforms,
   vertexShader:'varying vec2 coord;void main(){coord=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
   fragmentShader:`uniform sampler2D A,B;uniform float mixT;varying vec2 coord;void main(){
    vec2 uv=vec2(fract(coord.x+.5/720.),(coord.y*360.+.5)/361.);
    float v=mix(texture2D(A,uv).r,texture2D(B,uv).r,mixT);
    gl_FragColor=vec4(vec3(1.),smoothstep(.22,.85,v)*.92);
   }`});
  this.mesh=new THREE.Mesh(new THREE.SphereGeometry(1.003,128,96),material);this.mesh.visible=false;globe.add(this.mesh);
  this.load().catch(()=>{clock.textContent='Cloud forecast unavailable';});
 }
 async load(){
  const r=await fetch('data/globe/meta.json');if(!r.ok)throw Error();const m=await r.json();
  this.times=m.frames.map(f=>Date.parse(f.valid_time));this.first=0;
  this.times.forEach((t,i)=>{if(t<=Date.now())this.first=i;});
  this.last=Math.max(this.first,this.times.findLastIndex(t=>t<=this.times[this.first]+72*3600000));this.pos=this.first;
  for(let i=this.first;i<=this.last;i++){
   try{const tex=await new THREE.TextureLoader().loadAsync(`data/${m.path}/${String(i).padStart(3,'0')}.webp`);tex.wrapS=THREE.RepeatWrapping;tex.minFilter=tex.magFilter=THREE.LinearFilter;this.textures[i]=tex;}catch{}
  }
 }
 tick(dt,reduced){
  const i=Math.floor(this.pos),a=this.textures[i];if(!a)return;
  if(!reduced){if(this.pos>=this.last){this.held+=dt;if(this.held>1.5){this.held=0;this.pos=this.first;}}
   else if(this.textures[i+1])this.pos=Math.min(this.last,this.pos+dt*3/((this.times[i+1]-this.times[i])/3600000));}
  const f=Math.floor(this.pos);this.uniforms.A.value=this.textures[f];this.uniforms.B.value=this.textures[Math.min(this.last,f+1)]||this.textures[f];this.uniforms.mixT.value=this.pos-f;this.mesh.visible=true;
  this.clock.textContent='Cloud forecast · '+new Date(this.times[Math.round(this.pos)]).toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'});
 }
}
