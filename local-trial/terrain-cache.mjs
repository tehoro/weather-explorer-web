// Sampled immutable terrain, retained across visits to the same browser origin.
// Cache failure is never a terrain failure (private browsing, quota, eviction).
export const terrainCacheKey=(kind,p,size,{halo=0,centres=false}={})=>
 `cop90-wc2021-v1/${kind}/${p.west}/${p.south}/${p.span}/${size}/${halo}/${+centres}`;
export class TerrainCache{
 constructor(name='weather-explorer-terrain-v1',limit=256*1024*1024){
  this.limit=limit;this.hits=0;this.writes=Promise.resolve();
  this.db=new Promise(resolve=>{
   if(!globalThis.indexedDB){resolve(null);return;}
   const request=indexedDB.open(name,1);
   request.onupgradeneeded=()=>{request.result.createObjectStore('grids');request.result.createObjectStore('usage',{keyPath:'key'});};
   request.onsuccess=()=>resolve(request.result);
   request.onerror=request.onblocked=()=>resolve(null);
  });
 }
 async get(key){
  try{
   const db=await this.db;if(!db)return null;
   const value=await new Promise((resolve,reject)=>{const tx=db.transaction('grids'),r=tx.objectStore('grids').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   if(!value)return null;this.hits++;
   this.write(db,tx=>tx.objectStore('usage').put({key,bytes:value.byteLength,at:Date.now()}));
   return value;
  }catch{return null;}
 }
 write(db,change){
  this.writes=this.writes.then(()=>new Promise((resolve,reject)=>{
   const tx=db.transaction(['grids','usage'],'readwrite');tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error);change(tx);
  })).catch(()=>{});return this.writes;
 }
 async put(key,value){
  try{
   const db=await this.db;if(!db||value.byteLength>this.limit)return;
   await this.write(db,tx=>{
    const usage=tx.objectStore('usage'),grids=tx.objectStore('grids');
    grids.put(value,key);usage.put({key,bytes:value.byteLength,at:Date.now()});
    const request=usage.getAll();request.onsuccess=()=>{
     const rows=request.result.sort((a,b)=>a.at-b.at);let bytes=rows.reduce((n,r)=>n+r.bytes,0);
     for(const row of rows){if(bytes<=this.limit)break;if(row.key===key)continue;bytes-=row.bytes;grids.delete(row.key);usage.delete(row.key);}
    };
   });
  }catch{/* Continue streaming if browser storage is unavailable. */}
 }
}
