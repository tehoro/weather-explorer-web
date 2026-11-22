// Dense illustrative precipitation, using the same IFS total/snow amounts as symbols.
import * as THREE from 'three';
export class PrecipitationStreaks{
 constructor(group){
  this.count=matchMedia('(max-width:700px)').matches?3000:8000;this.particles=[];
  this.rainGeometry=new THREE.InstancedBufferGeometry();
  this.rainGeometry.setAttribute('position',new THREE.Float32BufferAttribute([0,-1,0,1,-1,0,0,1,0,1,1,0],3));this.rainGeometry.setIndex([0,1,2,2,1,3]);
  for(const name of ['start','end'])this.rainGeometry.setAttribute(name,new THREE.InstancedBufferAttribute(new Float32Array(this.count*3),3).setUsage(THREE.DynamicDrawUsage));
  this.rainGeometry.instanceCount=0;
  // WebGL line widths are usually fixed at one device pixel. Ribbons keep a
  // visible two-CSS-pixel width on Retina screens and at every camera distance.
  this.rain=new THREE.Mesh(this.rainGeometry,new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,uniforms:{viewport:{value:new THREE.Vector2(1,1)}},vertexShader:`
   attribute vec3 start,end;uniform vec2 viewport;varying float edge;
   void main(){vec4 a=projectionMatrix*modelViewMatrix*vec4(start,1.),b=projectionMatrix*modelViewMatrix*vec4(end,1.);edge=position.y;
    if(a.w<=0.||b.w<=0.){gl_Position=vec4(2.,2.,2.,1.);return;}
    vec2 d=(b.xy/b.w-a.xy/a.w)*viewport;
    if(length(d)<6.){b.xy+=vec2(0.,6./viewport.y)*b.w;d=(b.xy/b.w-a.xy/a.w)*viewport;}
    vec2 normal=normalize(vec2(-d.y,d.x));vec4 p=mix(a,b,position.x);p.xy+=normal*position.y*2./viewport*p.w;gl_Position=p;
   }`,fragmentShader:`varying float edge;void main(){gl_FragColor=vec4(.76,.91,1.,.78*(1.-smoothstep(.55,1.,abs(edge))));
    #include <colorspace_fragment>
   }`}));
  this.snowGeometry=new THREE.BufferGeometry();this.snowGeometry.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(this.count*3),3));
  this.snow=new THREE.Points(this.snowGeometry,new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{pixelRatio:{value:1}},vertexShader:`uniform float pixelRatio;void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=3.*pixelRatio;}`,fragmentShader:`void main(){float r=length(gl_PointCoord-.5);if(r>.5)discard;gl_FragColor=vec4(1.,1.,1.,.8*(1.-smoothstep(.15,.5,r)));}`}));
  for(const obj of [this.rain,this.snow]){obj.frustumCulled=false;obj.visible=false;group.add(obj);}
 }
 visible(on){this.rain.visible=this.snow.visible=on;}
 reset(){this.particles=[];}
 update(view,dt){
  if(!this.rain.visible)return;
  const c=view.liveContext,b=view.bounds,dist=c.distance,radius=Math.max(2,dist*.75),top=Math.max(.12,Math.min(2,dist*.08)),length=1.5*Math.max(.008,Math.min(.5,dist*.006));
  let nr=0,ns=0;const ra=this.rainGeometry.attributes.start,ea=this.rainGeometry.attributes.end,sa=this.snowGeometry.attributes.position;
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
   else{ra.setXYZ(nr,p.x,y,p.z);ea.setXYZ(nr++,p.x-u*.0015*length/fall,y+length,p.z+v*.0015*length/fall);}
  }
  this.rainGeometry.instanceCount=nr;this.rain.material.uniforms.viewport.value.set(globalThis.innerWidth||1280,globalThis.innerHeight||720);this.snowGeometry.setDrawRange(0,ns);ra.needsUpdate=ea.needsUpdate=sa.needsUpdate=true;this.snow.material.uniforms.pixelRatio.value=Math.min(devicePixelRatio,2);
 }
}
