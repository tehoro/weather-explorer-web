import * as THREE from './assets/three.module.js';
import {sample,isWater} from './terrain-raster.mjs';
const terrainStops=[[0,'#234e45'],[200,'#477353'],[700,'#7a8960'],[1400,'#9b9b80'],[2200,'#969187'],[3000,'#a39d94']].map(([z,c])=>[z,new THREE.Color(c)]);
const coverColours={10:'#315d3c',20:'#78834e',30:'#81985c',40:'#a0a56a',50:'#a49a90',60:'#a7a18e',70:'#e4ecee',90:'#547a67',95:'#315d50',100:'#989578'};
const rgb=c=>{const v=new THREE.Color(c).convertLinearToSRGB();return [v.r*255,v.g*255,v.b*255];};
const coverRGB=Object.fromEntries(Object.entries(coverColours).map(([k,c])=>[k,rgb(c)])),seaRGB=rgb('#12384e');
const reliefRGB=Array.from({length:1801},(_,i)=>{const z=i*5;let c=terrainStops.at(-1)[1].clone();for(let j=1;j<terrainStops.length;j++)if(z<=terrainStops[j][0]){const [a,ca]=terrainStops[j-1],[b,cb]=terrainStops[j];c=ca.clone().lerp(cb,Math.max(0,(z-a)/(b-a)));break;}return rgb(c);});
export function colourTile({p,a,water,ocean},mode){
 const n=p.cells+1,hn=n+2,size=p.background?64:512,pixels=new Uint8Array(size*size*4);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const i=y*size+x,z=ocean?0:sample(a,hn,hn,1+(x+.5)/size*p.cells,1+(y+.5)/size*p.cells),code=water?.[i];
  let c=reliefRGB[Math.min(1800,Math.max(0,Math.round(z/5)))];
  const waterPixel=isWater(code??0,z,ocean);
  if(waterPixel)c=seaRGB;
  else if(mode!=='relief'&&coverRGB[code]){const cc=coverRGB[code];c=mode==='cover'?cc:c.map((v,j)=>{const weight=code===70?1:code===60?.65:.1;return v*(1-weight)+cc[j]*weight;});}
  pixels.set([Math.round(c[0]),Math.round(c[1]),Math.round(c[2]),waterPixel?0:255],i*4);
 }
 return {pixels,size};
}
export function terrainGeometry(p,a,ocean){
 const n=p.cells+1,hn=n+2,width=p.span*111.2,step=width/p.cells,geometry=new THREE.PlaneGeometry(width,width,p.cells,p.cells);geometry.rotateX(-Math.PI/2);
 const v=geometry.attributes.position,uv=geometry.attributes.uv,normal=geometry.attributes.normal,vector=new THREE.Vector3();
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const i=y*n+x,j=(y+1)*hn+x+1,height=ocean?0:a[j];if(!Number.isFinite(height)||height<-1000||height>10000)throw Error('Invalid elevation');
  v.setY(i,height/1000*1.5);uv.setY(i,1-uv.getY(i));
  // Shared halo samples produce identical normals at neighbouring patch edges.
  vector.set(ocean?0:-(a[j+1]-a[j-1])*.0015/(2*step),1,ocean?0:-(a[j+hn]-a[j-hn])*.0015/(2*step)).normalize();normal.setXYZ(i,vector.x,vector.y,vector.z);
 }
 const edges=[];for(let i=0;i<n;i++)edges.push(i);for(let i=1;i<n;i++)edges.push(i*n+n-1);
 for(let i=n-2;i>=0;i--)edges.push((n-1)*n+i);for(let i=n-2;i>0;i--)edges.push(i*n);
 const positions=new Float32Array((n*n+edges.length)*3),uvs=new Float32Array((n*n+edges.length)*2),normals=new Float32Array(positions.length);
 positions.set(v.array);uvs.set(uv.array);normals.set(normal.array);const indices=Array.from(geometry.index.array);
 edges.forEach((src,i)=>{const dst=n*n+i;positions.set([v.getX(src),v.getY(src)-.15,v.getZ(src)],dst*3);uvs.set([uv.getX(src),uv.getY(src)],dst*2);normals.set([normal.getX(src),normal.getY(src),normal.getZ(src)],dst*3);const next=(i+1)%edges.length;indices.push(src,edges[next],n*n+next,src,n*n+next,dst);});
 geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));
 const result={positions:geometry.attributes.position.array,normals:geometry.attributes.normal.array,uvs:geometry.attributes.uv.array,indices:geometry.index.array,edges};geometry.dispose();return result;
}
