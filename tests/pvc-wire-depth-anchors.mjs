import assert from 'node:assert/strict';
import * as THREE from 'three';
import {buildRebarHug,setTieWireProgress} from '../src/systems/RebarTyingModels.ts';

// Native direct drilling produces two independently recessed endpoints. Check
// the actual deformed surface vertices, rather than an undeformed curve cache.
const left=new THREE.Vector3(-.08642,.206,-2.486927),right=new THREE.Vector3(.02530,.140749,-2.471542);
const group=buildRebarHug(left,right,-1.887,-.0335,-2.450),legs=group.children.filter(o=>o.isMesh);
const buffers=legs.map(o=>[o.geometry,o.geometry.attributes.position,o.geometry.attributes.normal]),samples=[];
for(let frame=0;frame<=69;frame++){
 const start=performance.now();setTieWireProgress(group,frame/69);samples.push(performance.now()-start);group.updateMatrixWorld(true);
 legs.forEach((mesh,i)=>{
  const position=mesh.geometry.attributes.position,centre=new THREE.Vector3();
  for(let j=0;j<6;j++)centre.add(new THREE.Vector3().fromBufferAttribute(position,j));centre.multiplyScalar(1/6);
  assert(mesh.localToWorld(centre).distanceTo(i===0?left:right)<1e-7,'Each anchor must retain its actual hole depth in every frame');
  for(let k=0;k<=48;k++){
   const ring=new THREE.Vector3();for(let j=0;j<6;j++)ring.add(new THREE.Vector3().fromBufferAttribute(position,k*7+j));ring.multiplyScalar(1/6);
   for(let j=0;j<6;j++)assert(Math.abs(new THREE.Vector3().fromBufferAttribute(position,k*7+j).distanceTo(ring)-.0008)<1e-7,'Tightening must retain the 1.6 mm wire diameter');
  }
  assert.equal(mesh.geometry,buffers[i][0]);assert.equal(position,buffers[i][1]);assert.equal(mesh.geometry.attributes.normal,buffers[i][2]);
  assert(Array.from(position.array).every(Number.isFinite));
 });
 assert.deepEqual(group.scale.toArray(),[1,1,1]);
}
samples.sort((a,b)=>a-b);console.log(JSON.stringify({passed:true,frames:70,separateDepthAnchors:true,constantDiameter:true,stableBuffers:true,meanMs:samples.reduce((a,b)=>a+b)/70,p95Ms:samples[66],maxMs:samples[69]}));
group.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.dispose();}});
