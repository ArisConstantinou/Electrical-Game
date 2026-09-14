import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import * as THREE from 'three';
await mkdir('output',{recursive:true});
globalThis.window={matchMedia:()=>({matches:true})};globalThis.innerWidth=390;globalThis.innerHeight=844;
await build({entryPoints:['src/player/FPSRig.ts','src/player/TrowelMotion.ts'],outdir:'output/held-clearance',bundle:true,platform:'node',format:'esm',outExtension:{'.js':'.mjs'},external:['three']});
const {FPSRig}=await import('../output/held-clearance/FPSRig.mjs?'+Date.now());
const {sampleTrowelMotion}=await import('../output/held-clearance/TrowelMotion.mjs');
const report={baselinePenetrationMm:{},cases:[],maxSteadyShiftM:0,maxArmErrorM:0};
const front=-2.39;
function frame(rig,camera,tool,t=0){
 rig.show(tool);rig.position.z=tool==='fitting'?-.32:-.42;rig.update(1/60,false);
 if(tool==='trowel')rig.poseTrowel(camera,sampleTrowelMotion({holding:false,charge:.8,castElapsed:t}),1/60,-2.41);
 else rig.poseArms(camera);
}
// Reproduce the photographed hand-work stance without the new surface solver.
{
 const camera=new THREE.PerspectiveCamera(72,390/844,.025,60);camera.position.set(0,1.35,-1.95);const rig=new FPSRig();camera.add(rig);
 for(const tool of ['level','spring','cutter','spray']){
  frame(rig,camera,tool);const box=new THREE.Box3().setFromObject(rig.tools.get(tool));
  report.baselinePenetrationMm[tool]=(front-box.min.z)*1000;
  assert(report.baselinePenetrationMm[tool]>30,`${tool}: original near-wall pose must reproduce penetration`);
 }
}
for(const viewport of [[1366,768],[390,844],[844,390]])for(const pitch of [-.45,0,.3])for(const yaw of [-.4,0,.4]){
 [globalThis.innerWidth,globalThis.innerHeight]=viewport;
 const camera=new THREE.PerspectiveCamera(72,viewport[0]/viewport[1],.025,60);camera.position.set(0,1.35,-1.95);camera.rotation.order='YXZ';camera.rotation.set(pitch,yaw,0);
 const rig=new FPSRig();camera.add(rig);const eye=camera.position.clone(),rotation=camera.quaternion.clone();
 for(const tool of ['level','fitting','spring','cutter','spray','trowel']){
  let maxRetraction=0,prev=null;
  for(let i=0;i<8;i++){
   frame(rig,camera,tool,tool==='trowel'?i*.04:0);
   const retraction=rig.constrainWorkSurfaces(camera,()=>front);maxRetraction=Math.max(maxRetraction,retraction);
   const bounds=rig.heldToolBoundsWorld();
   assert(bounds.min.z>=front+.002-1e-6,`${tool}: held geometry must remain in front of the local mortar/box surface`);
   const actualGeometryBounds=new THREE.Box3();rig.tools.get(tool).updateWorldMatrix(true,true);
   rig.tools.get(tool).traverseVisible(object=>{
    if(object instanceof THREE.Mesh){object.geometry.computeBoundingBox();actualGeometryBounds.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));}
   });
   assert(actualGeometryBounds.min.z>=front+.002-1e-6,`${tool}: actual tool and gripping-hand mesh bounds must clear the surface`);
   const world=rig.tools.get(tool).getWorldPosition(new THREE.Vector3());
   if(prev&&tool!=='trowel')report.maxSteadyShiftM=Math.max(report.maxSteadyShiftM,prev.distanceTo(world));prev=world;
   assert(camera.position.distanceTo(eye)<1e-12&&camera.quaternion.angleTo(rotation)<1e-7,'Retraction must not move the camera');
   const arms=rig.debugPose().arms;
   if(tool==='trowel'){
    const primary=arms.find(arm=>arm.side===1),hand=rig.armSets.get(tool).find(arm=>arm.side===1).hand;
    const axis=new THREE.Vector3(0,1,0).applyQuaternion(hand.getWorldQuaternion(new THREE.Quaternion()));
    const forearm=new THREE.Vector3().fromArray(primary.wrist).sub(new THREE.Vector3().fromArray(primary.elbow));
    assert(axis.angleTo(forearm)<.001,'Surface retraction must keep the trowel wrist straight through its flip');
   }
   for(const arm of arms){
    const distance=(a,b)=>Math.hypot(...a.map((v,j)=>v-b[j]));
    const error=Math.max(Math.abs(distance(arm.shoulder,arm.elbow)-.31),Math.abs(distance(arm.elbow,arm.wrist)-.27));
    report.maxArmErrorM=Math.max(report.maxArmErrorM,error);
    assert(error<1e-6,`${tool}: surface clearance must preserve both arm segment lengths (${error})`);
   }
  }
  report.cases.push({viewport,pitch,yaw,tool,maxRetraction});
 }
 // No local surface means no correction. A patch elsewhere on the wall must
 // not move the held tool; the caller filters actual XY surface overlap.
 frame(rig,camera,'level');const before=rig.tools.get('level').position.clone();
 assert.equal(rig.constrainWorkSurfaces(camera,()=>null),0);assert(rig.tools.get('level').position.equals(before));
 rig.show('hammer');assert.equal(rig.constrainWorkSurfaces(camera,()=>front),0,'Physical chisel contact remains owned by the hammer solver');
}
assert(report.maxSteadyShiftM<1e-7,'A stationary tool must not oscillate at a wall');
report.passed=true;await writeFile('output/held-tool-surface-clearance.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,cases:report.cases.length},null,2));
