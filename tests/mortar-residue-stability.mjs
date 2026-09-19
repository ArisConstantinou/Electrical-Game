import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import * as THREE from 'three';
await mkdir('output',{recursive:true});
await build({stdin:{contents:"export {MortarSystem} from './src/systems/MortarSystem.ts';export {MasonryVolume} from './src/world/MasonryVolume.ts';",resolveDir:process.cwd()},outfile:'output/residue-model.mjs',bundle:true,platform:'node',format:'esm',external:['three']});
const {MortarSystem,MasonryVolume}=await import('../output/residue-model.mjs');
const volume=new MasonryVolume({seed:260913}),f=volume.frontZ;
for(let pass=0;pass<3;pass++)for(let x=-.096;x<=.09601;x+=.024)for(let y=1.304;y<=1.49601;y+=.024){const hit=volume.raycast({x,y,z:f+.05},{x:0,y:0,z:-1},.24);if(hit&&f-hit.point.z<.06)volume.impact({point:hit.point,direction:{x:0,y:0,z:-1},chisel:'flat',widthM:.025,energyJ:5});}
const m=new MortarSystem(new THREE.Scene(),{volume},[]),camera=new THREE.PerspectiveCamera();
for(let i=0;i<12;i++){
 const x=(i%3-1)*.04,y=1.35+Math.floor(i/3)*.032;
 camera.position.set(0,1.65,f+.65);camera.lookAt(x,y,f-.05);camera.updateMatrixWorld(true);
 const origin=new THREE.Vector3(.02,1.5,f+.22);m.launch(origin,m.velocity(camera,.5,origin),.35);
 for(let frame=0;frame<120;frame++)m.update(1/120);
}
const trace=[];
for(let second=0;second<20;second++){
 for(let frame=0;frame<120;frame++)m.update(1/120);
 trace.push({second,...m.telemetry,clods:m.projectiles.map(c=>({age:c.age,contacts:c.contacts,mass:c.mass,p:c.mesh.position.toArray(),q:c.mesh.quaternion.toArray(),v:c.velocity.toArray()}))});
}
await writeFile('output/mortar-residue-stability.json',JSON.stringify(trace,null,2));
assert.equal(m.projectiles.length,0,'Residue is trapped in an endless collision loop on fractured masonry');
const t=m.telemetry;assert(Math.abs(t.launchedKg-t.stuckKg-t.floorKg-t.restingKg)<1e-7);
console.log(JSON.stringify({passed:true,trace:'output/mortar-residue-stability.json',last:trace.at(-1)}));
