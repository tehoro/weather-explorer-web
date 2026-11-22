import * as THREE from 'three';
import {coverColours,coverWeight} from './land-cover-palette.mjs';
import {TerrainCache} from './terrain-cache.mjs';
const WIDTH=4320,HEIGHT=2160;
export async function globalLandCover(){
 const disk=new TerrainCache(),key='worldcover-2021-5min-v1';let bytes=await disk.get(key);
 if(!bytes){const r=await fetch(new URL('./assets/worldcover-2021-5min.bin.gz',import.meta.url));if(!r.ok)throw Error('Land cover unavailable');bytes=await r.arrayBuffer();void disk.put(key,bytes);}
 const classes=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
 if(classes.length!==WIDTH*HEIGHT)throw Error('Invalid global land-cover grid');
 const lut=new Uint8Array(256*4);
 for(const [code,hex]of Object.entries(coverColours)){
  const c=new THREE.Color(hex),w=coverWeight(Number(code));
  lut.set([Math.round(c.r*w*255),Math.round(c.g*w*255),Math.round(c.b*w*255),Math.round(w*255)],Number(code)*4);
 }
 // Premultiplied colours interpolate without dark borders around missing/water cells.
 const pixels=new Uint8Array(classes.length*4);
 for(let row=0;row<HEIGHT;row+=64){
  const end=Math.min(classes.length,(row+64)*WIDTH);
  for(let i=row*WIDTH;i<end;i++){const k=classes[i]*4,j=i*4;pixels[j]=lut[k];pixels[j+1]=lut[k+1];pixels[j+2]=lut[k+2];pixels[j+3]=lut[k+3];}
  await new Promise(resolve=>setTimeout(resolve,0));
 }
 const texture=new THREE.DataTexture(pixels,WIDTH,HEIGHT,THREE.RGBAFormat);
 texture.minFilter=texture.magFilter=THREE.LinearFilter;texture.wrapS=THREE.RepeatWrapping;texture.needsUpdate=true;
 return texture;
}
