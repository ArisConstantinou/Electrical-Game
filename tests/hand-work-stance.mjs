import assert from 'node:assert/strict';
import {build} from 'esbuild';
import * as THREE from 'three';
await build({entryPoints:['src/player/PlayerController.ts'],outfile:'output/hand-work-controller.mjs',bundle:true,platform:'node',format:'esm',external:['three']});
const {PlayerController}=await import('../output/hand-work-controller.mjs?'+Date.now());
const keys=new Set(),input={pressed:k=>keys.has(k),mobileMove:new THREE.Vector2(),mobileLook:new THREE.Vector2()};
const camera=new THREE.PerspectiveCamera(72,1,.025,60);camera.rotation.order='YXZ';
const player=new PlayerController(camera,input),front=-2.41;
function aim(y,z=front+.50){camera.position.set(0,1.65,z);camera.lookAt(0,y,front);player.yaw=camera.rotation.y;player.pitch=camera.rotation.x;player.workPosition.released=false;player.wallWorkEnabled=true;player.wallWorkDistance=.46;}
function target(){const d=camera.getWorldDirection(new THREE.Vector3());return camera.position.clone().addScaledVector(d,(front-camera.position.z)/d.z);}
function advance(n=120){for(let i=0;i<n;i++){player.handWorkTargetY=target().y;player.update(1/60);}}
const checks=[];
for(const y of [1.1,.3,2.7]){aim(y);advance();const t=target(),reach=Math.hypot(.2,camera.position.y-.22-t.y,camera.position.z+.03-front);assert(Math.abs(t.y-y)<1e-5);assert(Math.abs(camera.position.z-front-.46)<.002);if(y<1.5){assert(reach<.68);assert(camera.position.y<1.65);}else{assert(reach>.68);assert(camera.position.y<=1.65);}checks.push({targetY:y,eyeY:camera.position.y,reach,work:{...player.workPosition}});}
aim(1.1);advance();player.look(0,80);const aimed=target().y;advance(30);assert(Math.abs(target().y-aimed)<1e-5);
input.mobileLook.y=.5;const beforeLook=target().y;advance(10);assert(Math.abs(target().y-beforeLook)>.001);input.mobileLook.y=0;
keys.add('KeyS');advance(45);keys.clear();assert.equal(player.workPosition.locked,false);assert(camera.position.z-front>.9);advance(90);assert(Math.abs(camera.position.y-1.65)<.001);
aim(.3,front+1.5);advance();assert.equal(player.workPosition.locked,false);assert(Math.abs(camera.position.y-1.65)<.001);
console.log(JSON.stringify({suite:'hand-work-stance',checks,aimPreserved:true,mobileAimWorks:true,backwardReleases:true,farRemainsStanding:true,pass:true}));
