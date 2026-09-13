import assert from 'node:assert/strict';
import {build} from 'esbuild';
import * as THREE from 'three';
await build({entryPoints:['src/player/PlayerController.ts'],outfile:'output/view-controller.mjs',bundle:true,platform:'node',format:'esm',external:['three']});
const {PlayerController}=await import('../output/view-controller.mjs?'+Date.now());
const input={pressed:()=>false,mobileMove:new THREE.Vector2(),mobileLook:new THREE.Vector2()};
const camera=new THREE.PerspectiveCamera(72,1,.025,60);camera.rotation.order='YXZ';
const player=new PlayerController(camera,input),initial={yaw:player.yaw,pitch:player.pitch,position:camera.position.toArray()};
const near=(a,b)=>assert(Math.abs(a-b)<1e-10,`${a} != ${b}`);
for(const dx of [1,2,18,-18,-2,-1]){const yaw=player.yaw;player.look(dx,0);near(player.yaw,yaw-dx*.0023);}
near(player.yaw,initial.yaw);
player.look(1,-1);near(player.pitch,initial.pitch+.0023);player.look(-1,1);near(player.pitch,initial.pitch);
assert.deepEqual(camera.position.toArray(),initial.position);
const yaw=player.yaw;player.lookMobileDrag(1,0);assert(player.yaw<yaw,'A one-pixel mobile drag must move aim');
player.lookMobileDrag(-1,0);near(player.yaw,yaw);
player.wallWorkEnabled=true;player.yaw=1.1;camera.position.z=-1.5;player.update(0);assert(player.workPosition.locked,'Oblique work must not unlock at 49 degrees');
console.log(JSON.stringify({pass:true,checks:['one-pixel direct aim','reversals without deadzone','vertical direct aim','stationary head during look','shared mobile input','oblique wall stance']}));
