// Static IFS tiles: decode to physical units before spatial interpolation.
export const FIELDS=['u','v','temperature','pressure','rain','snow','low','middle','high'];
export const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function tilePoint(lat,lon){
 const longitude=((lon%360)+360)%360,x=Math.floor(longitude/10),y=clamp(Math.floor((90-lat)/10),0,17);
 return {x,y,col:clamp((longitude-x*10)*10,0,100),row:clamp((90-y*10-lat)*10,0,100)};
}
export function decodeTile(buffer,manifest){
 const view=new DataView(buffer),result={};let offset=0;
 for(const f of manifest.fields){const size=f.dtype==='u1'?1:2,a=new Float32Array(10201);
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
export class WeatherData{
 constructor(){this.cache=new Map();}
 async init(latest=null){latest=latest||await this.json('/global-data/latest.json');this.meta=await this.json('/global-data/'+latest.manifest);return this.meta;}
 async json(url){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error('IFS manifest unavailable');return r.json();}
 async tile(frame,x,y){
  const m=this.meta,key=`${m.run}/${frame}/${x}/${y}`;
  if(this.cache.has(key)){const p=this.cache.get(key);this.cache.delete(key);this.cache.set(key,p);return p;}
  const promise=(async()=>{const r=await fetch(`/global-data/${m.run}/${String(m.steps[frame]).padStart(3,'0')}/fine/${String(x).padStart(2,'0')}-${String(y).padStart(2,'0')}.bin.gz`);if(!r.ok)throw Error('IFS tile unavailable');const tile=decodeTile(await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(),m);
   if(m.pressure_path){const p=await fetch(`/global-data/${m.run}/${m.pressure_path}/${String(m.steps[frame]).padStart(3,'0')}/${String(x).padStart(2,'0')}-${String(y).padStart(2,'0')}.bin.gz`);if(!p.ok)throw Error('IFS pressure tile unavailable');tile.pressure=decodePressure(await new Response(p.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());}return tile;})();
  this.cache.set(key,promise);while(this.cache.size>96)this.cache.delete(this.cache.keys().next().value);
  try{return await promise;}catch(e){this.cache.delete(key);throw e;}
 }
 async grid(frame,region,n=129,current=()=>true){
  const groups=new Map(),out=Object.fromEntries(FIELDS.map(k=>[k,new Float32Array(n*n)]));
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){
   const p=tilePoint(region.north-j/(n-1)*region.latSpan,region.west+i/(n-1)*region.lonSpan),key=p.x+','+p.y;
   if(!groups.has(key))groups.set(key,[]);groups.get(key).push({...p,index:j*n+i});
  }
  const jobs=[...groups.values()];await Promise.all(Array.from({length:4},async()=>{while(jobs.length){if(!current())throw Error('Superseded weather view');const points=jobs.shift(),a=await this.tile(frame,points[0].x,points[0].y);for(const p of points)for(const k of FIELDS)out[k][p.index]=bilinear(a[k],101,p.col,p.row);}}));
  return {fields:out,n,region,frame};
 }
}
