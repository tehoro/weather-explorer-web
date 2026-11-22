import {wrap,demName,waterName} from './terrain-stream.mjs';
import {TerrainCache,terrainCacheKey} from './terrain-cache.mjs?v=20261122j';
export const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
export function isWater(code,height,ocean=false){return ocean||code===80||(code===0&&Math.abs(height)<.01);}
export function sourceName(kind,lat,lon){return kind==='dem'?demName(Math.max(-89.99999999,lat-1e-9),lon+1e-9):waterName(Math.min(89.99999999,lat),lon);}
export function pixelTransform(origin,res,baseW,baseH,w,h,point){
 const fx=baseW/w,fy=baseH/h;
 return {x:origin[0]+res[0]*(point?(fx-1)/2:fx/2),y:origin[1]+res[1]*(point?(fy-1)/2:fy/2),dx:res[0]*fx,dy:res[1]*fy};
}
export function sample(a,w,h,x,y,nearest=false){
 x=clamp(x,0,w-1);y=clamp(y,0,h-1);
 if(nearest)return a[Math.round(y)*w+Math.round(x)];
 const i=Math.floor(x),j=Math.floor(y),u=x-i,v=y-j,ii=Math.min(i+1,w-1),jj=Math.min(j+1,h-1);
 return (a[j*w+i]*(1-u)+a[j*w+ii]*u)*(1-v)+(a[jj*w+i]*(1-u)+a[jj*w+ii]*u)*v;
}
// Browser byte cache + GeoTIFF decoded-block cache; reuse image objects as well.
export class RasterReader{
 constructor(G,base='',catalogue=new Set()){this.G=G;this.base=base;this.catalogue=catalogue;this.files=new Map();this.saved=new TerrainCache();}
 async file(kind,name){
  const key=kind+'/'+name;
  if(this.files.has(key)){const f=this.files.get(key);this.files.delete(key);this.files.set(key,f);return f;}
  const bytes=new Map(),url=this.base+`/remote/${kind}/${name}.tif`;
  const source={fetch:async ranges=>Promise.all(ranges.map(async({offset,length})=>{
   const start=Math.floor(offset/65536)*65536,end=Math.ceil((offset+length)/65536)*65536-1,key=start+'-'+end;
   let request=bytes.get(key);
   if(!request){request=fetch(url,{headers:{Range:`bytes=${start}-${end}`}}).then(async r=>{if(r.status!==206)throw Error('Source range HTTP '+r.status);return r.arrayBuffer();});bytes.set(key,request);request.catch(()=>bytes.delete(key));}
   const b=await request;while(bytes.size>32)bytes.delete(bytes.keys().next().value);
   return b.slice(offset-start,offset-start+length);
  }))};
  const promise=this.G.GeoTIFF.fromSource(source,{cache:true}).then(t=>({t,images:new Map(),count:t.getImageCount()}));this.files.set(key,promise);
  try{const result=await promise;while(this.files.size>12)this.files.delete(this.files.keys().next().value);return result;}catch(e){this.files.delete(key);throw e;}
 }
 async image(file,i){if(!file.images.has(i))file.images.set(i,file.t.getImage(i));return file.images.get(i);}
 async grid(kind,p,size,{halo=0,centres=false}={}){
  const key=terrainCacheKey(kind,p,size,{halo,centres}),cached=await this.saved.get(key);
  if(cached)return cached;
  const step=p.span/(centres?size:size-1),outSize=size+halo*2;
  const xs=Array.from({length:outSize},(_,i)=>wrap(Math.round((p.west+(i-halo+(centres?.5:0))*step)*1e10)/1e10));
  const ys=Array.from({length:outSize},(_,i)=>clamp(Math.round((p.south+p.span-(i-halo+(centres?.5:0))*step)*1e10)/1e10,-90,90));
  const groups=new Map(),out=new Float32Array(outSize*outSize);
  for(let y=0;y<outSize;y++)for(let x=0;x<outSize;x++){
   const name=sourceName(kind,ys[y],xs[x]);if(kind==='dem'&&!this.catalogue.has(name))continue;
   if(!groups.has(name))groups.set(name,[]);groups.get(name).push(y*outSize+x);
  }
  // Serial source windows bound simultaneous native DEM decodes; independent terrain
  // patches are scheduled separately by the viewer.
  for(const [name,indices]of groups){
   const file=await this.file(kind,name),base=await this.image(file,0);let im=base;
   for(let i=1;i<await file.count;i++){const candidate=await this.image(file,i),res=Math.abs(base.getResolution()[1])*base.getHeight()/candidate.getHeight();if(res<=step*1.1&&candidate.getHeight()<im.getHeight())im=candidate;}
   const w=im.getWidth(),h=im.getHeight(),transform=pixelTransform(base.getOrigin(),base.getResolution(),base.getWidth(),base.getHeight(),w,h,base.getGeoKeys().GTRasterTypeGeoKey===2);
   const coords=indices.map(index=>({index,x:clamp((xs[index%outSize]-transform.x)/transform.dx,0,w-1),y:clamp((ys[Math.floor(index/outSize)]-transform.y)/transform.dy,0,h-1)}));
   let minX=w,minY=h,maxX=0,maxY=0;for(const c of coords){minX=Math.min(minX,c.x);minY=Math.min(minY,c.y);maxX=Math.max(maxX,c.x);maxY=Math.max(maxY,c.y);}
   const x0=Math.floor(minX),y0=Math.floor(minY),x1=Math.min(w,Math.ceil(maxX)+2),y1=Math.min(h,Math.ceil(maxY)+2);
   const data=await im.readRasters({window:[x0,y0,x1,y1],interleave:true});
   for(const c of coords)out[c.index]=sample(data,x1-x0,y1-y0,c.x-x0,c.y-y0,kind==='water');
  }
  void this.saved.put(key,out);return out;
 }
}
