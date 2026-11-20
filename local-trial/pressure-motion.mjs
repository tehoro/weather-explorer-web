// Browser counterpart of the highlights' extrema and storm-relative interpolation.
import {bilinear} from './weather-data.mjs';
export function pressureCentres(a,n){
 const candidates=[],radius=Math.max(4,Math.floor(n/12));
 for(let y=2;y<n-2;y++)for(let x=2;x<n-2;x++){
  const v=a[y*n+x],high=v>1022;if(!Number.isFinite(v)||(!high&&v>=1004))continue;
  let extreme=true,strict=false;
  for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++)if(i||j){const other=a[(y+j)*n+x+i];if(high?other>v:other<v)extreme=false;if(high?other<v:other>v)strict=true;}
  if(!extreme||!strict)continue;
  for(let j=Math.max(0,y-radius);j<=Math.min(n-1,y+radius)&&extreme;j++)for(let i=Math.max(0,x-radius);i<=Math.min(n-1,x+radius);i++)if(high?a[j*n+i]>v:a[j*n+i]<v){extreme=false;break;}
  if(!extreme||!strict)continue;
  // Fit the local quadratic to avoid snapping the centre between grid nodes.
  const dx=(a[y*n+x+1]-a[y*n+x-1])/2,dy=(a[(y+1)*n+x]-a[(y-1)*n+x])/2;
  const xx=a[y*n+x+1]+a[y*n+x-1]-2*v,yy=a[(y+1)*n+x]+a[(y-1)*n+x]-2*v;
  const xy=(a[(y+1)*n+x+1]-a[(y+1)*n+x-1]-a[(y-1)*n+x+1]+a[(y-1)*n+x-1])/4,det=xx*yy-xy*xy;
  let ox=0,oy=0;if(det>1e-10){ox=(xy*dy-yy*dx)/det;oy=(xy*dx-xx*dy)/det;if(Math.abs(ox)>1||Math.abs(oy)>1)ox=oy=0;}
  candidates.push({x:x+ox,y:y+oy,value:v+.5*(dx*ox+dy*oy),high});
 }
 candidates.sort((a,b)=>a.high===b.high?(a.high?b.value-a.value:a.value-b.value):Number(a.high)-Number(b.high));
 return candidates.filter((p,i)=>!candidates.slice(0,i).some(q=>q.high===p.high&&Math.hypot(q.x-p.x,q.y-p.y)<radius*2));
}
export function matchCentres(a,b,kmX,kmY,maxKm=400){
 const distance=(p,q)=>Math.hypot((p.x-q.x)*kmX,(p.y-q.y)*kmY);
 const eligible=(p,q)=>p.high===q.high&&Math.abs(p.value-q.value)<20&&distance(p,q)<maxKm;
 // Only unambiguous, mutually unique matches. Mergers and disappearing lows use ordinary blending.
 return a.flatMap(p=>{const matches=b.filter(q=>eligible(p,q));return matches.length===1&&a.filter(r=>eligible(r,matches[0])).length===1?[{a:p,b:matches[0]}]:[];});
}
export function blendPressure(a,b,n,t,matches,kmX,kmY){
 if(t<=0)return a;if(t>=1)return b;
 const out=new Float32Array(n*n);
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  let best=null,weight=0;
  for(const pair of matches){const cx=pair.a.x*(1-t)+pair.b.x*t,cy=pair.a.y*(1-t)+pair.b.y*t;
   // Confine influence to the available grid; taper before its boundary.
   const radius=Math.min(700,cx*kmX,(n-1-cx)*kmX,cy*kmY,(n-1-cy)*kmY);
   if(radius<=0)continue;const d=Math.hypot((x-cx)*kmX,(y-cy)*kmY)/radius,s=Math.max(0,Math.min(1,(d-.5)*2)),w=1-s*s*(3-2*s);
   if(w>weight){best={...pair,cx,cy};weight=w;}
  }
  let va=a[y*n+x],vb=b[y*n+x];
  if(best){const ax=x+(best.a.x-best.cx)*weight,ay=y+(best.a.y-best.cy)*weight,bx=x+(best.b.x-best.cx)*weight,by=y+(best.b.y-best.cy)*weight;
   if(Math.min(ax,ay,bx,by)>=0&&Math.max(ax,ay,bx,by)<=n-1){va=bilinear(a,n,ax,ay);vb=bilinear(b,n,bx,by);}}
  out[y*n+x]=va*(1-t)+vb*t;
 }
 return out;
}
export function nearestContour(segments,anchor,maxDistance=Infinity){
 let best=null,dist=maxDistance;
 for(const s of segments){if(s.level!==anchor.level)continue;const dx=s.end[0]-s.start[0],dy=s.end[1]-s.start[1],den=dx*dx+dy*dy;
  const t=den?Math.max(0,Math.min(1,((anchor.x-s.start[0])*dx+(anchor.y-s.start[1])*dy)/den)):0,x=s.start[0]+t*dx,y=s.start[1]+t*dy,d=Math.hypot(x-anchor.x,y-anchor.y);
  if(d<dist){dist=d;best={x,y,level:s.level};}}
 return best;
}
