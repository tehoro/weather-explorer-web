// Dense illustrative precipitation, using the same IFS total/snow amounts as symbols.
import * as THREE from 'three';
export class PrecipitationStreaks{
 constructor(group){
  this.count=matchMedia('(max-width:700px)').matches?3000:8000;this.particles=[];
  this.rainGeometry=new THREE.BufferGeometry();this.rainGeometry.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(this.count*6),3));
  this.rain=new THREE.LineSegments(this.rainGeometry,new THREE.LineBasicMaterial({color:0xc1e4fa,transparent:true,opacity:.48,depthWrite:false}));
  this.snowGeometry=new THREE.BufferGeometry();this.snowGeometry.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(this.count*3),3));
  this.snow=new THREE.Points(this.snowGeometry,new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{pixelRatio:{value:1}},vertexShader:`uniform float pixelRatio;void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=3.*pixelRatio;}`,fragmentShader:`void main(){float r=length(gl_PointCoord-.5);if(r>.5)discard;gl_FragColor=vec4(1.,1.,1.,.8*(1.-smoothstep(.15,.5,r)));}`}));
  for(const obj of [this.rain,this.snow]){obj.frustumCulled=false;obj.visible=false;group.add(obj);}
 }
 visible(on){this.rain.visible=this.snow.visible=on;}
 reset(){this.particles=[];}
 update(view,dt){
  if(!this.rain.visible)return;
  const c=view.liveContext,b=view.bounds,dist=c.distance,radius=Math.max(2,dist*.75),top=Math.max(.12,Math.min(2,dist*.08)),length=Math.max(.008,Math.min(.5,dist*.006));
  let nr=0,ns=0;const ra=this.rainGeometry.attributes.position,sa=this.snowGeometry.attributes.position;
  for(let i=0;i<this.count;i++){
   let p=this.particles[i];
   if(!p||p.y<0||Math.hypot(p.x-c.target.x,p.z-c.target.z)>radius*1.3){const angle=Math.random()*Math.PI*2,r=Math.sqrt(Math.random())*radius;p=this.particles[i]={x:c.target.x+r*Math.cos(angle),z:c.target.z+r*Math.sin(angle),y:Math.random()*top,seed:Math.random(),phase:Math.random()*6.28};}
   if(p.x<b.west||p.x>b.east||p.z<b.north||p.z>b.south){p.y=-1;continue;}
   const total=view.sample('rain',p.x,p.z),snow=view.sample('snow',p.x,p.z),fraction=Math.max(0,Math.min(1,snow/Math.max(.001,total))),isSnow=(i*.61803398875)%1<fraction;
   const fall=top/(isSnow?7:1.5),u=view.sample('u',p.x,p.z),v=view.sample('v',p.x,p.z);
   p.y-=dt*fall;p.phase+=dt;p.x+=dt*(u*.0015+(isSnow?Math.sin(p.phase)*length*.4:0));p.z+=dt*(-v*.0015+(isSnow?Math.cos(p.phase)*length*.4:0));
   if(total<.05||p.seed>Math.min(1,Math.sqrt(total/8))||p.y<0)continue;
   const ground=Math.max(0,view.ground(p.x,p.z)),y=ground+.025+p.y;
   if(isSnow)sa.setXYZ(ns++,p.x,y,p.z);
   else{ra.setXYZ(nr++,p.x,y,p.z);ra.setXYZ(nr++,p.x-u*.0015*length/fall,y+length,p.z+v*.0015*length/fall);}
  }
  this.rainGeometry.setDrawRange(0,nr);this.snowGeometry.setDrawRange(0,ns);ra.needsUpdate=sa.needsUpdate=true;this.snow.material.uniforms.pixelRatio.value=Math.min(devicePixelRatio,2);
 }
}
