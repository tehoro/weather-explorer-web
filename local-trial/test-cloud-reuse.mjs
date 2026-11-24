import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// Exercise actual forecast rebuilds: texture changes must not recompile clouds.
const source=readFileSync(new URL('./weather-view.mjs',import.meta.url),'utf8');
const method=source.slice(source.indexOf(' build(moved){'),source.indexOf(' attachSurfaces(){'));
let geometries=0,materials=0,disposed=0;
class Geometry{
 constructor(){geometries++;this.userData={};this.attributes={position:{count:0},uv:{}};}
 rotateX(){}computeBoundingSphere(){}dispose(){disposed++;}
}
class Material{constructor(options){materials++;Object.assign(this,options);}}
class Mesh{constructor(geometry,material){Object.assign(this,{geometry,material,userData:{}});}}
class Vector{set(){}}
const THREE={PlaneGeometry:Geometry,ShaderMaterial:Material,Mesh,Vector2:Vector,Vector4:Vector,DoubleSide:2};
const element={value:'1',after(){},remove(){}};
const document={createElement:()=>({})},$=()=>element;
let bounds={west:0,east:10,north:0,south:10};
const context={bounds:()=>({...bounds}),ground:()=>0,terrainRevision:1,cloudScale:1};
const owner={context:()=>context,current:{region:{},n:3},previous:{},meshes:[],group:{add(){}},texture:()=>({dispose(){}}),attachSurfaces(){},spawn:()=>({}),spawnRain:()=>({}),wind:{},drops:{},particles:[{}],data:{meta:{}},options(){}};
let volumes=0,bindings=0;
class CloudVolumes{constructor(){volumes++;}bind(){bindings++;}}
const build=new Function('THREE','$','document','typeLegend','IsobarLines','N','CloudVolumes','return ({'+method+'}).build;')(THREE,$,document,()=>'',class{},1,CloudVolumes);
build.call(owner);const cloud=owner.volumeClouds,texture=owner.textures[0];
build.call(owner);assert.equal(owner.volumeClouds,cloud);assert.equal(volumes,1);assert.equal(bindings,2);assert.notEqual(owner.textures[0],texture);
bounds={west:0,east:20,north:0,south:20};build.call(owner);
assert.equal(owner.volumeClouds,cloud);assert.equal(volumes,1);assert.equal(bindings,3);
console.log('Forecast and region changes reuse the volume renderer and rebind weather textures.');
