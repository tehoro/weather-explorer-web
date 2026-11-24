// Shared byte budget across GeoTIFF images. In-flight decodes are deduplicated;
// eviction only releases our reference, never a block being read by a caller.
export class DecodedBlockCache{
 constructor(limit=32*1024*1024){this.limit=limit;this.bytes=0;this.ready=new Map();this.pending=new Map();this.serial=0;}
 async get(key,load){
  if(this.ready.has(key)){const value=this.ready.get(key);this.ready.delete(key);this.ready.set(key,value);return value;}
  if(this.pending.has(key))return this.pending.get(key);
  const promise=Promise.resolve().then(load).then(value=>{
   const size=value.data.byteLength;
   if(size<=this.limit){this.ready.set(key,value);this.bytes+=size;
    while(this.bytes>this.limit){const first=this.ready.keys().next().value;this.bytes-=this.ready.get(first).data.byteLength;this.ready.delete(first);}
   }
   return value;
  }).finally(()=>this.pending.delete(key));
  this.pending.set(key,promise);return promise;
 }
 wrap(image){const id=++this.serial,read=image.getTileOrStrip.bind(image);
  image.getTileOrStrip=(x,y,sample,...rest)=>this.get(`${id}/${x}/${y}/${sample}`,()=>read(x,y,sample,...rest));return image;
 }
}
