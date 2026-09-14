import assert from 'node:assert/strict';import {build} from 'esbuild';import {execFileSync} from 'node:child_process';import {mkdir,writeFile} from 'node:fs/promises';import * as THREE from 'three';
await mkdir('output',{recursive:true});
const source=execFileSync('git',['show','9a4b9dd:src/systems/MortarField.ts'],{encoding:'utf8'});
await build({stdin:{contents:source,resolveDir:process.cwd()+'/src/systems',loader:'ts'},outfile:'output/mortar-mesh-baseline.mjs',bundle:true,platform:'node',format:'esm',external:['three']});
await build({entryPoints:['src/systems/MortarField.ts'],outfile:'output/mortar-mesh-current.mjs',bundle:true,platform:'node',format:'esm',external:['three']});
const {MortarField:Before}=await import('../output/mortar-mesh-baseline.mjs');const {MortarField:After}=await import('../output/mortar-mesh-current.mjs');
const report={cases:[]};
for(const offset of [-.127,0,.119]){
 const before=new Before(),after=new After(),Z=new THREE.Vector3(0,0,1),p=new THREE.Vector3(offset,1,-.06),profile={frontZ:0,supportZ:()=>-.06},solid=q=>q.z<-.06;
 for(let scoop=0;scoop<5;scoop++)before.add(p.clone().add(new THREE.Vector3(scoop%2*.032,scoop%3*.023,0)),Z,.65,solid,profile);
 for(const node of before.nodes.values())after.set(node.x,node.y,node.z,node.value,node.age,node.dilution);
 const beforeMs=[],afterMs=[];let triangles=0;
 for(let trial=0;trial<5;trial++){
  before.invalidateGeometry();after.invalidateGeometry();let start=performance.now();const old=before.remesh(t=>[t]);beforeMs.push(performance.now()-start);start=performance.now();const current=after.remesh(t=>[t]);afterMs.push(performance.now()-start);
  // Replaying final nodes changes dirty-queue insertion order, not the surface
  // belonging to each chunk. Compare each spatial chunk by its stable key.
  old.sort((a,b)=>a.key.localeCompare(b.key));current.sort((a,b)=>a.key.localeCompare(b.key));
  assert.equal(current.length,old.length);for(let i=0;i<old.length;i++){assert.equal(current[i].key,old[i].key);assert.equal(current[i].mass,old[i].mass);for(const a of ['position','normal'])assert.deepEqual(current[i].geometry.getAttribute(a).array,old[i].geometry.getAttribute(a).array);if(!trial)triangles+=old[i].geometry.getAttribute('position').count/3;old[i].geometry.dispose();current[i].geometry.dispose();}
 }
 report.cases.push({offset,triangles,beforeMs,afterMs,massKg:after.mass});
 // A failing opening clip must not leave a stale scalar snapshot for future physics.
 after.invalidateGeometry();assert.throws(()=>after.remesh(()=>{throw new Error('clip test');}));assert.equal(after.meshSamples,null);assert.deepEqual(after.raycast(new THREE.Vector3(offset,1,.1),Z.clone().negate(),.3),before.raycast(new THREE.Vector3(offset,1,.1),Z.clone().negate(),.3));
}
const total=k=>report.cases.reduce((s,c)=>s+c[k].slice(1).reduce((a,b)=>a+b,0),0);report.warmBeforeMs=total('beforeMs');report.warmAfterMs=total('afterMs');report.passed=true;await writeFile('output/mortar-mesh-performance.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
