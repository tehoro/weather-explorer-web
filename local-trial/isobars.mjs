// Spacing follows the central view's ground width, not the distant tilted horizon.
export function isobarInterval(widthKm,previous=0){
 if(previous===4&&widthKm>=315)return 4;
 if(previous===1&&widthKm<132)return 1;
 if(previous===2&&widthKm>=108&&widthKm<385)return 2;
 return widthKm>=350?4:widthKm>=120?2:1;
}
// Light display-only smoothing removes steps from the 0.1 hPa tile packing.
// Store anomalies to retain precision during GPU interpolation. Readouts are unchanged.
export function pressureAnomalies(values,n){
 let a=Float32Array.from(values,v=>v-1000);
 for(let pass=0;pass<2;pass++){
  const b=new Float32Array(a.length);
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
   if(x===0||y===0||x===n-1||y===n-1){b[y*n+x]=a[y*n+x];continue;}
   b[y*n+x]=(a[y*n+x]*4+(a[y*n+x-1]+a[y*n+x+1]+a[(y-1)*n+x]+a[(y+1)*n+x])*2+a[(y-1)*n+x-1]+a[(y-1)*n+x+1]+a[(y+1)*n+x-1]+a[(y+1)*n+x+1])/16;
  }a=b;
 }return a;
}
