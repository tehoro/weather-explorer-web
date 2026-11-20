// Marching squares with an asymptotic saddle decider. Coordinates are grid indices.
export function pressureContours(a,n,interval){
 let min=Infinity,max=-Infinity;for(const v of a)if(Number.isFinite(v)){min=Math.min(min,v);max=Math.max(max,v);}
 const segments=[];
 for(let level=Math.ceil(min/interval)*interval;level<=max;level+=interval){
  for(let y=0;y<n-1;y++)for(let x=0;x<n-1;x++){
   const i=y*n+x,v=[a[i],a[i+1],a[i+n+1],a[i+n]],p=[[x,y],[x+1,y],[x+1,y+1],[x,y+1]],hits=new Map();if(!v.every(Number.isFinite))continue;
   for(let e=0;e<4;e++){const j=(e+1)%4;if((v[e]>=level)===(v[j]>=level))continue;const t=(level-v[e])/(v[j]-v[e]);hits.set(e,[p[e][0]+t*(p[j][0]-p[e][0]),p[e][1]+t*(p[j][1]-p[e][1])]);}
   const add=(e,f)=>{const start=hits.get(e),end=hits.get(f);if(Math.hypot(start[0]-end[0],start[1]-end[1])>1e-9)segments.push({level,start,end});};
   if(hits.size===2){const [e,f]=hits.keys();add(e,f);}
   else if(hits.size===4){const q=(v[0]-level)*(v[2]-level)-(v[1]-level)*(v[3]-level);if(q>=0){add(0,1);add(2,3);}else{add(0,3);add(1,2);}}
  }
 }
 return segments;
}
