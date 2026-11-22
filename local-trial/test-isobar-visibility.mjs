import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('./isobar-lines.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export class IsobarLines','class IsobarLines');
const IsobarLines=runInNewContext(source+'\nIsobarLines;');
let cleared=0;
const lines=Object.create(IsobarLines.prototype);
Object.assign(lines,{canvas:{hidden:false,style:{display:'block'},width:800,height:600},object:{visible:true},ctx:{clearRect:()=>cleared++}});
lines.update(null,0,4,false);
assert.equal(lines.canvas.style.display,'none');assert.equal(lines.canvas.hidden,true);assert.equal(lines.object.visible,false);assert.equal(cleared,1);
// Re-enabling may draw again; a second disable must clear that last frame too.
Object.assign(lines,{elapsed:0,key:'0/0.000/4/0/0',drawLabels:()=>{}});
lines.update({frame:0,blend:0,bounds:{west:0,north:0}},0,4,true);
assert.equal(lines.canvas.style.display,'block');assert.equal(lines.object.visible,true);
lines.update(null,0,4,false);assert.equal(cleared,2);assert.equal(lines.canvas.style.display,'none');
const weather=readFileSync(new URL('./weather-view.mjs',import.meta.url),'utf8');
const options=weather.match(/ options\(\)\{(.*?)if\(!this.current\)return;/)[1];
const handler=new Function('$',options);handler.call({isobarLines:lines},()=>({checked:false}));assert.equal(cleared,3);
console.log('Isobar labels clear immediately when disabled, including repeated toggles without a weather tick.');
