import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import * as THREE from 'three';

await mkdir('output',{recursive:true});
globalThis.window={matchMedia:()=>({matches:false})};globalThis.innerWidth=1366;globalThis.innerHeight=768;
await build({stdin:{contents:"export {FPSRig} from './src/player/FPSRig.ts';export {PlayerController} from './src/player/PlayerController.ts';export {sampleTrowelMotion} from './src/player/TrowelMotion.ts';",resolveDir:process.cwd()},outfile:'output/trowel-pose-stability.mjs',bundle:true,platform:'node',format:'esm',external:['three']});
const {FPSRig,PlayerController,sampleTrowelMotion}=await import('../output/trowel-pose-stability.mjs?'+Date.now());
const report={cases:[],cameraCorrections:0};
function fixture(Rig=FPSRig){
 const camera=new THREE.PerspectiveCamera(72,1,.025,60);camera.rotation.order='YXZ';
 const input={pressed:()=>false,mobileMove:{x:0,y:0},mobileLook:{x:0,y:0}},player=new PlayerController(camera,input);
 camera.position.set(0,1.65,-1.79);player.pitch=-.3;player.yaw=.2;camera.rotation.set(player.pitch,player.yaw,0);
 const rig=new Rig();camera.add(rig);rig.show('trowel');rig.position.z=-.42;
 const tool=rig.tools.get('trowel'),load=tool.getObjectByName('trowel-load');let normals=0;
 const compute=load.geometry.computeVertexNormals.bind(load.geometry);load.geometry.computeVertexNormals=()=>{normals++;return compute();};
 const pose=(motion,dt)=>{rig.update(dt,false);return rig.poseTrowel(camera,motion,dt,-2.41);};
 return{camera,input,player,rig,tool,load,pose,normals:()=>normals};
}
const held=sampleTrowelMotion({holding:true,charge:1,castElapsed:null});
function settledBenchmark(Rig){const f=fixture(Rig);for(let i=0;i<240;i++)f.pose(held,1/60);const count=f.normals(),start=performance.now();for(let i=0;i<360;i++)f.pose(held,1/60);return{averageMs:(performance.now()-start)/360,normalRebuilds:f.normals()-count};}
if(process.env.QA_COMPARE_HEAD==='1'){
 const source=execFileSync('git',['show','HEAD:src/player/FPSRig.ts'],{encoding:'utf8'});
 await build({stdin:{contents:source,resolveDir:process.cwd()+'/src/player',loader:'ts'},outfile:'output/trowel-pose-baseline.mjs',bundle:true,platform:'node',format:'esm',external:['three']});
 const {FPSRig:OldRig}=await import('../output/trowel-pose-baseline.mjs?'+Date.now());report.before=settledBenchmark(OldRig);
}
report.after=settledBenchmark(FPSRig);assert.equal(report.after.normalRebuilds,0,'A stationary full-load hold must not rewrite the same normals every frame');
for(const viewport of [[1366,768],[390,844],[844,390]]){
 [globalThis.innerWidth,globalThis.innerHeight]=viewport;window.matchMedia=()=>({matches:viewport[0]!==1366});
 const f=fixture(),rotation=f.camera.quaternion.clone(),position=f.camera.position.clone();
 const poses=[];
 for(const step of [1/120,1/60,1/30]){
  for(let i=0;i<120;i++)f.pose(held,step);
  const heldPosition=f.tool.position.clone(),heldRotation=f.tool.quaternion.clone();
  for(let i=0;i<3;i++){const count=f.normals();f.pose(held,0);assert.equal(f.normals(),count,'Duplicate release-origin pose must not recalculate unchanged geometry');}
  // Full-charge bar expiry keeps this exact physical pose while its power
  // display resets independently in MortarSystem.
  f.pose(held,step);assert(f.tool.position.distanceTo(heldPosition)<1e-12);assert(f.tool.quaternion.angleTo(heldRotation)<1e-7);
  for(let t=0;t<.82;t+=step){
   const motion=sampleTrowelMotion({holding:false,charge:.5,castElapsed:t}),count=f.normals();f.pose(motion,step);
   assert(f.camera.position.distanceTo(position)<1e-12,'Trowel cast must never move gameplay camera');assert(f.camera.quaternion.angleTo(rotation)<1e-7,'Trowel cast must never force camera pitch/yaw');
   if(!motion.loadVisible)assert.equal(f.normals(),count,'Invisible cast load must not rebuild mesh normals');
   assert.equal(f.load.visible,motion.loadVisible);assert.equal(f.tool.userData.motionStage,motion.stage);
   const arm=f.rig.debugPose().arms.find(a=>a.side===1);const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
   assert(Math.abs(distance(arm.shoulder,arm.elbow)-.31)<1e-7);assert(Math.abs(distance(arm.elbow,arm.wrist)-.27)<1e-7);
  }
  f.pose(sampleTrowelMotion({holding:false,charge:0,castElapsed:null}),step);
  assert(f.load.visible,'Ready pose restores exactly one load after cast');
  poses.push({step,normalRebuilds:f.normals()});
 }
 // Touch look remains player-owned across release and recovery; neutral
 // released input must not generate downward motion on following frames.
 f.player.wallWorkEnabled=false;f.player.handWorkTargetY=null;f.input.mobileLook={x:.4,y:-.3};
 f.player.update(1/60);const expectedPitch=f.player.pitch;assert(expectedPitch>-.3);
 f.input.mobileLook={x:0,y:0};const afterLook=f.camera.quaternion.clone();
 for(let i=0;i<90;i++){f.player.update(1/60);f.pose(sampleTrowelMotion({holding:false,charge:.5,castElapsed:Math.min(.82,i/60)}),1/60);assert.equal(f.player.pitch,expectedPitch);assert(f.camera.quaternion.angleTo(afterLook)<1e-7);}
 report.cases.push({viewport,poses,castCameraStable:true,manualAimAfterReleaseStable:true});
}
report.passed=true;await writeFile('output/trowel-pose-stability.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
