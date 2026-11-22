import * as THREE from 'three';
// ETOPO1 ice-surface elevation, 5 arc-minute nodes, north to south, metres.
// The whole globe is bundled so first visits also have real coarse relief.
export const WIDTH=4321,HEIGHT=2161;
export function decodeRelief(buffer){
 if(buffer.byteLength!==WIDTH*HEIGHT*2)throw Error('Invalid global elevation grid');
 const view=new DataView(buffer),a=new Float32Array(WIDTH*HEIGHT);
 for(let i=0;i<a.length;i++)a[i]=view.getInt16(i*2,true);return a;
}
export function reliefHeight(a,lat,lon){
 const x=((lon+180)%360+360)%360/360*(WIDTH-1),y=Math.max(0,Math.min(HEIGHT-1,(90-lat)/180*(HEIGHT-1)));
 const i=Math.floor(x),j=Math.min(HEIGHT-2,Math.floor(y)),u=x-i,v=y-j,k=j*WIDTH+i;
 return Math.max(0,(a[k]*(1-u)+a[k+1]*u)*(1-v)+(a[k+WIDTH]*(1-u)+a[k+WIDTH+1]*u)*v);
}
export class GlobalRelief{
 scale=1;
 setScale(value){this.scale=value;if(this.uniforms)this.uniforms.elevationScale.value=.001*value;}
 async load(scene,spherical=false){
  const {TerrainCache}=await import('./terrain-cache.mjs?v=20261122j');
  const disk=new TerrainCache(),key='etopo1-ice-5min-v1';let compressed=await disk.get(key);
  if(!compressed){const r=await fetch(new URL('./assets/etopo1-5min.bin.gz',import.meta.url));if(!r.ok)throw Error('Global relief unavailable');compressed=await r.arrayBuffer();void disk.put(key,compressed);}
  this.heights=decodeRelief(await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  const texture=new THREE.DataTexture(this.heights,WIDTH,HEIGHT,THREE.RedFormat,THREE.FloatType);texture.minFilter=texture.magFilter=THREE.LinearFilter;texture.needsUpdate=true;
  this.uniforms={elevationScale:{value:.001*this.scale},heights:{value:texture},anchor:{value:new THREE.Vector2()},extent:{value:new THREE.Vector4()},longitudeScale:{value:1},
   colours:{value:['#234e45','#477353','#7a8960','#9b9b80','#b3b3aa','#e7eff0'].map(c=>new THREE.Color(c))},sea:{value:new THREE.Color('#12384e')}};
  const material=new THREE.ShaderMaterial({depthWrite:false,depthTest:false,uniforms:this.uniforms,vertexShader:`
   uniform sampler2D heights;uniform vec2 anchor;uniform vec4 extent;uniform float longitudeScale,elevationScale;
   varying vec2 location;
   float heightAt(vec2 ll){vec2 uv=vec2(fract((ll.x+180.)/360.),clamp((90.-ll.y)/180.,0.,1.));uv=(uv*vec2(4320.,2160.)+.5)/vec2(4321.,2161.);return max(0.,texture2D(heights,uv).r);}
   void main(){vec2 p=extent.xy+position.xz*extent.zw;vec2 ll=anchor+vec2(p.x/longitudeScale,-p.y/111.2);location=ll;float elevation=heightAt(ll);
    gl_Position=projectionMatrix*modelViewMatrix*vec4(p.x,elevation*elevationScale,p.y,1.);
   }`,fragmentShader:`
   uniform float elevationScale;uniform vec3 colours[6],sea;uniform sampler2D heights;varying vec2 location;
   float heightAt(vec2 ll){vec2 uv=vec2(fract((ll.x+180.)/360.),clamp((90.-ll.y)/180.,0.,1.));uv=(uv*vec2(4320.,2160.)+.5)/vec2(4321.,2161.);return texture2D(heights,uv).r;}
   void main(){if(abs(location.y)>90.)discard;
    float elevation=heightAt(location),dx=max(1.,9.267*cos(radians(location.y))),dy=9.267;
    vec3 normal=normalize(vec3(-(heightAt(location+vec2(1./12.,0.))-heightAt(location-vec2(1./12.,0.)))*elevationScale/(2.*dx),1.,(heightAt(location+vec2(0.,1./12.))-heightAt(location-vec2(0.,1./12.)))*elevationScale/(2.*dy)));
    float shade=.6+.6*max(0.,dot(normal,normalize(vec3(-.4,1.,-.3))));
    vec3 c=colours[0];
    c=mix(c,colours[1],clamp(elevation/200.,0.,1.));c=mix(c,colours[2],clamp((elevation-200.)/500.,0.,1.));
    c=mix(c,colours[3],clamp((elevation-700.)/700.,0.,1.));c=mix(c,colours[4],clamp((elevation-1400.)/800.,0.,1.));c=mix(c,colours[5],clamp((elevation-2200.)/800.,0.,1.));
    gl_FragColor=vec4(elevation<.1?sea:c*shade,1.);
    #include <colorspace_fragment>
   }`});
  material.userData.coarseRelief=true;
  if(spherical){
   material.depthWrite=true;material.depthTest=true;
   material.vertexShader='varying vec2 location;void main(){location=vec2(uv.x*360.-180.,uv.y*180.-90.);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}';
  }
  const geometry=spherical?new THREE.SphereGeometry(1,128,96):new THREE.PlaneGeometry(1,1,512,512);
  if(!spherical)geometry.rotateX(-Math.PI/2);
  this.mesh=new THREE.Mesh(geometry,material);this.mesh.frustumCulled=false;this.mesh.renderOrder=-90;scene.add(this.mesh);
 }
 update(anchor,centre,footprint){
  if(!this.mesh)return;
  const scale=111.2*Math.max(.015,Math.cos(anchor.lat*Math.PI/180)),xs=footprint.map(p=>p[0]+centre.x),zs=footprint.map(p=>p[1]+centre.z);
  const west=Math.min(...xs)-5,east=Math.max(...xs)+5,north=Math.min(...zs)-5,south=Math.max(...zs)+5;
  this.uniforms.anchor.value.set(anchor.lon,anchor.lat);this.uniforms.longitudeScale.value=scale;
  this.uniforms.extent.value.set((west+east)/2,(north+south)/2,east-west,south-north);
 }
 height(lat,lon){return this.heights?reliefHeight(this.heights,lat,lon)*.001*this.scale:0;}
}
