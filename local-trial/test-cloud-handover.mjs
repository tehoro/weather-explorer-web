import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// Run the actual controller with delayed worker replies, without WebGL or networking.
let source=readFileSync(new URL('./cloud-volumes.mjs',import.meta.url),'utf8');
source=source.replace(/^import .*;\n/gm,'').replace('export class','class').replace('import.meta.url',"'https://example.test/cloud-volumes.mjs'");
class Vector{set(){return this;}}
class Texture{constructor(raw){this.raw=raw;}dispose(){this.disposed=true;}}
class Worker{postMessage(job){this.job=job;}}
const THREE={Data3DTexture:Texture,WebGLRenderTarget:class{constructor(){this.depthTexture=null;}},DepthTexture:Texture,Vector2:Vector,Vector3:Vector,Vector4:Vector,Matrix4:Vector,ShaderMaterial:class{constructor(){this.userData={};}},BoxGeometry:class{},Mesh:class{constructor(){this.scale=new Vector();this.position=new Vector();}}};
const controls={cloudOpacity:{value:55,after(){}},cloudLow:{checked:true},cloudMiddle:{checked:true},cloudHigh:{checked:true}};
const document={getElementById:id=>controls[id],createElement:()=>({})};
const CloudVolumes=new Function('THREE','Worker','document','chooseLod','detailNoise','vertex','fragment',source+'\nreturn CloudVolumes;')(THREE,Worker,document,()=>0,()=>new Uint8Array(1),'','');
const weather={group:{add(){}},current:{},context:()=>({cloudScale:1,distance:100}),data:{meta:{run:'run1',steps:[3,6,9,12,15,18]}},displayFrame:.9,blend:.9};
const clouds=new CloudVolumes(weather);clouds.region={west:160};clouds.updateGround=()=>{};clouds.manifest=async run=>({run,steps:weather.data.meta.steps,levels:[.5]});
const tick=async f=>{weather.displayFrame=f;clouds.tick();await Promise.resolve();};
const reply=()=>{const {id}=clouds.worker.job;clouds.worker.onmessage({data:{id,a:new Uint8Array([1]).buffer,b:new Uint8Array([2]).buffer}});};
await tick(.9);reply();await tick(.99);
assert.equal(clouds.u.volumeReady.value,1);
assert.deepEqual(clouds.worker.job.steps,[6,9],'next interval prefetched');
const endpoint=clouds.u.texB.value;
await tick(1.001);assert.equal(clouds.u.volumeReady.value,1,'delayed reply must not flash standard clouds');
assert.equal(clouds.u.texB.value,endpoint);assert.equal(clouds.u.mixTime.value,1,'hold shared endpoint, not reset blend');
reply();await tick(1.01);assert.equal(clouds.u.volumeReady.value,1);assert.ok(Math.abs(clouds.u.mixTime.value-.01)<1e-8);
// Failed speculative work must leave the currently displayed interval intact.
clouds.worker.onmessage({data:{id:clouds.worker.job.id,error:'network'}});
await tick(1.5);assert.equal(clouds.u.volumeReady.value,1);
await tick(2.01);assert.equal(clouds.u.volumeReady.value,0,'actual missing interval retains standard fallback');
clouds.retry=0;await tick(2.1);reply();await tick(2.2);reply();await tick(2.9);
const next=clouds.pairs.get(clouds.requestKey);
await tick(3);assert.equal(clouds.u.volumeReady.value,1,'prefetched boundary is immediately available');assert.equal(clouds.u.mixTime.value,0);
assert.equal(clouds.u.texA.value,next.a);assert.ok(clouds.pairs.size<=3);
await tick(2.99);assert.equal(clouds.u.volumeReady.value,1,'backwards crossing reuses preceding pair');
// A different run or area must never reuse old clouds.
weather.data.meta.run='run2';await tick(2.99);assert.equal(clouds.u.volumeReady.value,0);
clearTimeout(clouds.deadline);
console.log('Cloud handover: prefetch, delayed reply, shared endpoint, backwards crossing, bounded cache, failure and run isolation passed.');
