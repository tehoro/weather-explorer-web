// One-degree buckets avoid scanning every loaded tile for every particle.
const wrap=lon=>((lon+180)%360+360)%360-180;
export class TerrainIndex{
 rebuild(tiles){
  this.buckets=new Map();
  for(const t of tiles){
   if(!t.mesh.visible)continue;
   const p=t.p;
   for(let y=Math.floor(p.south);y<=Math.floor(p.south+p.span);y++)for(let x=Math.floor(p.west);x<=Math.floor(p.west+p.span);x++){
    const key=`${y}/${Math.floor(wrap(x))}`;
    if(!this.buckets.has(key))this.buckets.set(key,[]);
    this.buckets.get(key).push(t);
   }
  }
  for(const list of this.buckets.values())list.sort((a,b)=>a.p.span/a.p.cells-b.p.span/b.p.cells);
 }
 find(lat,lon){
  for(const t of this.buckets?.get(`${Math.floor(lat)}/${Math.floor(wrap(lon))}`)||[]){
   const dx=((lon-t.p.west)%360+360)%360,dy=t.p.south+t.p.span-lat;
   if(dx<=t.p.span&&dy>=0&&dy<=t.p.span)return {p:t.p,mesh:t.mesh,dx,dy};
  }
  return null;
 }
}
