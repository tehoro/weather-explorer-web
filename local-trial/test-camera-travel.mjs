import assert from 'node:assert/strict';
import {ARRIVAL,ease,bezier,distanceKm,globeTravel,globeJourney} from './camera-travel.mjs';
assert(distanceKm({lat:0,lon:179.9},{lat:0,lon:-179.9})<23,'Dateline uses the short distance');
assert(!globeTravel({lat:-41,lon:175},{lat:-40,lon:175}));
assert(globeTravel({lat:-41,lon:175},{lat:46,lon:6}));
assert(globeTravel({lat:80,lon:0},{lat:80,lon:1}),'Use a spherical route at high latitudes');
const a={x:20,y:10,z:-5},b={x:30,y:25,z:5},d={x:100,y:ARRIVAL.height,z:100+ARRIVAL.south},c={...d,z:d.z+50};
assert.deepEqual(bezier(a,b,c,d,0),a);assert.deepEqual(bezier(a,b,c,d,1),d);
const near=bezier(a,b,c,d,.999);assert(near.z>d.z,'Final approach comes from the south');
assert(Math.abs(near.x-d.x)<.001);
assert.equal(ease(0),0);assert.equal(ease(1),1);
assert.equal(globeJourney(0).radius,1.2);assert(Math.abs(globeJourney(1).radius-1.2)<1e-9);
for(let i=0;i<=100;i++){const p=globeJourney(i/100);assert(p.radius>=1.2-1e-9&&p.radius<=3.5);assert(p.turn>=0&&p.turn<=1);}
assert.equal(globeJourney(.2).turn,0);assert.equal(globeJourney(.8).turn,1);
console.log('Search travel: bounded globe route, dateline, polar routing and north-facing arrival.');

const {localPreviewReady}=await import('./preview-readiness.mjs');
assert(localPreviewReady(true,true,100),'Coarse weather and relief allow immediate handoff without detail tiles');
assert(localPreviewReady(true,false,5000),'Slow weather does not indefinitely hide usable relief');
assert(!localPreviewReady(false,true,30000),'Wait for an actual relief surface, not a blank canvas');
