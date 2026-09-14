import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import * as THREE from 'three';
await mkdir('output',{recursive:true});
const report={fixture:'Identical finite prefilled wet bed around a 48 × 6 mm surviving shallow clay rib. Finishing casts use production swing, timed release, trajectory, collision and retention. Seven sub-cell wall alignments avoid favoring the 8 mm mortar lattice.',scoopKg:.65,cases:[]};
for(const version of ['before','after'])await build({entryPoints:['src/systems/MortarSystem.ts'],outfile:`output/mortar-tiny-${version}.mjs`,bundle:true,platform:'node',format:'esm',external:['three'],plugins:version==='before'?[{name:'baseline',setup(b){b.onLoad({filter:/[\\/]src[\\/]systems[\\/]Mortar(System|Field)\.ts$/},({path})=>({contents:execFileSync('git',['show','a49481a2fc6a9f6b961ae21feba3c2aa517a19b3:src/systems/'+path.split(/[\\/]/).at(-1)],{encoding:'utf8'}),loader:'ts'}));}}]:[]});
const{MortarSystem:Before}=await import('../output/mortar-tiny-before.mjs'),{MortarSystem:After}=await import('../output/mortar-tiny-after.mjs'),Z=new THREE.Vector3(0,0,1);
for(const front of [-2.416,-2.415,-2.414,-2.413,-2.412,-2.411,-2.41]){
 const solid=(x,y,z)=>z<=front-.05||(z<=front&&(Math.abs(x)>.075||Math.abs(y-1)>.075))||(z<=front-.001&&Math.abs(x)<.024&&Math.abs(y-1)<.003);
 const wall={volume:{frontZ:front,isOccupied:solid,raycast(o,d,max){for(let t=0;t<=max;t+=.0005){const p=o.clone().addScaledVector(d,t);if(solid(p.x,p.y,p.z))return{point:p,normal:Z.clone()};}return null;}}};
 const before=new Before(new THREE.Scene(),wall,[]),after=new After(new THREE.Scene(),wall,[]);
 // A finite existing bed is identical in both runs; the fix cannot silently
 // reconstruct or top up the initial mortar during fixture setup.
 for(let i=0;i<10;i++){const held=before.deposit(new THREE.Vector3(0,1,front-.03),.6,Z,false,.65);before.stuckMass+=held;before.launchedMass+=.6;before.floorMass+=.6-held;for(let step=0;step<4;step++)before.field.tick(.061);}
 for(const n of before.field.nodes.values())after.field.set(n.x,n.y,n.z,n.value,n.age,n.dilution);
 after.stuckMass=before.stuckMass;after.launchedMass=before.launchedMass;after.floorMass=before.floorMass;
 const sample=m=>{let count=0,covered=0;for(let x=-.02;x<=.02001;x+=.004){const o=new THREE.Vector3(x,1,front+.05),d=Z.clone().negate(),h=m.field.raycast(o,d,.1),w=wall.volume.raycast(o,d,.1);count++;if(h&&h.point.z>w.point.z+.0001)covered++;}return covered/count;};
 const result={frontZ:front,initialCovered:sample(before),before:[],after:[]};assert.equal(result.initialCovered,sample(after));
 for(const[version,m]of [['before',before],['after',after]]){
  const camera=new THREE.PerspectiveCamera();camera.position.set(0,1,front+.4);camera.lookAt(0,1,front-.001);camera.updateMatrixWorld(true);
  for(let i=0;i<3;i++){
   const origin=camera.position.clone().addScaledVector(camera.getWorldDirection(new THREE.Vector3()),.17),previous=m.launchedMass;
   m.swing(true,.475,camera,origin);m.swing(false,0,camera,origin);assert.equal(m.launchedMass,previous);m.swing(false,.16,camera,()=>origin);
   assert(Math.abs(m.launchedMass-previous-.65)<1e-9);
   for(let step=0;step<120;step++)m.update(.01);
   const t=m.telemetry,error=t.launchedKg-t.stuckKg-t.restingKg-t.floorKg-t.movingKg;
   assert(Math.abs(error)<1e-8);assert(Math.abs(m.field.mass-m.stuckMass)<1e-8);
   result[version].push({casts:i+1,covered:sample(m),stuckKg:m.stuckMass,errorKg:error});
  }
  for(const n of m.field.nodes.values())assert(!solid(n.x*m.field.spacing,n.y*m.field.spacing,n.z*m.field.spacing),'Mortar nodes entered solid clay');
  if(version==='after'){
   for(const chunk of m.field.remesh(t=>[t]))chunk.geometry.dispose();
   let outer=-Infinity;for(const deposit of m.deposits){const p=deposit.mesh.geometry.getAttribute('position');for(let i=0;i<p.count;i++)outer=Math.max(outer,p.getZ(i)-front);}
   assert(outer<=.0101,'Finishing creates an unbounded outward lump');result.outerMm=outer*1000;
   assert.equal(sample(m),1,'A small remaining slit still cannot receive a finishing scoop');
  }
 }
 report.cases.push(result);
}
assert(report.cases.filter(c=>c.before.at(-1).covered<1).length>=3,'Fixture no longer reproduces the original tiny-gap failure');
await writeFile('output/mortar-tiny-gaps.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
