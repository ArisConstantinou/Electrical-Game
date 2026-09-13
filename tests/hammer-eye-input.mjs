import assert from 'node:assert/strict';
import {build} from 'esbuild';
import * as THREE from 'three';
await build({entryPoints:['src/player/PlayerController.ts'],outfile:'output/eye-controller.mjs',bundle:true,platform:'node',format:'esm',external:['three']});
const {PlayerController}=await import('../output/eye-controller.mjs?'+Date.now());
const input={pressed:()=>false,mobileMove:new THREE.Vector2(),mobileLook:new THREE.Vector2()};
const camera=new THREE.PerspectiveCamera(72,1,.025,60);camera.rotation.order='YXZ';
const player=new PlayerController(camera,input);
const near=(a,b)=>assert(Math.abs(a-b)<1e-10,`${a} != ${b}`);
player.setEyeLookEnabled(true);
const initial={yaw:player.yaw,pitch:player.pitch,position:camera.position.toArray(),rotation:camera.quaternion.toArray()};
player.look(20,-15);
near(player.yaw,initial.yaw);near(player.pitch,initial.pitch);
assert.deepEqual(camera.position.toArray(),initial.position);
assert.deepEqual(camera.quaternion.toArray(),initial.rotation);
player.look(-20,15);near(player.gaze.yaw,0);near(player.gaze.pitch,0);
// Input is conserved across the eye boundary in either direction, with no jump.
player.look(100,90,.01);
near(player.gaze.yaw,-player.gaze.maxYaw);near(player.gaze.pitch,-player.gaze.maxPitch);
near(player.yaw+player.gaze.yaw,initial.yaw-1);
// Repeat at a neutral base pitch so the normal vertical safety clamp is not hit.
player.pitch=0;player.gaze.pitch=0;player.look(0,-50,.01);
near(player.pitch+player.gaze.pitch,.5);
player.look(-200,0,.01);
near(player.gaze.yaw,player.gaze.maxYaw);near(player.yaw+player.gaze.yaw,initial.yaw+1);
const expected=new THREE.Quaternion().setFromEuler(new THREE.Euler(player.pitch,player.yaw,0,'YXZ'));
expected.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(player.gaze.pitch,player.gaze.yaw,0,'YXZ')));
player.setEyeLookEnabled(false);
assert.equal(player.gaze.enabled,false);near(player.gaze.yaw,0);near(player.gaze.pitch,0);
// Normal aiming has no camera roll, but retains the direction being viewed.
assert(new THREE.Vector3(0,0,-1).applyQuaternion(expected).distanceTo(camera.getWorldDirection(new THREE.Vector3()))<1e-10);
const disabledYaw=player.yaw;player.look(10,0);near(player.yaw,disabledYaw-.023);
player.setEyeLookEnabled(true);const mobileYaw=player.yaw;player.lookMobileDrag(4,0);near(player.yaw,mobileYaw);assert(player.gaze.yaw<0);
console.log(JSON.stringify({pass:true,checks:['stationary head and work direction','reversible small gaze','continuous positive and negative overflow','gaze carried into normal look','mobile drag shares eye control']}));
