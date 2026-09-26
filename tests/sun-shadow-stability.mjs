import assert from 'node:assert/strict';
import * as THREE from 'three';
import {StableSunShadow} from '../src/world/StableSunShadow.ts';
const sun=new THREE.DirectionalLight();sun.position.set(-3.8,3.8,5.4);sun.target.position.set(0,1.1,-2.4);
const c=sun.shadow.camera;c.left=c.bottom=-8;c.right=c.top=8;c.far=28;c.updateProjectionMatrix();sun.shadow.mapSize.set(1024,1024);
const policy=new StableSunShadow(),offset=sun.position.clone().sub(sun.target.position),landmark=new THREE.Vector3(13,0,11);
const pixels=()=>{sun.shadow.updateMatrices(sun);const p=landmark.clone().project(c);return [(p.x+1)*512,(p.y+1)*512];};
let previous;
for(const position of [[0,1.65,0],[1,1.65,0],[1,5.05,0],[12,1.65,14],[12,1.65,14],[12,-5.15,8],[-5,15,6]]){
 policy.update(sun,new THREE.Vector3(...position));const current=pixels();
 if(previous)current.forEach((n,i)=>{const delta=n-previous[i];assert(Math.abs(delta-Math.round(delta))<1e-7,'A stationary receiver retains its shadow texel phase');});
 previous=current;assert(sun.position.clone().sub(sun.target.position).distanceTo(offset)<1e-10);
}
const position=new THREE.Vector3(10.75,1.65,12.25);policy.update(sun,position);
for(const x of [10.49,10.51,10.49,10.51])assert.equal(policy.update(sun,position.setX(x)),false,'Bay-boundary jitter does not relocate the map');
assert(policy.update(sun,position.setX(11.75)));
// A direction edited in Studio must take effect without requiring player movement.
sun.position.x+=2;assert(policy.update(sun,position));assert.equal(policy.update(sun,position),false);
sun.shadow.mapSize.set(2048,1024);assert(policy.update(sun,position));assert.equal(policy.update(sun,position),false);
sun.position.copy(sun.target.position).add(new THREE.Vector3(0,5,0));assert(policy.update(sun,position));assert(pixels().every(Number.isFinite));
assert.deepEqual([c.left,c.right,c.bottom,c.top,c.far],[-8,8,-8,8,28]);
console.log('Sun shadow: texel-phase stability, boundary hysteresis, floors, Studio direction/resolution and vertical sun PASS');
