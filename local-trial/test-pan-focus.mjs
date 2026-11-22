import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('./global-test.js',import.meta.url),'utf8');
const handler=source.split('\n').find(line=>line.startsWith("renderer.domElement.addEventListener('pointerdown'")&&line.includes('zoomFocus'));
assert.ok(handler);
for(const event of [{button:2},{button:0,shiftKey:true},{button:0,ctrlKey:true},{button:0,metaKey:true}]){
 const context={zoomFocus:{lat:45,lon:6},renderer:{domElement:{addEventListener:(name,callback)=>callback(event)}}};
 runInNewContext(handler,context);assert.equal(context.zoomFocus,null,'Deliberate pan must release the selected-place lock');
}
for(const event of [{button:0},{button:1}]){
 const focus={lat:45,lon:6},context={zoomFocus:focus,renderer:{domElement:{addEventListener:(name,callback)=>callback(event)}}};
 runInNewContext(handler,context);assert.equal(context.zoomFocus,focus,'Rotation and dolly retain the selected-place lock');
}
console.log('Shift/Ctrl/Meta drag and right-drag release focus; rotation and dolly preserve it.');
