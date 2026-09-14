import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import * as THREE from 'three';
await mkdir('output',{recursive:true});
const report={baseline:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),scoopKg:.65,cases:[]};
for(const version of ['before','after'])await build({entryPoints:['src/systems/MortarSystem.ts'],outfile:`output/mortar-fill-${version}.mjs`,bundle:true,platform:'node',format:'esm',external:['three'],plugins:version==='before'?[{name:'baseline-mortar',setup(b){b.onLoad({filter:/[\\/]src[\\/]systems[\\/]Mortar(System|Field)\.ts$/},({path})=>({contents:execFileSync('git',['show',`HEAD:src/systems/${path.split(/[\\/]/).at(-1)}`],{encoding:'utf8'}),loader:'ts'}));}}]:[]});
const Z=new THREE.Vector3(0,0,1);
for(const fixture of [{name:'80 × 80 × 40 mm simple hole',w:.08,h:.08,d:.04,targets:[[0,1]]},{name:'120 × 100 × 40 mm hole',w:.12,h:.10,d:.04,targets:[[-.025,1],[.025,1]]},{name:'250 × 100 × 50 mm mixed-box chase',w:.25,h:.10,d:.05,targets:[[-.08,1],[0,1],[.08,1]]}]){
 const result={fixture,physicalCapacityKg:fixture.w*fixture.h*fixture.d*1900};
 for(const version of ['before','after']){
  const {MortarSystem}=await import(`../output/mortar-fill-${version}.mjs`),solid=(x,y,z)=>z< -fixture.d||(z<0&&(Math.abs(x)>fixture.w/2||Math.abs(y-1)>fixture.h/2));
  const wall={volume:{frontZ:0,isOccupied:solid,raycast(origin,direction,max){for(let t=0;t<=max;t+=.001){const p=new THREE.Vector3().copy(origin).addScaledVector(direction,t);if(solid(p.x,p.y,p.z))return{point:p,normal:Z.clone()};}return null;}}};
  const system=new MortarSystem(new THREE.Scene(),wall,[]),camera=new THREE.PerspectiveCamera(),loads=[];
  for(let load=0;load<10;load++){
   const [x,y]=fixture.targets[load%fixture.targets.length];camera.position.set(x,y,.4);camera.lookAt(x,y,-fixture.d);camera.updateMatrixWorld(true);
   const origin=camera.position.clone().addScaledVector(camera.getWorldDirection(new THREE.Vector3()),.17);
   system.swing(true,.475,camera,origin);system.swing(false,0,camera,origin);system.swing(false,.16,camera,()=>origin);
   for(let frame=0;frame<100;frame++)system.update(.01);
   let samples=0,filled=0;for(let xx=-fixture.w/2+.012;xx<fixture.w/2-.009;xx+=.012)for(let yy=1-fixture.h/2+.012;yy<1+fixture.h/2-.009;yy+=.012)for(let z=-fixture.d+.01;z<-.003;z+=.008){samples++;if(system.field.sample(new THREE.Vector3(xx,yy,z))>=.35)filled++;}
   const t=system.telemetry,error=t.launchedKg-t.stuckKg-t.restingKg-t.floorKg-t.movingKg;assert(Math.abs(error)<1e-8);assert(Math.abs(t.stuckKg-system.field.mass)<1e-8);
   loads.push({scoops:load+1,fillFraction:filled/samples,heldKg:t.stuckKg,launchedKg:t.launchedKg});
   if(filled/samples>=.95)break;
  }
  result[version]={scoopsTo95:loads.at(-1).fillFraction>=.95?loads.length:null,loads};
 }
 assert(result.after.scoopsTo95!==null,'Finite aimed scoops did not fill the hole');
 assert(result.after.scoopsTo95<=result.before.scoopsTo95,'Practical fill regressed');
 report.cases.push(result);
}
assert(report.cases[0].after.scoopsTo95<=2,'A simple hole still needs excessive scoops');
await writeFile('output/mortar-practical-fill.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
