import {snowCoverShader} from './snow-cover-shader.mjs?v=20261123f';
import * as THREE from 'three';
import {WeatherData} from './weather-engine.mjs?v=20261123c';
import {frameAtTime} from './forecast-position.mjs';
// Only the small global cover previews are needed; no detailed weather tiles.
export class GlobeSurfaceCover{
 constructor(relief){
  this.relief=relief;this.textures=[];this.regionalTextures=[];
  this.uniforms={regionalA:{value:null},regionalB:{value:null},coverA:{value:null},coverB:{value:null},coverMix:{value:0},coverReady:{value:0}};
  this.load().catch(()=>{}); // Optional on older forecast packages.
 }
 async load(){
  const data=new WeatherData(),meta=await data.init();if(!meta.surface_cover)return;
  this.times=meta.times.map(t=>Date.parse(t));
  for(let i=0;i<this.times.length;i++){
   try{
    const fields=await data.surfaceCover(i,'global.bin.gz',361*181),pixels=new Float32Array(361*181*4);
    for(let j=0;j<361*181;j++){pixels[j*4]=Math.max(0,fields.snowCover[j]);pixels[j*4+1]=Math.max(0,fields.seaIce[j]);pixels[j*4+2]=fields.snowlineWeighted[j];pixels[j*4+3]=fields.snowlineWeight[j];}
    const texture=new THREE.DataTexture(pixels,361,181,THREE.RGBAFormat,THREE.FloatType);
    texture.minFilter=texture.magFilter=THREE.LinearFilter;texture.needsUpdate=true;this.textures[i]=texture;
    const regional=new Float32Array(361*181*4);
    for(let j=0;j<361*181;j++){regional[j*4]=fields.snowlineRegionalWeighted[j];regional[j*4+1]=fields.snowlineRegionalWeight[j];regional[j*4+2]=fields.snowlineModelHeight[j];}
    const rt=new THREE.DataTexture(regional,361,181,THREE.RGBAFormat,THREE.FloatType);
    rt.minFilter=rt.magFilter=THREE.LinearFilter;rt.needsUpdate=true;this.regionalTextures[i]=rt;
   }catch{} // A missing frame must not replace another time's cover.
  }
 }
 tick(time){
  const material=this.relief.mesh?.material;if(!material)return;
  if(!this.attached){
   Object.assign(material.uniforms,this.uniforms);
   material.fragmentShader=snowCoverShader+material.fragmentShader.replace('void main(){',`uniform sampler2D regionalA,regionalB,coverA,coverB;uniform float coverMix,coverReady;
    void main(){`).replace('#include <colorspace_fragment>',`
    if(coverReady>.5){
     vec2 coverUV=(vec2(mod(mod(location.x,360.)+360.,360.),90.-location.y)+.5)/vec2(361.,181.);
     vec4 cover=mix(texture2D(coverA,coverUV),texture2D(coverB,coverUV),coverMix);
     vec3 regional=mix(texture2D(regionalA,coverUV).rgb,texture2D(regionalB,coverUV).rgb,coverMix);
     cover.r=terrainSnow(cover,regional,elevation*.001);
     float ice=elevation<.1?cover.g:0.,snow=elevation>=.1?cover.r:0.;
     vec3 white=ice>0.?vec3(.72,.84,.89):vec3(.86,.91,.94);
     float relief=clamp(dot(gl_FragColor.rgb,vec3(.2126,.7152,.0722))*1.3+.45,.5,1.);
     gl_FragColor.rgb=mix(gl_FragColor.rgb,white*relief,max(snow,ice)*.92);
    }
    #include <colorspace_fragment>`);
   material.needsUpdate=true;this.attached=true;
  }
  const t=Date.parse(time),u=this.uniforms;u.coverReady.value=0;
  if(!this.times||t<this.times[0]||t>this.times.at(-1))return;
  const f=frameAtTime(this.times,t),a=Math.floor(f),b=Math.ceil(f);
  if(!this.textures[a]||!this.textures[b])return;
  u.regionalA.value=this.regionalTextures[a];u.regionalB.value=this.regionalTextures[b];
  u.coverA.value=this.textures[a];u.coverB.value=this.textures[b];u.coverMix.value=f-a;u.coverReady.value=1;
 }
}
