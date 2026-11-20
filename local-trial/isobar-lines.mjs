import * as THREE from 'three';
import {pressureContours} from './pressure-contours.mjs';
import {pressureAnomalies} from './isobars.mjs';
export class IsobarLines{
 constructor(group){this.object=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0xe6f3ff,transparent:true,opacity:.8,depthWrite:false}));this.object.frustumCulled=false;group.add(this.object);this.key='';this.elapsed=0;}
 update(view,dt,interval,enabled){
  this.object.visible=enabled;if(!enabled)return;this.elapsed+=dt;
  const key=[view.frame,view.blend.toFixed(2),interval,view.bounds.west,view.bounds.north].join('/');
  if(this.elapsed<.15||key===this.key&&this.elapsed<2)return;this.elapsed=0;this.key=key;
  if(this.grid!==view.current||this.oldGrid!==view.previous){this.grid=view.current;this.oldGrid=view.previous;this.a=pressureAnomalies(view.previous.fields.pressure,view.current.n);this.b=pressureAnomalies(view.current.fields.pressure,view.current.n);}
  const n=view.current.n,pressure=Float32Array.from(this.a,(v,i)=>1000+v*(1-view.blend)+this.b[i]*view.blend),b=view.bounds,vertices=[];
  for(const segment of pressureContours(pressure,n,interval)){
   // Subdivide long segments so the isobar follows relief between grid points.
   const [a,c]=[segment.start,segment.end],steps=4;
   const point=t=>{const x=b.west+(a[0]+(c[0]-a[0])*t)/(n-1)*(b.east-b.west),z=b.north+(a[1]+(c[1]-a[1])*t)/(n-1)*(b.south-b.north);return [x,Math.max(0,view.ground(x,z))+.035,z];};
   let last=point(0);for(let i=1;i<=steps;i++){const next=point(i/steps);vertices.push(...last,...next);last=next;}
  }
  this.object.geometry.dispose();this.object.geometry=new THREE.BufferGeometry();this.object.geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
 }
}
