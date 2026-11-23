export class TerrainWorker{
 constructor(catalogue){
  this.worker=new Worker(new URL('./terrain-worker.mjs?v=20261124a',import.meta.url),{type:'module'});this.jobs=new Map();this.next=0;this.saved={hits:0};
  this.worker.onmessage=({data:{id,value,error,hits}})=>{const job=this.jobs.get(id);if(!job)return;this.jobs.delete(id);if(hits!==undefined)this.saved.hits=hits;error?job.reject(Error(error)):job.resolve(value);};
  this.worker.onerror=e=>{this.error=Error(e.message||'Terrain worker failed');for(const job of this.jobs.values())job.reject(this.error);this.jobs.clear();};
  this.ready=this.call('init',[[...catalogue]]);
 }
 call(method,args){if(this.error)return Promise.reject(this.error);return new Promise((resolve,reject)=>{const id=++this.next;this.jobs.set(id,{resolve,reject});try{this.worker.postMessage({id,method,args});}catch(e){this.jobs.delete(id);reject(e);}});}
 grid(...args){return this.call('grid',args);}
 clear(){void this.call('clear',[]).catch(()=>{});}
}
