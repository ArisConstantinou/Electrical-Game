import assert from 'node:assert/strict';
import {build} from 'esbuild';
import * as THREE from 'three';
await build({entryPoints:['src/player/PlayerController.ts'],outfile:'output/chase-controller.mjs',bundle:true,platform:'node',format:'esm',external:['three']});
const {PlayerController}=await import('../output/chase-controller.mjs?'+Date.now());
for(const yaw of [-1.13,0,1.13]){
  const keys=new Set(),input={pressed:k=>keys.has(k),mobileMove:{x:0,y:0},mobileLook:{x:0,y:0}};
  const camera=new THREE.PerspectiveCamera(72,1,.025,60);camera.rotation.order='YXZ';
  const p=new PlayerController(camera,input);p.yaw=yaw;p.pitch=0;
  camera.position.set(0,1.65,-1.75);camera.rotation.set(0,yaw,0);
  p.wallWorkEnabled=true;p.wallWorkDistance=.66;p.wallToolTravelSpeedMps=.1875;p.update(0);
  keys.add('KeyA');for(let i=0;i<60;i++)p.update(1/60);keys.clear();
  assert(Math.abs(camera.position.x+.1875)<1e-9,'Held A must follow wall tangent at the same speed from every view angle');
  assert(Math.abs(camera.position.z+1.75)<1e-9,'Cutting along wall must preserve standoff');
  assert(Math.abs(p.yaw-yaw)<1e-9,'Cutting must not turn the view');
  input.mobileMove.x=1;for(let i=0;i<60;i++)p.update(1/60);input.mobileMove.x=0;
  assert(Math.abs(camera.position.x)<1e-9,'Mobile reverse must return along the same path');
  keys.add('KeyW');for(let i=0;i<10;i++)p.update(1/60);keys.clear();
  assert(Math.abs(camera.position.x)<1e-9,'Forward bracing must not slide along wall');
  keys.add('KeyS');p.update(1/60);keys.clear();assert(!p.workPosition.locked,'Backward must release work stance');
  p.wallToolTravelSpeedMps=null;p.wallWorkEnabled=false;
  const before=camera.position.clone();keys.add('KeyA');p.update(.1);
  assert(Math.abs(camera.position.clone().sub(before).length()-.22)<1e-6,'Releasing work must preserve normal walking speed');
}
console.log(JSON.stringify({pass:true,checks:['oblique A wall tangent','steady standoff and view','mobile reversal','forward brace','backward release','free walking preserved']}));
