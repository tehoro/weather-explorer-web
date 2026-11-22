export function placeTiles(region,available){
 const result=new Set(),{west,north,lonSpan,latSpan}=region;
 for(let y=Math.max(0,Math.floor((90-north)/5));y<=Math.min(35,Math.floor((90-north+latSpan)/5));y++)
 for(let x=Math.floor((west+180)/5);x<=Math.floor((west+180+lonSpan)/5);x++){
  const key=String(((x%72)+72)%72).padStart(2,'0')+'-'+String(y).padStart(2,'0');if(available.has(key))result.add(key);
 }return [...result];
}
export function overlaps(a,b,padding=0){return a.left<b.right+padding&&a.right>b.left-padding&&a.top<b.bottom+padding&&a.bottom>b.top-padding;}
// Prefer population, spread names across the screen and retain close contenders.
export function selectPlaces(candidates,blocked=[],previous=new Set(),limit=5,isVisible=()=>true){
 const remaining=candidates.filter(p=>!blocked.some(b=>overlaps(p.box,b,8))),chosen=[];
 while(remaining.length&&chosen.length<limit){
  let best=null,score=-Infinity;
  for(const p of remaining){
   if(chosen.some(q=>overlaps(p.box,q.box,22)||Math.hypot(p.x-q.x,p.y-q.y)<65))continue;
   const separation=chosen.length?Math.min(...chosen.map(q=>Math.hypot(p.x-q.x,p.y-q.y))):300;
   const value=Math.log10(Math.max(500,p.population))+(p.capital?.35:0)+Math.min(1.4,separation/180)+(previous.has(p.id)?.3:0);
   if(value>score){best=p;score=value;}
  }
  if(!best)break;remaining.splice(remaining.indexOf(best),1);if(isVisible(best))chosen.push(best);
 }return chosen;
}
