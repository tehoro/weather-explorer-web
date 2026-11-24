import test from 'node:test';
import assert from 'node:assert/strict';
import {DecodedBlockCache} from './decoded-block-cache.mjs';
import {WeatherData} from './weather-engine.mjs';
import {RasterReader} from './terrain-raster.mjs';
import {colourTile} from './terrain-preparation.mjs';

test('decoded terrain blocks obey a shared byte budget, reuse reads and retry errors',async()=>{
 const cache=new DecodedBlockCache(16);let reads=0;
 const image=cache.wrap({getTileOrStrip:async(x,y,sample)=>{reads++;return {x,y,sample,data:new Uint8Array(8).fill(x).buffer};}});
 const [a,b]=await Promise.all([image.getTileOrStrip(1,0,0),image.getTileOrStrip(1,0,0)]);
 assert.equal(a,b);assert.equal(reads,1);
 for(let x=2;x<100;x++){await image.getTileOrStrip(x,0,0);assert.ok(cache.bytes<=16);}
 assert.equal(cache.ready.size,2);assert.deepEqual([...new Uint8Array(a.data)],Array(8).fill(1));
 await assert.rejects(cache.get('bad',()=>{throw Error('decode failed');}));
 assert.equal(cache.pending.size,0);await cache.get('bad',()=>({data:new ArrayBuffer(4)}));
});
test('global forecast retains only four decoded frames with unchanged values on revisit',async()=>{
 const data=new WeatherData();data.meta={run:'test',steps:Array.from({length:28},(_,i)=>i*3),global_preview:{path:'global'},fields:[{name:'temperature',dtype:'u1',scale:1}]};
 let reads=0;data.bytes=async()=>{reads++;return new Uint8Array(361*181).fill(17).buffer;};
 for(let i=0;i<28;i++){const frame=await data.globalFrame(i);assert.equal(frame.temperature[123],17);assert.ok(data.global.size<=4);}
 const before=reads;await data.globalFrame(27);assert.equal(reads,before);
 const frame=await data.globalFrame(0);assert.equal(frame.temperature[123],17);assert.equal(reads,before+1);
});
test('legacy float land-cover cache becomes lossless bytes and renders identical colours',async()=>{
 const water=Float32Array.from({length:64*64},(_,i)=>[0,10,20,30,40,50,60,70,80,90,95,100][i%12]);
 const reader=new RasterReader({});reader.saved.get=async()=>water;
 const bytes=await reader.grid('water',{},64);assert.ok(bytes instanceof Uint8Array);assert.equal(bytes.byteLength,water.byteLength/4);
 const tile={p:{cells:4,background:true},a:new Float32Array(49).fill(250),ocean:false};
 for(const mode of ['relief','cover','hybrid'])assert.deepEqual(colourTile({...tile,water},mode),colourTile({...tile,water:bytes},mode));
});

test('streaming cloud assembly is byte-identical to whole-region assembly',async()=>{
 const {readFileSync}=await import('node:fs');const {tilePoint}=await import('./cloud-tile-grid.mjs');
 const source=readFileSync(new URL('./cloud-volume-worker.mjs',import.meta.url),'utf8');
 const code=source.slice(source.indexOf('async function frame('),source.indexOf('self.onmessage='));
 const G=9,V=4,res=1,side=21,region={north:48,west:165,latSpan:80,lonSpan:100};
 const make=key=>{const seed=[...key].reduce((s,c)=>s+c.charCodeAt(0),0);return Uint8Array.from({length:side*side*V*4},(_,i)=>(i*17+seed)%256);};
 const frame=new Function('tilePoint','tile',code+';return frame;')(tilePoint,async url=>make(url.split('/').at(-1).replace('.bin.gz','')));
 const actual=await frame({region,G,V,level:0,res,run:'test'},3,{tiles:0});
 const expected=new Uint8Array(actual.length);
 for(let j=0;j<G;j++)for(let i=0;i<G;i++){
  const p=tilePoint(region.north-j/(G-1)*region.latSpan,region.west+i/(G-1)*region.lonSpan,res),a=make(p.key);
  const x=Math.min(side-2,Math.floor(p.x)),y=Math.min(side-2,Math.floor(p.y)),u=p.x-x,v=p.y-y;
  for(let z=0;z<V;z++)for(let c=0;c<4;c++){
   const at=(x,y)=>a[((y*V+z)*side+x)*4+c];
   expected[(i+G*(z+V*j))*4+c]=Math.round((at(x,y)*(1-u)+at(x+1,y)*u)*(1-v)+(at(x,y+1)*(1-u)+at(x+1,y+1)*u)*v);
  }
 }
 assert.deepEqual(actual,expected);
});
