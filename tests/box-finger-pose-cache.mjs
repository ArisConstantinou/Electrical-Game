import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as THREE from 'three';

execFileSync(process.execPath, [
  'node_modules/esbuild/bin/esbuild', 'src/player/WorkerBody.ts',
  '--bundle', '--platform=node', '--format=esm', '--external:three',
  '--outfile=output/box-finger-pose-cache/WorkerBody.js', '--log-level=error',
]);
const { WorkerBody } = await import('../output/box-finger-pose-cache/WorkerBody.js');
const worker = Object.create(WorkerBody.prototype);
worker.bones = new Map(); worker.rest = new Map(); worker.lengths = new Map();
worker.fingerAdduction = new Map([['indexR', 0]]);
worker.fingerSplay = new Map([['indexR', new THREE.Vector3(0, 0, 1)]]);
worker.fingerAxes = new Map(); worker.boxFingerAxes = new Map();
worker.boxFingerPoseCache = new Map(); worker.fingerFit = {};
const hand = new THREE.Bone(); hand.name = 'hand.R'; worker.bones.set(hand.name, hand);
let parent = hand;
for (let joint = 1; joint <= 3; joint++) {
  const bone = new THREE.Bone(); bone.name = `index.0${joint}.R`;
  bone.position.set(joint === 1 ? .02 : 0, joint === 1 ? .01 : .025, 0);
  parent.add(bone); parent = bone;
  worker.bones.set(bone.name, bone);
  worker.rest.set(bone, { q: bone.quaternion.clone(), p: bone.position.clone() });
  worker.lengths.set(bone.name, .025);
  worker.fingerAxes.set(bone.name, new THREE.Vector3(1, 0, 0));
  worker.boxFingerAxes.set(bone.name, new THREE.Vector3(1, 0, 0));
}
hand.updateWorldMatrix(true, true);
const target = new THREE.Vector3(.018, .085, .012);
const fit = () => worker.fitFinger('index', 'R', target, false, worker.boxFingerAxes);
fit();
const first = worker.fingerFit.indexR;
const firstPose = [1, 2, 3].map(j => worker.bones.get(`index.0${j}.R`).quaternion.toArray());
hand.position.set(.13, .2, -.5); hand.rotation.y = .4; hand.updateWorldMatrix(true, true);
target.copy(hand.localToWorld(new THREE.Vector3(.018, .085, .012)));
fit();
const second = worker.fingerFit.indexR;
const secondPose = [1, 2, 3].map(j => worker.bones.get(`index.0${j}.R`).quaternion.toArray());
assert(Math.max(...secondPose.flatMap((q, j) => q.map((v, i) => Math.abs(v - firstPose[j][i])))) < 1e-10, 'Rigid hand movement must keep identical local finger pose');
assert(Math.abs(second.error - first.error) < 1e-8, 'Cached contact must preserve fingertip error');
assert.equal(second.solver, 'cached-box-contact', 'Unchanged local target should reuse its exact solved angles');
for(let i=0;i<60;i++){
  hand.position.set(.13+Math.sin(i*.1)*.03,.2+Math.cos(i*.08)*.02,-.5+i*.001);
  hand.rotation.set(Math.sin(i*.06)*.2,.4+Math.sin(i*.05)*.3,0);
  hand.updateWorldMatrix(true,true);
  target.copy(hand.localToWorld(new THREE.Vector3(.018,.085,.012)));
  fit();
  assert.equal(worker.fingerFit.indexR.solver,'cached-box-contact',`frame ${i}: rigid contact must reuse pose`);
  assert(Math.abs(worker.fingerFit.indexR.error-first.error)<1e-8,`frame ${i}: fingertip contact drift`);
}

target.add(new THREE.Vector3(.004, 0, 0));
fit();
assert.notEqual(worker.fingerFit.indexR.solver, 'cached-box-contact', 'Changed contact target must solve again');
worker.fitFinger('index','R',target,false,worker.fingerAxes);
assert.notEqual(worker.fingerFit.indexR.solver,'cached-box-contact','Non-box grip must keep its live solver');
console.log('Box finger pose cache: exact rigid reuse and changed-target invalidation pass.');
