import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {frameAtTime,timeAtFrame} from './forecast-position.mjs';
const times=['2026-11-22T00:00:00Z','2026-11-22T03:00:00Z','2026-11-22T06:00:00Z'],time=Date.parse('2026-11-22T03:45:00Z');
assert.equal(frameAtTime(times,time),1.25);assert.equal(timeAtFrame(times,1.25),time);
const source=await readFile(new URL('./weather-view.mjs',import.meta.url),'utf8');
const method=source.slice(source.indexOf(' async load(frame,'),source.indexOf('\n texture(grid,'));
const elements={},$=id=>elements[id]??={};
const load=new Function('$','return ({'+method+'}).load;')($);
const grids=[],owner={data:{meta:{times,initial_utc:times[0]},grid:async frame=>{grids.push(frame);return {frame,quality:'coarse'};}},heldFrame:1.25,region:{},regionKey:'new-place',token:0,frame:1,playing:false,build(){},group:{},readout(){},prepare(){},updateTimeDisplay(){this.displayFrame=this.timeTransition?this.fromFrame+(this.frame-this.fromFrame)*this.blend:this.frame;}};
await load.call(owner,2,true);
assert.deepEqual(grids,[2,1]);assert.equal(owner.displayFrame,1.25);assert.equal(owner.blend,.25);assert.equal(owner.playing,false);
const globeSource=(await readFile(new URL('./globe-clouds.mjs',import.meta.url),'utf8')).replace("'three'",JSON.stringify(new URL('./assets/three.module.js',import.meta.url).href)).replace("'./forecast-position.mjs'",JSON.stringify(new URL('./forecast-position.mjs',import.meta.url).href));
const {GlobeClouds}=await import('data:text/javascript;base64,'+Buffer.from(globeSource).toString('base64'));
const globe={heldTime:time,times:times.map(Date.parse),textures:[{}, {}, {}],uniforms:{A:{},B:{},mixT:{}},mesh:{},clock:{},pos:0};
GlobeClouds.prototype.tick.call(globe,10,false);
assert.equal(globe.uniforms.mixT.value,.25);assert.equal(globe.pos,0);assert.equal(globe.mesh.visible,true);
globe.heldTime=Date.parse('2026-11-25T00:00:00Z');GlobeClouds.prototype.tick.call(globe,10,false);assert.equal(globe.mesh.visible,false,'Do not show clouds from a wrong time outside coverage');
console.log('Travel preserves fractional times, pauses playback and synchronises held globe clouds.');

const pauseBody=source.slice(source.indexOf(' pauseForTravel('),source.indexOf(' playLabel(){'));
class FixedDate extends Date{static now(){return Date.parse('2026-11-22T00:45:00Z');}}
const pause=new Function('frameAtTime','timeAtFrame','Date','return ({'+pauseBody+'}).pauseForTravel;')(frameAtTime,timeAtFrame,FixedDate);
const traveller={data:{meta:{times}},displayFrame:1.25,playing:true,token:0,playLabel(){},region:{},load(frame){this.loaded=frame;}};
assert.equal(pause.call(traveller,false),new Date(time).toISOString());assert.equal(traveller.playing,false);
traveller.playing=true;assert.equal(pause.call(traveller,true),'2026-11-22T00:45:00.000Z');assert.equal(traveller.heldFrame,.25);assert.equal(traveller.playing,false);assert.equal(traveller.loaded,1);
console.log('Search resets to Now and remains paused.');

owner.heldFrame=null;owner.playing=true;owner.timeTransition=true;owner.displayFrame=1.4;owner.frame=2;owner.current={frame:2};owner.previous={frame:1};grids.length=0;
await load.call(owner,2,true);assert.equal(owner.playing,true,'Recentring does not pause playback');assert.equal(owner.displayFrame,1.4,'Recentring preserves the interpolated clock');
const cameraSource=await readFile(new URL('./global-test.js',import.meta.url),'utf8');
const centreBody=cameraSource.slice(cameraSource.indexOf('function flyToPoint('),cameraSource.indexOf('function searchFlight('));assert(!centreBody.includes('pauseForTravel'),'Only search controls playback state');
console.log('Centre here retains active playback and the interpolated forecast time.');

const entrySource=await readFile(new URL('./globe.js',import.meta.url),'utf8');
const chooseBody=entrySource.slice(entrySource.indexOf('function choose('),entrySource.indexOf("addEventListener('message'"));
assert(chooseBody.includes('const selectedTime=new Date().toISOString();'),'Globe destination starts at Now, not the decorative cloud animation time');
