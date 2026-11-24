// Original deterministic random-centre volume; no third-party renderer code.
// Centres are scattered freely, not one per grid cell. Toroidal distances keep
// filtering seamless; the shader rotates and warps samples to hide repetition.
export function detailNoise(size=48){
 const a=new Uint8Array(size**3),domain=6,points=[];
 let seed=0x671f3a29;
 const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296};
 for(let n=0;n<216;n++)points.push([random()*domain,random()*domain,random()*domain,.62+random()*.76]);
 const values=new Float32Array(a.length);let sum=0;
 for(let z=0;z<size;z++)for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const px=x/size*domain,py=y/size*domain,pz=z/size*domain;let d2=100;
  for(const [cx,cy,cz,radius] of points){
   let dx=Math.abs(px-cx),dy=Math.abs(py-cy),dz=Math.abs(pz-cz);
   dx=Math.min(dx,domain-dx);dy=Math.min(dy,domain-dy);dz=Math.min(dz,domain-dz);
   d2=Math.min(d2,(dx*dx+dy*dy+dz*dz)/(radius*radius));
  }
  const value=Math.max(0,1-Math.sqrt(d2)),i=x+size*(y+size*z);
  values[i]=value;sum+=value;
 }
 // Preserve the previous texture's density reference while varying cell sizes.
 const shift=.45-sum/a.length;
 for(let i=0;i<a.length;i++)a[i]=Math.round(Math.max(0,Math.min(1,values[i]+shift))*255);
 return a;
}
