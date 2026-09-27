import assert from 'node:assert/strict';
import * as THREE from 'three';
import {captureStaticInstanceBounds,restoreStaticInstanceBounds} from '../src/world/StaticInstanceBounds.ts';

const geometry=new THREE.BoxGeometry(.23,.08,.11),mesh=new THREE.InstancedMesh(geometry,new THREE.MeshBasicMaterial(),1800);
const matrix=new THREE.Matrix4(),rotation=new THREE.Quaternion(),position=new THREE.Vector3(),scale=new THREE.Vector3();
for(let i=0;i<1800;i++){
 position.set(Math.sin(i*.73)*14,(i%6)*3.3,Math.cos(i*.31)*9);
 rotation.setFromEuler(new THREE.Euler(i*.013,i*.11,i*.005));
 scale.set(i%2?-1:1,.7+(i%9)*.1,1.2);
 mesh.setMatrixAt(i,matrix.compose(position,rotation,scale));
}
const uploaded=new Float32Array(mesh.instanceMatrix.array),sources=[];
for(let start=0;start<1800;start+=100)sources.push(captureStaticInstanceBounds(geometry,uploaded,start,100));
for(const membership of [sources.map((_,i)=>i),[1,4,6,11,17],[17,3,1],[],[0],sources.map((_,i)=>i)]){
 let next=0;
 for(const id of membership){mesh.instanceMatrix.array.set(uploaded.subarray(id*1600,(id+1)*1600),next*16);next+=100;}
 mesh.count=next;mesh.computeBoundingBox();mesh.computeBoundingSphere();
 const box=mesh.boundingBox.clone(),sphere=mesh.boundingSphere.clone();
 restoreStaticInstanceBounds(mesh,membership.map(id=>sources[id]));
 assert(mesh.boundingBox.equals(box),'Compacted box must exactly match the original geometry scan');
 assert(mesh.boundingSphere.equals(sphere),'Compacted sphere must exactly match Three, including source order and empty batches');
 for(let yaw=0;yaw<Math.PI*2;yaw+=.2){
  const camera=new THREE.PerspectiveCamera(72,.57,.025,60);camera.position.set(7,8.2,10);camera.rotation.set(-.2,yaw,0);camera.updateMatrixWorld(true);
  const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
  assert.equal(frustum.intersectsSphere(mesh.boundingSphere),frustum.intersectsSphere(sphere));
 }
}
console.log('PASS: cached masonry bounds exactly preserve geometry-scan boxes, order-dependent spheres, empty/restored membership and frustum decisions.');
