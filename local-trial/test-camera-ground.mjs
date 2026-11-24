import assert from 'node:assert/strict';
import {meshHeight,triangleHeight,nearGroundPlane,CAMERA_CLEARANCE_KM,skylineClearance} from './camera-ground.mjs';
assert.equal(CAMERA_CLEARANCE_KM,.01);
const heights=[0,8,5,1],mesh={geometry:{attributes:{position:{getY:i=>heights[i]}}},scale:{y:2},position:{y:0}};
for(const [u,v] of [[0,0],[1,0],[0,1],[1,1],[.25,.25],[.75,.75],[.2,.8]])assert.equal(meshHeight(mesh,1,u,v),2*triangleHeight(...heights,u,v));
assert.equal(meshHeight(mesh,1,.5,.5),13); // bilinear would be 7: collision must follow the ridge.
for(const scale of [1,1.5,2]){const floor=meshHeight(mesh,1,.5,.5)+.01*scale;assert.ok(floor>13);assert.ok(nearGroundPlane(50,.01*scale)<=.0021);}
assert.equal(nearGroundPlane(50,18),.25);
console.log('Camera clearance: triangle ridge, edges, exaggeration and near clipping passed.');

assert.equal(skylineClearance(0,0,50,0,1,(x,z)=>x>=2&&x<=3?1:0),1.01);
assert.equal(skylineClearance(0,0,50,0,1,(x,z)=>x>6?9:0),.01);

// Verify the sampler against the renderer's actual triangle topology.
import * as THREE from './assets/three.module.js';
const geometry=new THREE.PlaneGeometry(1,1,1,1);geometry.rotateX(-Math.PI/2);
for(let i=0;i<4;i++)geometry.attributes.position.setY(i,heights[i]);
const actual=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));actual.scale.y=1.5;actual.updateMatrixWorld();
for(const [u,v] of [[.1,.2],[.6,.3],[.4,.9],[.99,.99]]){const hit=new THREE.Raycaster(new THREE.Vector3(u-.5,30,v-.5),new THREE.Vector3(0,-1,0)).intersectObject(actual)[0];assert.ok(Math.abs(hit.point.y-meshHeight(actual,1,u,v))<1e-6);}
