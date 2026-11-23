import * as THREE from 'three';
import {GlobalRelief} from './explore/global-relief.mjs';
import {GlobeSurfaceCover} from './explore/globe-surface-cover.mjs';
// Reuse Explore's material, land cover and time-varying snow/ice. The vertex
// projection follows Highlights' globe-to-map transition and existing markers.
export class SharedGlobe{
 constructor(field,ready,unprojectShader){
  this.renderer=new THREE.WebGLRenderer({alpha:true,antialias:true});
  this.canvas=this.renderer.domElement;this.canvas.id='globeTerrain';this.canvas.style.pointerEvents='none';field.before(this.canvas);
  this.scene=new THREE.Scene();this.camera=new THREE.Camera();this.relief=new GlobalRelief();this.cover=new GlobeSurfaceCover(this.relief);
  this.relief.load(this.scene,true).then(()=>{
   const m=this.relief.mesh.material;
   Object.assign(m.uniforms,{centre:{value:new THREE.Vector3()},size:{value:new THREE.Vector2(1,1)},scale:{value:1},globe:{value:1}});
   // Sample geographic coordinates per pixel, exactly like the weather overlay.
   // Interpolating lon/lat across a projected sphere distorts zoomed coastlines.
   this.relief.mesh.geometry.dispose();
   this.relief.mesh.geometry=new THREE.PlaneGeometry(2,2);
   m.depthTest=false;m.depthWrite=false;
   m.vertexShader='void main(){gl_Position=vec4(position.xy,0.,1.);}';
   m.fragmentShader=unprojectShader+'\nvec2 location;\n'+m.fragmentShader.replace('varying vec2 location;','').replace('void main(){','void main(){float lat,dl;if(!unproject(lat,dl))discard;location=vec2(centre.x+degrees(dl),degrees(lat));');
   m.needsUpdate=true;this.loaded=true;ready();
  }).catch(()=>{this.canvas.hidden=true;this.canvas.style.display='none';});
 }
 draw(view,w,h,dpr,time,showCover,overview){
  const g=view?.g||0;this.canvas.hidden=!this.loaded||(!overview&&g<.001);
  // Three.js sets inline display:block, which overrides the HTML hidden attribute.
  this.canvas.style.display=this.canvas.hidden?'none':'block';
  if(this.canvas.hidden)return;
  if(this.width!==w||this.height!==h||this.dpr!==dpr){this.renderer.setPixelRatio(dpr);this.renderer.setSize(w,h);this.width=w;this.height=h;this.dpr=dpr;}
  const u=this.relief.mesh.material.uniforms;u.centre.value.set(view.lon,Math.sin(view.lat*Math.PI/180),Math.cos(view.lat*Math.PI/180));u.size.value.set(this.canvas.width,this.canvas.height);u.scale.value=view.s*dpr;u.globe.value=g;
  this.canvas.style.opacity=String(overview?1:Math.min(1,g*2));
  this.cover.tick(showCover?time:'1900-01-01T00:00:00Z');
  this.renderer.render(this.scene,this.camera);
 }
}
