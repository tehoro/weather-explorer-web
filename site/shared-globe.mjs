import * as THREE from 'three';
import {GlobalRelief} from './explore/global-relief.mjs';
import {GlobeSurfaceCover} from './explore/globe-surface-cover.mjs';
// Reuse Explore's material, land cover and time-varying snow/ice. The vertex
// projection follows Highlights' globe-to-map transition and existing markers.
export class SharedGlobe{
 constructor(field,ready){
  this.renderer=new THREE.WebGLRenderer({alpha:true,antialias:true});
  this.canvas=this.renderer.domElement;this.canvas.id='globeTerrain';this.canvas.style.pointerEvents='none';field.before(this.canvas);
  this.scene=new THREE.Scene();this.camera=new THREE.Camera();this.relief=new GlobalRelief();this.cover=new GlobeSurfaceCover(this.relief);
  this.relief.load(this.scene,true).then(()=>{
   const m=this.relief.mesh.material;
   Object.assign(m.uniforms,{viewCentre:{value:new THREE.Vector2()},viewSize:{value:new THREE.Vector2(1,1)},viewScale:{value:1},globeBlend:{value:1}});
   m.vertexShader=`uniform vec2 viewCentre,viewSize;uniform float viewScale,globeBlend;varying vec2 location;varying float facing;
    void main(){location=vec2(uv.x*360.-180.,uv.y*180.-90.);float lat=radians(location.y),dl=radians(location.x-viewCentre.x),phi=radians(viewCentre.y);
     float sc=sin(phi),cc=cos(phi),sl=sin(lat),cl=cos(lat),cd=cos(dl);facing=sc*sl+cc*cl*cd;
     float k=globeBlend+(1.-globeBlend)*sqrt(2./max(.000001,1.+facing));
     vec2 xy=k*vec2(cl*sin(dl),cc*sl-sc*cl*cd)*viewScale*2./viewSize;
     gl_Position=vec4(xy,-facing*.5,1.);
    }`;
   m.fragmentShader='varying float facing;'+m.fragmentShader.replace('void main(){','void main(){if(facing<0.)discard;');
   m.needsUpdate=true;this.loaded=true;ready();
  }).catch(()=>{this.canvas.hidden=true;});
 }
 draw(view,w,h,dpr,time,showCover){
  const g=view?.g||0;this.canvas.hidden=!this.loaded||g<.001;
  if(this.canvas.hidden)return;
  if(this.width!==w||this.height!==h||this.dpr!==dpr){this.renderer.setPixelRatio(dpr);this.renderer.setSize(w,h);this.width=w;this.height=h;this.dpr=dpr;}
  const u=this.relief.mesh.material.uniforms;u.viewCentre.value.set(view.lon,view.lat);u.viewSize.value.set(w,h);u.viewScale.value=view.s;u.globeBlend.value=g;
  this.canvas.style.opacity=String(Math.min(1,g*2));
  this.cover.tick(showCover?time:'1900-01-01T00:00:00Z');
  this.renderer.render(this.scene,this.camera);
 }
}
