import assert from 'node:assert/strict';
import {snowCoverShader} from './snow-cover-shader.mjs';
// Execute the shared scalar GLSL equations to check both rendering paths.
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const smoothstep=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const mix=(a,b,t)=>a+(b-a)*t;
const body=snowCoverShader.slice(snowCoverShader.indexOf('{')+1,snowCoverShader.lastIndexOf('}')).replace(/\bfloat\b/g,'let');
const snow=new Function('cover','regional','terrainKm','smoothstep','clamp','max','mix',body);
const evaluate=(height,confidence=.45,local={r:0,b:0,a:0})=>snow(local,{r:2.13*confidence,g:confidence,b:.67},height,smoothstep,clamp,Math.max,mix);
assert.ok(evaluate(2.518)>.99,'Taranaki summit should have continuous strong whitening');
assert.equal(evaluate(1.8),0,'No regional snow below the soft edge');
assert.ok(Math.abs(evaluate(2.13)-.5)<1e-8,'Estimated line is the transition midpoint');
let previous=0;
for(let h=1.7;h<=2.6;h+=.01){const value=evaluate(h);assert.ok(value>=previous-1e-12&&value<=1);previous=value;}
assert.equal(evaluate(2.518,0),0,'Missing regional evidence must not create snow');
assert.ok(evaluate(2.518,.001)<.001,'Vanishing support fades out smoothly');
assert.equal(evaluate(.8),0,'Low terrain is not whitened');
assert.equal(evaluate(2.518,.45,{r:0,b:3,a:1}),0,'Strong local snowline takes priority');
assert.equal(evaluate(1.8,.45,{r:.8,b:0,a:0}),.8,'Existing broad model snow is retained');
console.log('Shared snow shader: continuous white summit, soft monotonic edge, local priority and missing-evidence safeguards passed.');
