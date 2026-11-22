// Test terrain grid crossings, including the diagonal used by PlaneGeometry.
// Between crossings both the sight line and a terrain triangle are linear.
export function gridBlocksSight(eye,target,g,heightAt,tolerance=.001){
 const dx=target.x-eye.x,dy=target.y-eye.y,dz=target.z-eye.z;
 let a=0,b=1;
 for(const [o,d,min,max] of [[eye.x,dx,g.left,g.right],[eye.z,dz,g.top,g.bottom]]){
  if(!d){if(o<min||o>max)return false;}
  else {const i=(min-o)/d,j=(max-o)/d;a=Math.max(a,Math.min(i,j));b=Math.min(b,Math.max(i,j));}
 }
 if(a>=b)return false;
 const blocked=t=>heightAt(eye.x+dx*t,eye.z+dz*t)>eye.y+dy*t+tolerance;
 if(blocked(a)||blocked(b))return true;
 const x=(eye.x-g.left)/g.stepX,z=(eye.z-g.top)/g.stepZ,vx=dx/g.stepX,vz=dz/g.stepZ;
 for(const [o,d] of [[x,vx],[z,vz],[x+z,vx+vz]]){
  if(!d)continue;
  const lo=o+d*a,hi=o+d*b;
  for(let k=Math.ceil(Math.min(lo,hi));k<=Math.max(lo,hi);k++)if(blocked((k-o)/d))return true;
 }
 return false;
}
export function meshSightGrid(mesh){
 const n=mesh.userData.p.cells+1,v=mesh.geometry.attributes.position.array,sx=mesh.scale.x;
 const left=v[0]*sx+mesh.position.x,top=v[2]+mesh.position.z;
 const right=v[(n-1)*3]*sx+mesh.position.x,bottom=v[(n-1)*n*3+2]+mesh.position.z;
 const g={left,right,top,bottom,stepX:(right-left)/(n-1),stepZ:(bottom-top)/(n-1)};
 g.height=(x,z)=>{
  const fx=Math.max(0,Math.min(n-1,(x-left)/g.stepX)),fz=Math.max(0,Math.min(n-1,(z-top)/g.stepZ));
  const i=Math.min(n-2,Math.floor(fx)),j=Math.min(n-2,Math.floor(fz)),u=fx-i,w=fz-j,k=j*n+i;
  const a=v[k*3+1],b=v[(k+1)*3+1],c=v[(k+n)*3+1],d=v[(k+n+1)*3+1];
  return (u+w<=1?a+(b-a)*u+(c-a)*w:d+(c-d)*(1-u)+(b-d)*(1-w))*(mesh.scale.y??1)+mesh.position.y;
 };
 return g;
}
export function terrainBlocksSight(eye,target,grids,fallback){
 for(const g of grids)if(gridBlocksSight(eye,target,g,g.height))return true;
 // Coarse relief only fills areas without visible detailed terrain.
 return fallback&&gridBlocksSight(eye,target,fallback,(x,z)=>
  grids.some(g=>x>=g.left&&x<=g.right&&z>=g.top&&z<=g.bottom)?-Infinity:fallback.height(x,z));
}
