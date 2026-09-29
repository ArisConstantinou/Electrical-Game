import assert from 'node:assert/strict';
import * as THREE from 'three';
import {HiddenRenderTransforms} from '../src/world/HiddenRenderTransforms.ts';
import {TransformControls} from 'three/addons/controls/TransformControls.js';
const scene=new THREE.Group(),hidden=new THREE.Group(),anchor=new THREE.Object3D(),policy=new HiddenRenderTransforms();
scene.add(hidden);hidden.add(anchor);anchor.position.set(1,2,3);scene.updateMatrixWorld(true);
scene.traverse(o=>policy.prepare(o));hidden.visible=false;hidden.position.x=5;
let updates=0;const matrixUpdate=anchor.updateMatrix.bind(anchor);anchor.updateMatrix=()=>{updates++;matrixUpdate();};
for(let i=0;i<120;i++)scene.updateMatrixWorld(true);
assert.equal(updates,0,'Hidden descendants must skip frame transforms');
assert.deepEqual(anchor.getWorldPosition(new THREE.Vector3()).toArray(),[6,2,3],'Explicit hidden-anchor query stays correct');
hidden.visible=true;hidden.position.x=8;scene.updateMatrixWorld(true);
assert.deepEqual(anchor.getWorldPosition(new THREE.Vector3()).toArray(),[9,2,3],'First visible frame restores current transforms');
const camera=new THREE.PerspectiveCamera();camera.visible=false;camera.position.x=2;policy.prepare(camera);camera.updateMatrixWorld(true);assert.equal(camera.matrixWorld.elements[12],2,'Hidden logical cameras continue to update');
const target=new THREE.Object3D(),controls=new TransformControls(camera);
scene.add(target,controls.getHelper());controls.attach(target);
target.position.set(9,3.3,16);camera.position.set(3.8,8.5,28);camera.lookAt(target.position);
scene.traverse(o=>policy.prepare(o));
for(const mode of ['translate','rotate','scale']){
  controls.setMode(mode);scene.updateMatrixWorld(true);
  const picker=controls._gizmo.picker[mode];
  assert.equal(picker.visible,false,'Picking volumes stay invisible');
  for(const handle of picker.children.filter(h=>h.visible))
    assert.deepEqual(new THREE.Vector3().setFromMatrixPosition(handle.matrixWorld).toArray(),target.position.toArray(),
      `${mode}: invisible picking volumes must follow the visible gizmo`);
}
controls.getHelper().dispose();
console.log('Hidden render transforms: skipped frame work, anchor queries, visibility, cameras and transform pickers PASS');
