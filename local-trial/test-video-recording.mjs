import assert from 'node:assert/strict';
import {setupRecording} from './video-recording.mjs';
const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,{value:'720',textContent:id,hidden:false,setAttribute(){},removeAttribute(){}});return elements.get(id);};
let requests=0,stops=0,begins=[],ends=0;
const context=new Proxy({}, {get:()=>()=>{}}),track={requestFrame(){requests++;},stop(){stops++;}};
globalThis.document={getElementById:element,querySelectorAll:()=>[],createElement:()=>({getContext:()=>context,captureStream:fps=>{assert.equal(fps,0);return {getVideoTracks:()=>[track],getTracks:()=>[track]};}})};
globalThis.HTMLCanvasElement=class{captureStream(){}};
globalThis.MediaRecorder=class{static isTypeSupported(){return true;} constructor(){this.state='inactive';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['video'])});this.onstop();}};
globalThis.innerWidth=1280;globalThis.innerHeight=720;globalThis.addEventListener=()=>{};
const draw=setupRecording({width:2560,height:1440},{begin:(...size)=>begins.push(size),end:()=>ends++});
element('recordVideo').onclick();
// Slightly late RAF delivery must not halve capture frequency.
for(let i=1;i<=180;i++)draw(1000+i*16.8);
assert(requests>=89&&requests<=92,`Expected about 90 captures, got ${requests}`);
assert.deepEqual(begins,[[1280,720]]);
element('recordingStop').onclick();assert.equal(stops,1);assert.equal(ends,1);assert.equal(element('videoDownload').hidden,false);
const before=requests;draw(10000);assert.equal(requests,before,'No capture work after stop');
element('videoQuality').value='1080';element('recordVideo').onclick();assert.deepEqual(begins.at(-1),[1920,1080]);element('recordingStop').onclick();assert.equal(ends,2);
console.log('Video pacing, explicit capture, resolution selection and cleanup passed.');
