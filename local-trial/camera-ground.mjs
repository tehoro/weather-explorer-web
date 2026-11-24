// PlaneGeometry uses a diagonal from the north-east to south-west node.
export const CAMERA_CLEARANCE_KM=.01;
export function triangleHeight(a,b,c,d,u,v){return u+v<=1?a+(b-a)*u+(c-a)*v:d+(c-d)*(1-u)+(b-d)*(1-v);}
export function meshHeight(mesh,cells,x,y){
 x=Math.max(0,Math.min(cells,x));y=Math.max(0,Math.min(cells,y));
 const i=Math.min(cells-1,Math.floor(x)),j=Math.min(cells-1,Math.floor(y)),n=cells+1,q=j*n+i,p=mesh.geometry.attributes.position;
 return triangleHeight(p.getY(q),p.getY(q+1),p.getY(q+n),p.getY(q+n+1),x-i,y-j)*mesh.scale.y+mesh.position.y;
}
export function nearGroundPlane(distance,clearance){return Math.max(.001,Math.min(Math.max(.03,distance*.005),Math.max(.001,clearance*.1)));}
// The preset clears the first 5 km ahead; manual orbit remains free to descend.
export function skylineClearance(x,z,tx,tz,scale,surface){
 const distance=Math.hypot(tx-x,tz-z),reach=Math.min(5,distance),clearance=CAMERA_CLEARANCE_KM*scale;
 let height=surface(x,z)+clearance;
 if(distance>0)for(let i=1;i<=200;i++){const f=reach*i/(200*distance);height=Math.max(height,surface(x+(tx-x)*f,z+(tz-z)*f)+clearance);}
 return height;
}
