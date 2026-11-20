// Basemap rings already have continuous, unwrapped longitude coordinates.
// Draw translated copies where they intersect the texture; do not split rings
// at the date line or discard coordinates outside -180..180.
export function landPaths(data,width,height){
 const paths=[];
 for(const ring of data.land){
  let lon=0,lat=0,min=Infinity,max=-Infinity;const points=[];
  for(let i=0;i<ring.length;i+=2){lon+=ring[i];lat+=ring[i+1];const x=(lon/data.scale+180)/360*width,y=(90-lat/data.scale)/180*height;points.push([x,y]);min=Math.min(min,x);max=Math.max(max,x);}
  for(let shift=Math.ceil(-max/width);shift<=Math.floor((width-min)/width);shift++)paths.push(points.map(([x,y])=>[x+shift*width,y]));
 }
 return paths;
}
export function paintLand(ctx,data,width,height,stroke=false){
 for(const points of landPaths(data,width,height)){ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fill();if(stroke)ctx.stroke();}
}
