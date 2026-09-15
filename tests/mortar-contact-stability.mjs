import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import * as THREE from 'three';

await mkdir('output',{recursive:true});
const report={cases:[]},Z=new THREE.Vector3(0,0,1);
for(const version of ['before','after']){
 await build({entryPoints:['src/systems/MortarSystem.ts'],outfile:`output/mortar-contact-${version}.mjs`,bundle:true,platform:'node',format:'esm',external:['three'],plugins:version==='before'?[{name:'baseline',setup(b){b.onLoad({filter:/[\\/]src[\\/]systems[\\/]MortarSystem\.ts$/},()=>({contents:execFileSync('git',['show','efda933:src/systems/MortarSystem.ts'],{encoding:'utf8'}),loader:'ts'}));}}]:[]});
 const {MortarSystem}=await import(`../output/mortar-contact-${version}.mjs`);
 for(const damp of [false,true]){
  const wall={volume:{frontZ:0,isOccupied:(x,y,z)=>z<0,raycast(origin,direction,max){const t=-origin.z/direction.z;return direction.z<0&&t>=0&&t<=max?{point:new THREE.Vector3().copy(origin).addScaledVector(direction,t),normal:Z.clone()}:null;}}};
  const m=new MortarSystem(new THREE.Scene(),wall,[]);
  if(damp)m.applyWater(new THREE.Vector3(0,1.48,0),Z,.035);
  m.launch(new THREE.Vector3(0,1.5,.15),new THREE.Vector3(0,0,-4));
  for(let i=0;i<30&&m.projectiles[0].contacts===0;i++)m.update(1/120);
  const clod=m.projectiles[0];assert(clod.contacts>0,'Scoop must strike the wall');assert(m.stuckMass>.07,'A useful cast must visibly adhere even to dry masonry');
  const first=clod.mesh.quaternion.clone(),initialMass=m.stuckMass,frames=[];
  for(let i=0;i<16;i++){m.update(1/120);frames.push({rotationRadians:clod.mesh.quaternion.angleTo(first),thicknessRatio:clod.mesh.scale.z/clod.mesh.scale.x,kg:m.stuckMass});}
  const maxRotation=Math.max(...frames.map(f=>f.rotationRadians));
  if(version==='after'){assert(maxRotation<1e-8,'Rejected paste flips as its rebound velocity changes');assert(frames.every(f=>f.thicknessRatio<.25),'Impact skin reinflates into a flying lump');assert(Math.abs(clod.mesh.scale.x*clod.mesh.scale.y*clod.mesh.scale.z/(clod.mass/.65)-.046*.030*.064)<1e-10,'Flattening hid residue by shrinking its scale volume');}
  for(let i=0;i<400;i++)m.update(1/120);
  const geometry=m.deposits.map(d=>Array.from(d.mesh.geometry.getAttribute('position').array));
  for(let i=0;i<60;i++)m.update(1/120);
  assert.deepEqual(m.deposits.map(d=>Array.from(d.mesh.geometry.getAttribute('position').array)),geometry,'Adhered mortar keeps changing without a force');
  assert(m.deposits.every(d=>d.mesh.position.lengthSq()===0&&d.mesh.quaternion.angleTo(new THREE.Quaternion())<1e-8),'Adhered mortar leaves its fixed world frame');
  assert(m.stuckMass>=initialMass-1e-8,'Adhered material detached without washing or support removal');
  const t=m.telemetry;assert(Math.abs(t.launchedKg-t.stuckKg-t.floorKg-t.restingKg-t.movingKg)<1e-8,'Flattening lost finite mortar');
  report.cases.push({version,damp,initialHeldKg:initialMass,finalHeldKg:m.stuckMass,maxRotationRadians:maxRotation,frames});
 }
}
assert(report.cases.filter(c=>c.version==='before').some(c=>c.maxRotationRadians>.05),'Fixture no longer reproduces the reported flip');
await writeFile('output/mortar-contact-stability.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({passed:true,cases:report.cases.map(({frames,...c})=>c)},null,2));
