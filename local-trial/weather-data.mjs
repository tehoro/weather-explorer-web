// The worker owns decoded global previews, detail tiles and disk-cache access.
import {WeatherData as Engine} from './weather-engine.mjs?v=20261122ae';
export {FIELDS,clamp,tilePoint,decodeTile,decodePressure,bilinear} from './weather-engine.mjs?v=20261122ae';
export class WeatherData extends Engine{
 constructor(){
  super();this.serial=0;this.requests=new Map();
  if(typeof Worker!=='undefined'){
   this.worker=new Worker(new URL('./weather-worker.mjs?v=20261122ae',import.meta.url),{type:'module'});
   this.worker.onmessage=({data})=>{if(data.progress){this.preloadProgress=data.progress;return;}const p=this.requests.get(data.id);if(!p)return;this.requests.delete(data.id);data.error?p.reject(Error(data.error)):p.resolve(data.value);};
   this.worker.onerror=()=>{this.workerFailed=true;for(const p of this.requests.values())p.reject(Error('Weather worker failed; reload to retry.'));this.requests.clear();};
  }
 }
 rpc(method,args){if(this.workerFailed)return Promise.reject(Error('Weather worker failed; reload to retry.'));return new Promise((resolve,reject)=>{const id=++this.serial;this.requests.set(id,{resolve,reject});this.worker.postMessage({id,method,args});});}
 async init(latest=null){this.meta=this.worker?await this.rpc('init',[latest,{step:Number(new URLSearchParams(globalThis.location?.search||'').get('step')),time:Date.parse(new URLSearchParams(globalThis.location?.search||'').get('time'))||Date.now()}]):await super.init(latest);return this.meta;}
 async grid(frame,region,n=129,current=()=>true){
  if(!this.worker)return super.grid(frame,region,n,current);
  if(!current())throw Error('Superseded weather view');
  const result=await this.rpc('coarse',[frame,region,n]);if(!current())throw Error('Superseded weather view');return result;
 }
 point(frame,lat,lon){return this.worker?this.rpc('point',[frame,lat,lon]):super.point(frame,lat,lon);}
 prioritise(frame){this.worker?.postMessage({method:'priority',args:[frame]});}
 setRegion(key){this.worker?.postMessage({method:'region',args:[key]});}
 async detailGrid(frame,region,n=129,current=()=>true){
  if(!this.worker)return super.grid(frame,region,n,current);
  if(!current())throw Error('Superseded weather view');
  const key=JSON.stringify(region);this.setRegion(key);
  const result=await this.rpc('fine',[frame,region,n,key]);if(!current())throw Error('Superseded weather view');return result;
 }
 dispose(){this.worker?.terminate();for(const p of this.requests.values())p.reject(Error('Forecast replaced'));this.requests.clear();}
}
