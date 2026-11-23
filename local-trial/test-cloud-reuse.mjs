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
const build=new Function('THREE','$','document','typeLegend','IsobarLines','N','return ({'+method+'}).build;')(THREE,$,document,()=>'',class{},1);
build.call(owner);const mesh=owner.clouds[0],uniform=mesh.material.uniforms.cloudB,texture=uniform.value;
assert.equal(geometries,9);assert.equal(materials,9);
build.call(owner);assert.equal(owner.clouds[0],mesh);assert.equal(geometries,9);assert.equal(materials,9);assert.equal(disposed,0);
assert.equal(mesh.material.uniforms.cloudB,uniform);assert.notEqual(uniform.value,texture);
bounds={west:0,east:20,north:0,south:20};build.call(owner);
assert.equal(geometries,18);assert.equal(disposed,9);assert.equal(materials,9);assert.equal(owner.clouds[0],mesh);
console.log('Forecast changes reuse cloud meshes/materials; moving changes only geometry; texture uniforms stay live.');
