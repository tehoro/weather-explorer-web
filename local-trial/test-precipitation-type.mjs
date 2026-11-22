import assert from 'node:assert/strict';
import {precipitationType,typeName} from './precipitation-type.mjs';
import {WeatherData} from './weather-engine.mjs';
assert.equal(precipitationType(3,1,0),3);
assert.equal(precipitationType(5,.001,.001),0);
assert.equal(precipitationType(-1,2,.01),1);
assert.equal(precipitationType(-1,2,1),7);
assert.equal(typeName(8,1,0),'Ice pellets');
const data=new WeatherData();data.meta={times:['x'],global_preview:{}};
const source=Object.fromEntries(['u','v','temperature','pressure','rain','snow','low','middle','high'].map(k=>[k,new Float32Array(361*181)]));
source.ptype=new Float32Array(361*181).fill(1);source.ptype[1]=5;
data.globalFrame=async()=>source;
const grid=await data.coarseGrid(0,{west:.4,north:90,lonSpan:.2,latSpan:0},3);
assert.equal(grid.fields.ptype[0],1);assert.equal(grid.fields.ptype[2],5);
assert(!grid.fields.ptype.includes(3),'interpolation must never invent freezing rain');
console.log('Actual categorical types, dry threshold, mixture fallback and nearest-neighbour sampling passed.');

const {TYPES,typeColour,typeLegend,typeShader}=await import('./precipitation-type.mjs');
assert.equal(typeColour(1,1,0),'#3264ff');
assert.equal(typeColour(5,1,1),'#cfb9f4');
for(const [id,[name,hex]]of Object.entries(TYPES)){if(+id)assert.ok(typeLegend().includes(hex));const rgb=[1,3,5].map(i=>(parseInt(hex.slice(i,i+2),16)/255).toFixed(6)).join(',');assert.ok(typeShader.includes('vec3('+rgb+')'));}
