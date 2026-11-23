// Camera travel uses kilometres; forecast time is independent of the journey.
export const ARRIVAL={height:32,south:75};
export const ease=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
export function distanceKm(a,b){const r=Math.PI/180,dlat=(b.lat-a.lat)*r,dlon=(b.lon-a.lon)*r,h=Math.sin(dlat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dlon/2)**2;return 12742*Math.asin(Math.sqrt(Math.min(1,h)));}
export const globeTravel=(a,b)=>distanceKm(a,b)>800||Math.max(Math.abs(a.lat),Math.abs(b.lat))>75;
export function bezier(a,b,c,d,t){const u=1-t;return Object.fromEntries(['x','y','z'].map(k=>[k,u*u*u*a[k]+3*u*u*t*b[k]+3*u*t*t*c[k]+t*t*t*d[k]]));}
export function globeJourney(t){return {turn:ease((t-.2)/.6),radius:t<.2?1.2+2.3*ease(t/.2):t>.8?3.5-2.3*ease((t-.8)/.2):3.5};}
