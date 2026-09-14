import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import * as THREE from 'three';
await mkdir('output',{recursive:true});
globalThis.window={matchMedia:()=>({matches:true})};globalThis.innerWidth=390;globalThis.innerHeight=844;
await build({entryPoints:['src/player/FPSRig.ts'],outfile:'output/hose-pose-stability-bundle.mjs',bundle:true,platform:'node',format:'esm',external:['three']});
const {FPSRig}=await import('../output/hose-pose-stability-bundle.mjs?'+Date.now());
function fixture(Rig,viewport,pitch=0,yaw=0){
 [globalThis.innerWidth,globalThis.innerHeight]=viewport;window.matchMedia=()=>({matches:viewport[0]!==1366});
 const camera=new THREE.PerspectiveCamera(72,viewport[0]/viewport[1],.025,60);camera.rotation.order='YXZ';camera.position.set(0,1.65,-1.79);camera.rotation.set(pitch,yaw,0);
 const rig=new Rig();camera.add(rig);rig.show('hose');rig.position.z=-.42;
 const tool=rig.tools.get('hose'),rotation=camera.quaternion.clone(),eye=camera.position.clone();
 function frame(distance,dt=1/60){
  const target=camera.getWorldPosition(new THREE.Vector3()).addScaledVector(camera.getWorldDirection(new THREE.Vector3()),distance);
  rig.update(dt,false);rig.aimWaterGun(camera,target);rig.poseArms(camera);
  const outlet=rig.toolTipWorld(camera,'hose'),direction=rig.waterGunDirectionWorld(),delta=target.clone().sub(outlet);
  // Game queries the jet and then performs one more arm pose before render.
  rig.poseArms(camera);assert(outlet.distanceTo(rig.toolTipWorld(camera,'hose'))<1e-8,'Arm presentation must not move the sampled nozzle');
  assert(camera.position.distanceTo(eye)<1e-12&&camera.quaternion.angleTo(rotation)<1e-7,'Hose aiming must never steer the camera');
  return{quaternion:tool.quaternion.clone(),outlet,direction,miss:delta.clone().cross(direction).length(),forward:delta.dot(direction)};
 }
 return{frame,rig,camera,tool};
}
const report={cases:[],before:null,maxSteadyAngleRad:0,maxAimMissM:0,maxDepthTransitionAngleRad:0};
if(process.env.QA_COMPARE_HEAD==='1'){
 const source=execFileSync('git',['show','HEAD:src/player/FPSRig.ts'],{encoding:'utf8'});
 await build({stdin:{contents:source,resolveDir:process.cwd()+'/src/player',loader:'ts'},outfile:'output/hose-pose-baseline.mjs',bundle:true,platform:'node',format:'esm',external:['three']});
 const {FPSRig:OldRig}=await import('../output/hose-pose-baseline.mjs?'+Date.now());
 const f=fixture(OldRig,[390,844]);let prev,max=0;for(let i=0;i<120;i++){const sample=f.frame(.45);if(prev&&i>30)max=Math.max(max,prev.angleTo(sample.quaternion));prev=sample.quaternion;}
 report.before={stationaryTargetDistanceM:.45,maxSteadyAngleRad:max};assert(max>1,'Baseline must reproduce large stationary hose rotations');
}
for(const viewport of [[1366,768],[390,844],[844,390]])for(const pitch of [-.6,0,.4])for(const distance of [.25,.35,.45,.55,.65,.75,1,2,8]){
 const f=fixture(FPSRig,viewport,pitch,.25);let prev,maxAngle=0,maxMiss=0;
 for(const dt of [1/120,1/60,1/30])for(let i=0;i<12;i++){
  f.rig.hoseActive=i%2===0;const sample=f.frame(distance,dt);
  if(prev)maxAngle=Math.max(maxAngle,prev.angleTo(sample.quaternion));prev=sample.quaternion;maxMiss=Math.max(maxMiss,sample.miss);
  assert(sample.forward>.005,'Water must travel forwards from the nozzle to the aimed wall, even at close range');
  assert(sample.miss<.002,`Nozzle must aim at target within 2mm (${viewport}, pitch ${pitch}, distance ${distance}): ${sample.miss}`);
  const arms=f.rig.debugPose().arms;for(const arm of arms){const d=(a,b)=>Math.hypot(...a.map((v,j)=>v-b[j]));assert(Math.abs(d(arm.shoulder,arm.elbow)-.31)<1e-7);assert(Math.abs(d(arm.elbow,arm.wrist)-.27)<1e-7);}
 }
 assert(maxAngle<1e-7,'A stationary wall must not cause endless nozzle rotation at any frame rate');
 report.maxSteadyAngleRad=Math.max(report.maxSteadyAngleRad,maxAngle);report.maxAimMissM=Math.max(report.maxAimMissM,maxMiss);report.cases.push({viewport,pitch,distance,maxAngle,maxMiss});
}
// Crossing shell and cavity depths must not revive the old rotation feedback.
for(const viewport of [[390,844],[844,390]]){
 const f=fixture(FPSRig,viewport);let prev;
 for(let i=0;i<180;i++){
  const distance=.45+(i%60)/59*.20,sample=f.frame(distance);
  if(prev)report.maxDepthTransitionAngleRad=Math.max(report.maxDepthTransitionAngleRad,prev.angleTo(sample.quaternion));prev=sample.quaternion;
  assert(sample.forward>0&&sample.miss<.002);
 }
 const stationary=f.frame(.45),q=stationary.quaternion;
 // Tool switches and retained rotations must not affect the next pose.
 f.rig.show('trowel');f.rig.update(1/60,false);f.rig.show('hose');f.tool.quaternion.setFromEuler(new THREE.Euler(1.4,2.3,-1.2));
 assert(f.frame(.45).quaternion.angleTo(q)<1e-7,'Hose pose must be independent of old orientation');
}
assert(report.maxDepthTransitionAngleRad<.2,'Shell-to-cavity changes must remain a small aiming adjustment');
report.passed=true;await writeFile('output/hose-pose-stability.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,cases:report.cases.length},null,2));
