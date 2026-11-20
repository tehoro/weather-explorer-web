import * as THREE from 'three';
import {pressureContours} from './pressure-contours.mjs';
import {pressureAnomalies} from './isobars.mjs';
import {pressureCentres,matchCentres,blendPressure,nearestContour} from './pressure-motion.mjs';
export class IsobarLines{
 constructor(group){
  this.resolution=new THREE.Vector2(innerWidth,innerHeight);
  this.object=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,uniforms:{resolution:{value:this.resolution}},vertexShader:`attribute vec3 other;attribute float side;uniform vec2 resolution;
void main(){vec4 a=projectionMatrix*modelViewMatrix*vec4(position,1.),b=projectionMatrix*modelViewMatrix*vec4(other,1.);vec2 d=(b.xy/b.w-a.xy/a.w)*resolution;float len=length(d);vec2 normal=len>0.?vec2(-d.y,d.x)/len:vec2(0.);a.xy+=normal*side*1.4/resolution*a.w;a.z-=.000002*a.w;gl_Position=a;}`,fragmentShader:`void main(){gl_FragColor=vec4(.9,.95,1.,.85);}`}));this.object.frustumCulled=false;group.add(this.object);this.key='';this.elapsed=0;this.anchors=[];
  this.canvas=document.createElement('canvas');this.canvas.id='isobarLabels';this.canvas.setAttribute('aria-label','Pressure contours and high and low centres');this.canvas.style.cssText='position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2';document.body.append(this.canvas);this.ctx=this.canvas.getContext('2d');
 }
 hide(){this.canvas.hidden=true;this.object.visible=false;}
 update(view,dt,interval,enabled){
  this.object.visible=enabled;this.canvas.hidden=!enabled;if(!enabled)return;this.elapsed+=dt;
  const key=[view.frame,view.blend.toFixed(3),interval,view.bounds.west,view.bounds.north].join('/');
  if(this.elapsed>=.05&&(key!==this.key||this.elapsed>=2)){
   this.elapsed=0;this.key=key;
   const n=view.current.n,b=view.bounds,kmX=(b.east-b.west)/(n-1),kmY=(b.south-b.north)/(n-1);
   const region=JSON.stringify(view.current.region);if(region!==this.region){this.region=region;this.anchors=[];}
   if(this.grid!==view.current||this.oldGrid!==view.previous){
    this.grid=view.current;this.oldGrid=view.previous;
    this.a=Float32Array.from(pressureAnomalies(view.previous.fields.pressure,n),v=>1000+v);this.b=Float32Array.from(pressureAnomalies(view.current.fields.pressure,n),v=>1000+v);
    const steps=view.data.meta.steps,hours=Math.abs(steps[view.current.frame]-steps[view.previous.frame]);
    this.matches=hours>0&&hours<=6?matchCentres(pressureCentres(this.a,n),pressureCentres(this.b,n),Math.abs(kmX),Math.abs(kmY),hours*100):[];
   }
   const pressure=blendPressure(this.a,this.b,n,view.blend,this.matches,Math.abs(kmX),Math.abs(kmY));
   this.segments=pressureContours(pressure,n,interval);this.centres=pressureCentres(pressure,n);
   const vertices=[];
   for(const segment of this.segments){
    // Terrain-draped segments retain depth testing in slanted views.
    const [a,c]=[segment.start,segment.end],steps=Math.max(4,Math.ceil(Math.hypot((c[0]-a[0])*kmX,(c[1]-a[1])*kmY)/.5));
    const point=t=>{const x=b.west+(a[0]+(c[0]-a[0])*t)*kmX,z=b.north+(a[1]+(c[1]-a[1])*t)*kmY;return [x,Math.max(0,view.ground(x,z))+.035,z];};
    let last=point(0);for(let i=1;i<=steps;i++){const next=point(i/steps);vertices.push(...last,...next);last=next;}
   }
   const positions=[],others=[],sides=[];
   for(let i=0;i<vertices.length;i+=6){const a=vertices.slice(i,i+3),b=vertices.slice(i+3,i+6);for(const [end,side] of [[0,-1],[0,1],[1,-1],[0,1],[1,1],[1,-1]]){positions.push(...(end?b:a));others.push(...(end?a:b));sides.push(end?-side:side);}}
   this.object.geometry.dispose();this.object.geometry=new THREE.BufferGeometry();this.object.geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));this.object.geometry.setAttribute('other',new THREE.Float32BufferAttribute(others,3));this.object.geometry.setAttribute('side',new THREE.Float32BufferAttribute(sides,1));
   this.anchors=this.anchors.map(a=>nearestContour(this.segments,a,Math.max(2,n/25))).filter(Boolean);
  }
  this.drawLabels(view);
 }
 drawLabels(view){
  const w=innerWidth,h=innerHeight,dpr=devicePixelRatio||1,ctx=this.ctx;this.resolution.set(w,h);
  if(this.canvas.width!==Math.round(w*dpr)||this.canvas.height!==Math.round(h*dpr)){this.canvas.width=Math.round(w*dpr);this.canvas.height=Math.round(h*dpr);}
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  const c=view.liveContext||view.context(),camera=c.camera,b=view.bounds,n=view.current.n,blocked=[];camera.updateMatrixWorld();
  for(const el of document.querySelectorAll('#settingsPanel,.brand,#mapClock,#timeline,#playback,footer,#placeLabels .placeLabel')){const r=el.getBoundingClientRect();if(r.width&&r.height&&getComputedStyle(el).visibility!=='hidden')blocked.push(r);}
  const project=p=>{
   const x=b.west+p.x/(n-1)*(b.east-b.west),z=b.north+p.y/(n-1)*(b.south-b.north),y=Math.max(0,view.ground(x,z))+.055,v=new THREE.Vector3(x,y,z).project(camera);
   if(v.z<-1||v.z>1||Math.abs(v.x)>1||Math.abs(v.y)>1)return null;
   const sx=(v.x+1)*w/2,sy=(1-v.y)*h/2;
   if(sx<35||sx>w-35||sy<40||sy>h-35||blocked.some(r=>sx>r.left-28&&sx<r.right+28&&sy>r.top-18&&sy<r.bottom+18))return null;
   // A screen overlay must not label contours hidden behind a ridge.
   const distance=Math.hypot(x-camera.position.x,z-camera.position.z),steps=Math.min(128,Math.max(16,Math.ceil(distance/2)));
   for(let i=1;i<steps;i++){const t=i/steps,rx=camera.position.x+(x-camera.position.x)*t,rz=camera.position.z+(z-camera.position.z)*t,ry=camera.position.y+(y-camera.position.y)*t;if(view.ground(rx,rz)>ry+.025)return null;}
   return {x:sx,y:sy};
  };
  const occupied=[],paint=(p,text,centre=false)=>{
   ctx.font=centre?'bold 16px system-ui':'600 12px ui-monospace, monospace';ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';ctx.lineWidth=4;ctx.strokeStyle='rgba(5,20,30,.9)';ctx.fillStyle='#edf7ff';ctx.strokeText(text,p.x,p.y);ctx.fillText(text,p.x,p.y);
  };
  for(const centre of this.centres||[]){const p=project(centre);if(!p||occupied.some(q=>Math.hypot(p.x-q.x,p.y-q.y)<90))continue;occupied.push(p);paint(p,`${centre.high?'H':'L'} ${Math.round(centre.value)}`,true);}
  const anchors=[],gap=Math.max(125,Math.min(w,h)/3.2),maxLabels=w>700?12:7;
  const add=(a,spacing)=>{const p=project(a);if(!p||occupied.some(q=>Math.hypot(p.x-q.x,p.y-q.y)<spacing))return false;anchors.push(a);occupied.push(p);paint(p,String(a.level));return true;};
  for(const a of this.anchors)if(anchors.length<maxLabels)add(a,gap*.6);
  // Same stable candidate order as highlights; prefer existing labels first.
  const segments=this.segments||[],stride=Math.max(1,Math.floor(segments.length/400)),candidates=[];
  for(let i=0,j=0;i<segments.length;i+=stride,j++)candidates.push({s:segments[i],rank:(j*2654435761)>>>0});candidates.sort((a,b)=>a.rank-b.rank);
  for(const {s} of candidates){if(anchors.length>=maxLabels)break;add({x:(s.start[0]+s.end[0])/2,y:(s.start[1]+s.end[1])/2,level:s.level},gap);}
  this.anchors=anchors;
 }
}
