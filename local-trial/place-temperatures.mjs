import {TerrainCache} from './terrain-cache.mjs';
// Whole point timelines are tiny; retain them across Local/globe visits.
export function temperatureText(name,a,b,t,units){
 if(!Number.isFinite(a)||!Number.isFinite(b))return name;
 return name+' '+Math.round(units.convert(a+(b-a)*t,'°C'))+'°';
}
export class PlaceTemperatures{
 constructor(weather,labels,centre=()=>null){
  Object.assign(this,{weather,labels,centre});this.cache=new Map();this.active=0;this.elapsed=0;
  this.disk=new TerrainCache('weather-explorer-place-temperatures-v1',4*1024*1024);
 }
 entry(data,p){
  const key=[data.meta.run,...data.meta.steps,p.lat.toFixed(5),p.lon.toFixed(5)].join('/');
  let e=this.cache.get(key);if(e)return e;
  e={key,data,lat:p.lat,lon:p.lon,values:Array(data.meta.times.length).fill(null),pending:new Set(),loading:true,retry:0};
  this.cache.set(key,e);
  this.disk.get(key).then(buffer=>{
   if(buffer&&buffer.byteLength===e.values.length*4){const values=[...new Float32Array(buffer)];if(values.every(Number.isFinite)){e.values=values;e.complete=true;}}
  }).finally(()=>e.loading=false);
  return e;
 }
 tick(dt){
  this.elapsed+=dt;if(this.elapsed<.25)return;this.elapsed=0;
  const w=this.weather,data=w.data;if(!data.meta)return;
  const enabled=document.getElementById('placeTemperatures')?.checked??true;
  const rows=this.labels.visible.filter(p=>!p.element.hidden),centre=this.centre();if(centre)rows.unshift(centre);
  const f=w.displayFrame??w.frame??0,a=Math.floor(f),t=f-a,b=t?Math.min(a+1,data.meta.times.length-1):a,priorities=[];
  for(const p of rows){
   let el=p.element.querySelector('.placeTemperature');
   if(!el){el=document.createElement('span');el.className='placeTemperature';p.element.append(el);}
   const e=enabled?this.entry(data,p):null;
   if(e)priorities.push(e);
   // Publish only a complete series: scrubbing and playback then have no gaps.
   const text=e?.complete&&w.temperatureTimeAvailable!==false?temperatureText('',e.values[a],e.values[b],t,Units).trim():'';
   if(el.textContent!==text)el.textContent=text;
   el.hidden=!text;
  }
  if(!enabled)return;
  // Current labels first; finish previously displayed places in the background.
  for(const e of new Set([...priorities,...this.cache.values()])){
   if(this.active>=4)break;
   if(e.data!==data||e.complete||e.loading||e.retry>Date.now())continue;
   const order=[a,b,...e.values.keys()],frame=order.find(i=>i>=0&&i<e.values.length&&e.values[i]===null&&!e.pending.has(i));
   if(frame===undefined)continue;
   this.active++;e.pending.add(frame);
   e.data.temperature(frame,e.lat,e.lon).then(value=>{
    if(!Number.isFinite(value))throw Error('Temperature unavailable');
    e.values[frame]=value;
    if(e.values.every(Number.isFinite)){e.complete=true;void this.disk.put(e.key,new Float32Array(e.values).buffer);}
   }).catch(()=>{e.retry=Date.now()+30000;}).finally(()=>{e.pending.delete(frame);this.active--;});
  }
  if(this.cache.size>256)for(const [key,e]of this.cache){if(this.cache.size<=256)break;if(!priorities.includes(e)&&!e.pending.size)this.cache.delete(key);}
 }
}
