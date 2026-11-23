import {forecastUrl,packedTile} from './forecast-host.mjs';
import {forecastOrder} from './forecast-order.mjs';
import {TerrainCache} from './terrain-cache.mjs';
// Static IFS tiles: decode to physical units before spatial interpolation.
export const FIELDS=['u','v','temperature','pressure','rain','snow','low','middle','high','ptype','snowCover','seaIce','snowlineWeighted','snowlineWeight','snowlineRegionalWeighted','snowlineRegionalWeight','snowlineModelHeight'];
const NEAREST=new Set(['ptype']);
export const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function tilePoint(lat,lon){
 const longitude=((lon%360)+360)%360,x=Math.floor(longitude/10),y=clamp(Math.floor((90-lat)/10),0,17);
 return {x,y,col:clamp((longitude-x*10)*10,0,100),row:clamp((90-y*10-lat)*10,0,100)};
}
export function decodeTile(buffer,manifest,count=10201){
 const view=new DataView(buffer),result={};let offset=0;
 for(const f of manifest.fields){const size=f.dtype==='u1'?1:2,a=new Float32Array(count);
  for(let i=0;i<a.length;i++){let v=(size===1?view.getUint8(offset+i):f.dtype==='<i2'?view.getInt16(offset+i*2,true):view.getUint16(offset+i*2,true))*f.scale;if(f.transform==='square')v*=v;a[i]=v;}
  result[f.name]=a;offset+=a.length*size;
 }
 if(offset!==buffer.byteLength)throw Error('Invalid weather tile size');return result;
}
export function decodePressure(buffer){
 if(buffer.byteLength!==10201*4)throw Error('Invalid pressure tile size');
 const view=new DataView(buffer),a=new Float32Array(10201);
 for(let i=0;i<a.length;i++){a[i]=view.getFloat32(i*4,true);if(!Number.isFinite(a[i]))throw Error('Invalid pressure value');}return a;
}
export function bilinear(a,n,x,y){
 x=clamp(x,0,n-1);y=clamp(y,0,n-1);const i=Math.min(n-2,Math.floor(x)),j=Math.min(n-2,Math.floor(y)),u=x-i,v=y-j,k=j*n+i;
 return (a[k]*(1-u)+a[k+1]*u)*(1-v)+(a[k+n]*(1-u)+a[k+n+1]*u)*v;
}
export function sampleField(name,a,n,x,y,height=n){
 if(!a)return name.startsWith('snowline')?0:-1;
 if(NEAREST.has(name))return a[Math.round(y)*n+Math.round(x)];
 const i=Math.min(n-2,Math.floor(x)),j=Math.min(height-2,Math.floor(y)),u=x-i,v=y-j,k=j*n+i;
 if(name!=='snowCover'&&name!=='seaIce')return (a[k]*(1-u)+a[k+1]*u)*(1-v)+(a[k+n]*(1-u)+a[k+n+1]*u)*v;
 const weights=[(1-u)*(1-v),u*(1-v),(1-u)*v,u*v],values=[a[k],a[k+1],a[k+n],a[k+n+1]];
 let sum=0,weight=0;for(let q=0;q<4;q++)if(values[q]>=0){sum+=values[q]*weights[q];weight+=weights[q];}
 return weight?sum/weight:-1;
}
export class WeatherData{
 constructor(){this.packIndexes=new Map();this.cache=new Map();this.global=new Map();this.disk=new TerrainCache('weather-explorer-forecast-v1',256*1024*1024);}
 async init(latest=null){latest=latest||await this.json('/global-data/latest.json');this.meta=await this.json('/global-data/'+latest.manifest);return this.meta;}
 async json(url){const r=await fetch(await forecastUrl(url),{cache:'no-store'});if(!r.ok)throw Error('IFS manifest unavailable');return r.json();}
 async surfaceCover(frame,name,count){
  const m=this.meta,info=m.surface_cover;
  const result={snowCover:new Float32Array(count).fill(-1),seaIce:new Float32Array(count).fill(-1),snowlineWeighted:new Float32Array(count),snowlineWeight:new Float32Array(count),snowlineRegionalWeighted:new Float32Array(count),snowlineRegionalWeight:new Float32Array(count),snowlineModelHeight:new Float32Array(count)};
  if(!info)return result;
  const bytes=await this.bytes(`/global-data/${m.run}/${info.path}/${String(m.steps[frame]).padStart(3,'0')}/${name}`);
  if(info.format===2||info.format===3){
   if(bytes.byteLength!==count*(info.format===3?14:8))throw Error('Invalid surface cover data');
   const view=new DataView(bytes);
   for(const [j,key]of Object.keys(result).slice(0,info.format===3?7:4).entries())for(let i=0;i<count;i++){
    const v=view.getUint16((j*count+i)*2,true);result[key][i]=j<2&&v===65535?-1:v*([2,4,6].includes(j)?.0002:1/65534);
   }
  }else{
   if(bytes.byteLength!==count*2)throw Error('Invalid surface cover data');
   const raw=new Uint8Array(bytes);
   for(const [j,key]of ['snowCover','seaIce'].entries())result[key]=Float32Array.from(raw.subarray(j*count,(j+1)*count),v=>v===255?-1:v/254);
  }
  return result;
 }
 async tile(frame,x,y){
  const m=this.meta,key=`${m.run}/${frame}/${x}/${y}`;
  if(this.cache.has(key)){const p=this.cache.get(key);this.cache.delete(key);this.cache.set(key,p);return p;}
  const promise=(async()=>{const base=`/global-data/${m.run}`,name=`${String(x).padStart(2,'0')}-${String(y).padStart(2,'0')}.bin.gz`,step=String(m.steps[frame]).padStart(3,'0');
   const tile=decodeTile(await this.bytes(`${base}/${step}/fine/${name}`),m);
   tile.ptype=m.ptype_path?new Uint8Array(await this.bytes(`${base}/${m.ptype_path}/${step}/${name}`)):new Float32Array(10201).fill(-1);
   if(m.pressure_path)tile.pressure=decodePressure(await this.bytes(`${base}/${m.pressure_path}/${step}/${name}`));Object.assign(tile,await this.surfaceCover(frame,name,10201));return tile;})();
  this.cache.set(key,promise);while(this.cache.size>96)this.cache.delete(this.cache.keys().next().value);
  try{return await promise;}catch(e){this.cache.delete(key);throw e;}
 }
 async bytes(url){
  url=await forecastUrl(url);
  let compressed=await this.disk.get(url);
  if(!compressed){if(this.meta?.packed_tiles)compressed=await packedTile(url,this.packIndexes);else{const r=await fetch(url);if(!r.ok)throw Error('IFS tile unavailable');compressed=await r.arrayBuffer();}void this.disk.put(url,compressed);}
  return new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
 }
 async globalFrame(frame){
  if(!this.global.has(frame)){
   const promise=this.bytes(`/global-data/${this.meta.run}/${this.meta.global_preview.path}/${String(this.meta.steps[frame]).padStart(3,'0')}.bin.gz`).then(async bytes=>{const a=decodeTile(bytes,this.meta,361*181);a.ptype=this.meta.ptype_path?new Uint8Array(await this.bytes(`/global-data/${this.meta.run}/${this.meta.ptype_path}/${String(this.meta.steps[frame]).padStart(3,'0')}/global.bin.gz`)):new Float32Array(361*181).fill(-1);Object.assign(a,await this.surfaceCover(frame,'global.bin.gz',361*181));return a;});
   this.global.set(frame,promise);promise.catch(()=>this.global.delete(frame));
  }
  return this.global.get(frame);
 }
 prioritise(frame){this.preloadOrder=forecastOrder(frame,this.meta.times.length).filter(f=>!this.globalReady?.has(f));}
 async preload(report=()=>{},first=0){
  if(!this.meta.global_preview)return;
  this.globalReady??=new Set();this.prioritise(first);
  await Promise.all([0,1].map(async()=>{while(this.preloadOrder.length){const f=this.preloadOrder.shift();await this.globalFrame(f);this.globalReady.add(f);report(this.globalReady.size,this.meta.times.length);}}));
 }
 async coarseGrid(frame,region,n=129){
  if(!this.meta.global_preview)return this.grid(frame,region,n);
  const source=await this.globalFrame(frame),out=Object.fromEntries(FIELDS.map(k=>[k,new Float32Array(n*n)]));
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){
   const x=((region.west+i/(n-1)*region.lonSpan)%360+360)%360,y=clamp(90-region.north+j/(n-1)*region.latSpan,0,180);
   for(const name of FIELDS){const a=source[name];out[name][j*n+i]=sampleField(name,a,361,x,y,181);}
  }
  return {fields:out,n,region,frame,quality:'coarse'};
 }
 async temperature(frame,lat,lon){
  const p=tilePoint(lat,lon),a=await this.tile(frame,p.x,p.y);
  return sampleField('temperature',a.temperature,101,p.col,p.row);
 }
 async point(frame,lat,lon){
  const p=tilePoint(lat,lon),a=await this.tile(frame,p.x,p.y),out={};
  for(const k of FIELDS)out[k]=sampleField(k,a[k],101,p.col,p.row);
  if(this.meta.point_fields){
   const extra=decodeTile(await this.bytes(`/global-data/${this.meta.run}/${this.meta.point_fields.path}/${String(this.meta.steps[frame]).padStart(3,'0')}/${String(p.x).padStart(2,'0')}-${String(p.y).padStart(2,'0')}.bin.gz`),this.meta.point_fields);
   for(const [k,values]of Object.entries(extra))out[k]=bilinear(values,101,p.col,p.row);
  }
  return out;
 }
 async grid(frame,region,n=129,current=()=>true){
  const groups=new Map(),out=Object.fromEntries(FIELDS.map(k=>[k,new Float32Array(n*n)]));
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){
   const p=tilePoint(region.north-j/(n-1)*region.latSpan,region.west+i/(n-1)*region.lonSpan),key=p.x+','+p.y;
   if(!groups.has(key))groups.set(key,[]);groups.get(key).push({...p,index:j*n+i});
  }
  const jobs=[...groups.values()];await Promise.all(Array.from({length:4},async()=>{while(jobs.length){if(!current())throw Error('Superseded weather view');const points=jobs.shift(),a=await this.tile(frame,points[0].x,points[0].y);for(const p of points)for(const k of FIELDS)out[k][p.index]=sampleField(k,a[k],101,p.col,p.row);}}));
  return {fields:out,n,region,frame,quality:'fine'};
 }
}
