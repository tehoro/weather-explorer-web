import assert from 'node:assert/strict';
import {temperatureText} from './place-temperatures.mjs';
const c={convert:x=>x},f={convert:x=>x*1.8+32};
assert.equal(temperatureText('Dublin',7,10,.5,c),'Dublin 9°');
assert.equal(temperatureText('Dublin',7,10,.5,f),'Dublin 47°');
assert.equal(temperatureText('Dublin',null,10,.5,c),'Dublin');
assert.equal(temperatureText('Dublin',7,undefined,0,c),'Dublin');
assert.equal(temperatureText('Peak',-3,-1,.5,c),'Peak -2°');
console.log('Temporal interpolation, whole-degree Celsius/Fahrenheit and missing data passed.');

const {PlaceTemperatures}=await import('./place-temperatures.mjs');
const element={hidden:false,querySelector(){return this.child;},append(child){this.child=child;}};
globalThis.document={getElementById:()=>({checked:true}),createElement:()=>({textContent:''})};
globalThis.Units=c;
let requests=0;
const weather={displayFrame:.5,data:{meta:{run:'test',steps:[0,3,6],times:['a','b','c']},async temperature(frame){requests++;return [7,10,13][frame];}}};
const controller=new PlaceTemperatures(weather,{visible:[{lat:53,lon:-6,element}]});
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
controller.tick(.25);await flush();
assert.equal(element.child.hidden,true);
for(let i=0;i<5;i++){controller.tick(.25);await flush();}
assert.equal(element.child.textContent,'9°');assert.equal(requests,3);
weather.displayFrame=2;controller.tick(.25);assert.equal(element.child.textContent,'13°');
weather.displayFrame=1.5;controller.tick(.25);assert.equal(element.child.textContent,'12°');assert.equal(requests,3);
weather.temperatureTimeAvailable=false;controller.tick(.25);assert.equal(element.child.hidden,true);
console.log('Complete timelines stay available when scrubbing, reuse samples, and hide outside forecast coverage.');
