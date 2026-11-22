import assert from 'node:assert/strict';
import {gridBlocksSight,meshSightGrid,terrainBlocksSight} from './place-visibility.mjs';
import {selectPlaces} from './place-selection.mjs';
const grid={left:0,right:16,top:0,bottom:2,stepX:.1,stepZ:.1};
const eye={x:0,y:1,z:1},town={x:16,y:0,z:1};
// A narrow ridge between the old 1/16 samples, very close to the town.
const ridge=x=>Math.max(0,1-Math.abs(x-15.7)/.1);
assert(gridBlocksSight(eye,town,grid,ridge));
assert(!gridBlocksSight({...eye,y:100},town,grid,ridge));
assert(gridBlocksSight({...eye,x:16}, {...town,x:0},grid,x=>ridge(16-x)));
assert(!gridBlocksSight(eye,town,grid,()=>0));
// Raised text would clear this ridge, but its town is hidden.
assert(!gridBlocksSight(eye,{...town,y:2},grid,ridge));
const v=new Float32Array([0,0,0, 1,1,0, 0,1,1, 1,0,1]);
const mesh={userData:{p:{cells:1}},geometry:{attributes:{position:{array:v}}},scale:{x:2},position:{x:3,y:0,z:4}};
const g=meshSightGrid(mesh);
assert.equal(g.height(4,4.5),1);
assert.equal(g.height(3,4),0);
assert(terrainBlocksSight({x:3,y:.8,z:4.5},{x:5,y:.8,z:4.5},[g]));
// More than three successive hidden top-ranked candidates still get replaced.
const rows=Array.from({length:10},(_,i)=>({id:i,population:1e8/2**i,x:i*80,y:20,box:{left:i*80,right:i*80+20,top:0,bottom:20}}));
const selected=selectPlaces(rows,[],new Set(),5,p=>p.id>=5);
assert.equal(selected.length,5);assert(selected.every(p=>p.id>=5));
console.log('Place visibility: narrow ridges, near-town blocking, reversed view, top-down visibility, mesh triangles and replacement selection passed.');

mesh.scale.y=4/1.5;
assert.equal(meshSightGrid(mesh).height(4,4.5),4/1.5,'Sight lines follow displayed terrain exaggeration');
