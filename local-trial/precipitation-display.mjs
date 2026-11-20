// Rain and snow shaders adapted directly from Neil Gordon’s Weather3D renderer.
// Reference: assets/terrain.js, renderer 0182af7634c2 (see reference-source.json).
import * as THREE from 'three';
export function precipitationDensity(rate){
 if(rate<=0)return 0;if(rate<=1)return .03+.097*rate;
 if(rate<=4)return .127+(rate-1)*(.627-.127)/3;
 return .627+(Math.min(10,rate)-4)*(1-.627)/6;
}
export function makePrecipitation(scene,max){
const particleScale=6,overhead={value:0},distanceEmphasis={value:0};
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

return {rain:rainLayer(max),snow:snowLayer(max),overhead,distanceEmphasis};
}
