import * as THREE from 'three';
// ETOPO1 ice-surface elevation, 10 arc-minute nodes, north to south, metres.
// The whole globe is bundled so first visits also have real coarse relief.
export const WIDTH=2161,HEIGHT=1081;
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
 async load(scene){
  const r=await fetch(new URL('./assets/etopo1-10min.bin.gz',import.meta.url));if(!r.ok)throw Error('Global relief unavailable');
  this.heights=decodeRelief(await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  const texture=new THREE.DataTexture(this.heights,WIDTH,HEIGHT,THREE.RedFormat,THREE.FloatType);texture.minFilter=texture.magFilter=THREE.LinearFilter;texture.needsUpdate=true;
  this.uniforms={heights:{value:texture},anchor:{value:new THREE.Vector2()},extent:{value:new THREE.Vector4()},longitudeScale:{value:1},
   colours:{value:['#234e45','#477353','#7a8960','#9b9b80','#b3b3aa','#e7eff0'].map(c=>new THREE.Color(c))},sea:{value:new THREE.Color('#12384e')}};
  const material=new THREE.ShaderMaterial({depthWrite:false,depthTest:false,uniforms:this.uniforms,vertexShader:`
   uniform sampler2D heights;uniform vec2 anchor;uniform vec4 extent;uniform float longitudeScale;
   varying float elevation,shade,latitude;
   float heightAt(vec2 ll){vec2 uv=vec2(fract((ll.x+180.)/360.),clamp((90.-ll.y)/180.,0.,1.));uv=(uv*vec2(2160.,1080.)+.5)/vec2(2161.,1081.);return max(0.,texture2D(heights,uv).r);}
   void main(){vec2 p=extent.xy+position.xz*extent.zw;vec2 ll=anchor+vec2(p.x/longitudeScale,-p.y/111.2);latitude=ll.y;elevation=heightAt(ll);
    float dx=max(1.,18.533*cos(radians(ll.y))),dy=18.533;
    vec3 normal=normalize(vec3(-(heightAt(ll+vec2(1./6.,0.))-heightAt(ll-vec2(1./6.,0.)))*.0015/(2.*dx),1.,(heightAt(ll+vec2(0.,1./6.))-heightAt(ll-vec2(0.,1./6.)))*.0015/(2.*dy)));
    shade=.6+.6*max(0.,dot(normal,normalize(vec3(-.4,1.,-.3))));
    gl_Position=projectionMatrix*modelViewMatrix*vec4(p.x,elevation*.0015,p.y,1.);
   }`,fragmentShader:`
   uniform vec3 colours[6],sea;varying float elevation,shade,latitude;
   void main(){if(abs(latitude)>90.)discard;vec3 c=colours[0];
    c=mix(c,colours[1],clamp(elevation/200.,0.,1.));c=mix(c,colours[2],clamp((elevation-200.)/500.,0.,1.));
    c=mix(c,colours[3],clamp((elevation-700.)/700.,0.,1.));c=mix(c,colours[4],clamp((elevation-1400.)/800.,0.,1.));c=mix(c,colours[5],clamp((elevation-2200.)/800.,0.,1.));
    gl_FragColor=vec4(elevation<.1?sea:c*shade,1.);
    #include <colorspace_fragment>
   }`});
  material.userData.coarseRelief=true;
  const geometry=new THREE.PlaneGeometry(1,1,256,256);geometry.rotateX(-Math.PI/2);
  this.mesh=new THREE.Mesh(geometry,material);this.mesh.frustumCulled=false;this.mesh.renderOrder=-90;scene.add(this.mesh);
 }
 update(anchor,centre,footprint){
  if(!this.mesh)return;
  const scale=111.2*Math.max(.015,Math.cos(anchor.lat*Math.PI/180)),xs=footprint.map(p=>p[0]+centre.x),zs=footprint.map(p=>p[1]+centre.z);
  const west=Math.min(...xs)-5,east=Math.max(...xs)+5,north=Math.min(...zs)-5,south=Math.max(...zs)+5;
  this.uniforms.anchor.value.set(anchor.lon,anchor.lat);this.uniforms.longitudeScale.value=scale;
  this.uniforms.extent.value.set((west+east)/2,(north+south)/2,east-west,south-north);
 }
 height(lat,lon){return this.heights?reliefHeight(this.heights,lat,lon)*.0015:0;}
}
