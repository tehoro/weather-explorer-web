import assert from 'node:assert/strict';
import {terrainReadiness} from './terrain-readiness.mjs';
const needed=new Map([['a',{}],['b',{}]]),tiles=new Map([['a',{mesh:{userData:{ocean:true}}}],['b',{mesh:{userData:{}}}]]),failures=new Map([['old','failed']]),missing=new Set(['b','old']);
let s=terrainReadiness(needed,tiles,failures,missing);
assert.equal(s.elevation,2);assert.equal(s.ready,1);assert.equal(s.coverFailed,1);assert.equal(s.terrainFailed,0);
tiles.get('b').mesh.userData.water=new Uint8Array(4);s=terrainReadiness(needed,tiles,failures,missing);
assert.equal(s.ready,2);assert.equal(s.failed,0);
console.log('Separate elevation/cover counts, stale failure exclusion and recovery passed');
