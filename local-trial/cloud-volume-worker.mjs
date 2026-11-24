import {tilePoint} from './cloud-tile-grid.mjs';
import {forecastUrl,packedTile} from './forecast-host.mjs';
const indexes=new Map();
const cache=new Map(),pending=new Map(),MAX=48*1024*1024;let cacheBytes=0;
async function tile(url,expected,stats){
 if(cache.has(url)){const a=cache.get(url);cache.delete(url);cache.set(url,a);stats.hits++;return a;}
 if(pending.has(url))return pending.get(url);
 const p=(async()=>{
  const compressed=await packedTile(await forecastUrl(url),indexes);stats.bytes+=compressed.byteLength;stats.requests++;
  const raw=await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  if(raw.byteLength!==expected)throw Error('Invalid cloud tile length');
  const a=new Uint8Array(raw);cache.set(url,a);cacheBytes+=a.byteLength;
  while(cacheBytes>MAX&&cache.size>1){const key=cache.keys().next().value;cacheBytes-=cache.get(key).byteLength;cache.delete(key);}
  return a;
 })().finally(()=>pending.delete(url));pending.set(url,p);return p;
}
async function frame(job,step,stats){
 const {region,G,V,level,res,run}=job,side=Math.round(20/res)+1;
 const points=[];for(let j=0;j<G;j++)for(let i=0;i<G;i++)points.push(tilePoint(region.north-j/(G-1)*region.latSpan,region.west+i/(G-1)*region.lonSpan,res));
 const groups=new Map();points.forEach((p,n)=>{if(!groups.has(p.key))groups.set(p.key,[]);groups.get(p.key).push(n);});
 const keys=[...groups.keys()],out=new Uint8Array(G*V*G*4);
 let next=0;
 // Assemble each source tile immediately: a wide view must not retain every
 // decoded tile in addition to the bounded reuse cache.
 await Promise.all(Array.from({length:Math.min(4,keys.length)},async()=>{
  while(next<keys.length){const key=keys[next++],url=`/global-data/${run}/cloud-v2/${String(step).padStart(3,'0')}/${level}/${key}.bin.gz`;
   const a=await tile(url,side*side*V*4,stats);
   for(const n of groups.get(key)){
    const p=points[n],ix=Math.min(side-2,Math.floor(p.x)),iy=Math.min(side-2,Math.floor(p.y)),u=p.x-ix,v=p.y-iy,i=n%G,j=Math.floor(n/G);
    for(let z=0;z<V;z++){
     const q=((iy*V+z)*side+ix)*4,d=(i+G*(z+V*j))*4,dy=V*side*4;
     for(let c=0;c<4;c++)out[d+c]=Math.round((a[q+c]*(1-u)+a[q+4+c]*u)*(1-v)+(a[q+dy+c]*(1-u)+a[q+dy+4+c]*u)*v);
    }
   }
  }
 }));
 stats.tiles+=keys.length;return out;
}
self.onmessage=async({data:job})=>{
 const start=performance.now(),stats={bytes:0,requests:0,hits:0,tiles:0};
 try{
  const a=await frame(job,job.steps[0],stats),b=await frame(job,job.steps[1],stats);
  stats.ms=Math.round(performance.now()-start);stats.cacheMiB=+(cacheBytes/1048576).toFixed(1);
  self.postMessage({id:job.id,a:a.buffer,b:b.buffer,stats},[a.buffer,b.buffer]);
 }catch(e){self.postMessage({id:job.id,error:e.message})}
};
