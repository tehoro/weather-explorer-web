export function tilePoint(latitude,longitude,res){
 const lon=((longitude%360)+360)%360,lat=Math.max(-90,Math.min(90,latitude));
 const x=Math.min(17,Math.floor(lon/20)),y=Math.min(8,Math.floor((90-lat)/20));
 return {key:`${x}-${y}`,x:(lon-x*20)/res,y:(90-lat-y*20)/res};
}
export function viewPoints(lat,lon,width,G,res){
 const points=[];
 for(let j=0;j<G;j++)for(let i=0;i<G;i++){
  const x=(i/(G-1)-.5)*width,z=(j/(G-1)-.5)*width;
  points.push(tilePoint(lat-z/111.2,lon+x/(111.2*Math.max(.05,Math.cos(lat*Math.PI/180))),res));
 }
 return points;
}
export function chooseLod(distance,current=0){
 // Hysteresis avoids repeated downloads near a boundary while orbiting.
 if(current===0)return distance>300?1:0;
 if(current===1)return distance<240?0:distance>600?2:1;
 return distance<480?1:2;
}
