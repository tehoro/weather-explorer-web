import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {landPaths} from './basemap-texture.mjs';
const paths=landPaths(JSON.parse(readFileSync(new URL('../site/basemap.json',import.meta.url))),360,180);
function land(lon,lat){const x=lon+180,y=90-lat;return paths.some(p=>{let inside=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const a=p[i],b=p[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;});}
for(const [name,lon,lat]of [['India',78,23],['China',105,35],['Africa',20,0],['Europe',10,50],['Australia',135,-25],['North America',-100,40],['South America',-60,-10],['Russia east',179,66],['Russia west',-179,68]])assert.ok(land(lon,lat),name+' must be land');
for(const [lon,lat]of [[75,-20],[-140,0],[-30,0],[0,-50]])assert.ok(!land(lon,lat),'Ocean must stay ocean');
console.log('Actual basemap: all continents, both sides of the date line and ocean samples passed.');
