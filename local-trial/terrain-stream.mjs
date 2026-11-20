// Pure geographic and LOD helpers shared with the local checks.
export const wrap=lon=>((lon+180)%360+360)%360-180;
export function demName(lat,lon){const y=Math.floor(lat),x=Math.floor(wrap(lon));return `Copernicus_DSM_COG_30_${y<0?'S':'N'}${String(Math.abs(y)).padStart(2,'0')}_00_${x<0?'W':'E'}${String(Math.abs(x)).padStart(3,'0')}_00_DEM`;}
export function waterName(lat,lon){const y=Math.floor(lat/3)*3,x=Math.floor(wrap(lon)/3)*3;return `ESA_WorldCover_10m_2021_v200_${y<0?'S':'N'}${String(Math.abs(y)).padStart(2,'0')}${x<0?'W':'E'}${String(Math.abs(x)).padStart(3,'0')}_Map`;}
export function detail(distance){return distance<90?{span:.25,cells:distance<35?300:distance<65?150:75}:{span:1,cells:distance<160?150:75};}
export function wantedTiles(lat,lon,distance){
 const {span,cells}=detail(distance),cos=Math.max(.015,Math.cos(lat*Math.PI/180));
 const radius=Math.max(20,distance*.85),dy=radius/111.2,dx=Math.min(180,radius/(111.2*cos));
 const tiles=[];
 for(let y=Math.max(-90,Math.floor((lat-dy)/span)*span);y<Math.min(90,lat+dy+span);y+=span)
 for(let x=Math.floor((lon-dx)/span)*span;x<lon+dx+span;x+=span){
   const d=Math.hypot((x+span/2-lon)*111.2*cos,(y+span/2-lat)*111.2);
   if(d>radius+span*111.2*.8)continue;
   const west=wrap(x),south=y;
   tiles.push({west,south,span,cells,key:`${west}/${south}/${span}/${cells}`,distance:d});
 }
 return tiles.sort((a,b)=>a.distance-b.distance).slice(0,64);
}

// Include distant ground seen through a tilted camera, not just a radius about
// its target. Far tiles use coarse geometry; the globe basemap fills immediately.
export function intersectsFootprint(rect,polygon){
 const box=[[rect[0],rect[1]],[rect[2],rect[1]],[rect[2],rect[3]],[rect[0],rect[3]]];
 const axes=[[1,0],[0,1]];
 for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length];axes.push([a[1]-b[1],b[0]-a[0]]);}
 for(const [x,y] of axes){const a=box.map(p=>p[0]*x+p[1]*y),b=polygon.map(p=>p[0]*x+p[1]*y);if(Math.max(...a)<Math.min(...b)||Math.max(...b)<Math.min(...a))return false;}
 return true;
}
export function viewTiles(lat,lon,distance,footprint){
 const near=wantedTiles(lat,lon,distance),cos=Math.max(.015,Math.cos(lat*Math.PI/180));
 const occupied=new Map();
 for(const p of near){const key=`${Math.floor(p.west)}/${Math.floor(p.south)}`;if(!occupied.has(key))occupied.set(key,[]);occupied.get(key).push(p);}
 const xs=footprint.map(p=>p[0]),zs=footprint.map(p=>p[1]);
 const west=Math.max(lon-180,lon+Math.min(...xs)/(111.2*cos)-1),east=Math.min(lon+180,lon+Math.max(...xs)/(111.2*cos)+1);
 const south=Math.max(-90,lat-Math.max(...zs)/111.2-1),north=Math.min(90,lat-Math.min(...zs)/111.2+1),far=[];
 for(let y=Math.floor(south);y<north;y++)for(let x=Math.floor(west);x<east;x++){
  const w=wrap(x),children=occupied.get(`${w}/${y}`)||[];
  if(children.some(p=>p.span===1)||children.length===16)continue;
  const rect=[(x-lon)*111.2*cos,(lat-y-1)*111.2,(x+1-lon)*111.2*cos,(lat-y)*111.2];
  if(!intersectsFootprint(rect,footprint))continue;
  const d=Math.hypot((x+.5-lon)*111.2*cos,(y+.5-lat)*111.2);
  // A single fine patch does not cover its whole one-degree parent. Fill
  // every uncovered quarter at the transition, without overlapping fine meshes.
  if(children.length){
   for(let j=0;j<4;j++)for(let i=0;i<4;i++){
    const west=wrap(x+i*.25),south=y+j*.25;
    if(children.some(p=>p.west===west&&p.south===south))continue;
    const r=[(x+i*.25-lon)*111.2*cos,(lat-south-.25)*111.2,(x+(i+1)*.25-lon)*111.2*cos,(lat-south)*111.2];
    if(intersectsFootprint(r,footprint))far.push({west,south,span:.25,cells:25,key:`${west}/${south}/0.25/25`,distance:d,background:true,transition:true});
   }
  }else far.push({west:w,south:y,span:1,cells:25,key:`${w}/${y}/1/25`,distance:d,background:true});
 }
 return near.concat(far.sort((a,b)=>Number(!!b.transition)-Number(!!a.transition)||a.distance-b.distance).slice(0,192));
}
