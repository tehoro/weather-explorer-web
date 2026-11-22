import assert from 'node:assert/strict';
import {depthShader,prepareSceneDepth} from './scene-depth.mjs';
const source='float helper(){return 1.;} void main(){gl_Position=vec4(1.);}';
const vertex=depthShader(source,'vertex');
assert.ok(vertex.includes('#include <common>'));
assert.ok(vertex.lastIndexOf('#include <logdepthbuf_vertex>')>vertex.indexOf('void main'));
assert.equal(depthShader(vertex,'vertex'),vertex);
const material={isShaderMaterial:true,userData:{},vertexShader:source,fragmentShader:'void main(){gl_FragColor=vec4(1.);}'};
prepareSceneDepth({traverse(fn){fn({material:[material]});}});
assert.ok(material.fragmentShader.includes('logdepthbuf_fragment'));
assert.ok(material.needsUpdate);
// Near-horizon cloud separation still exceeds a 24-bit depth step at 9600 km.
const depth=z=>Math.log2(1+z)/Math.log2(12001);
assert.ok(depth(9600)-depth(9599.7)>1/2**24);
console.log('Shared depth shader injection, idempotence and horizon precision passed.');
