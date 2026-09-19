import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import * as THREE from 'three';
await mkdir('output',{recursive:true});
await build({entryPoints:['src/systems/MortarField.ts'],outfile:'output/immediate-field.mjs',bundle:true,platform:'node',format:'esm',external:['three']});
await build({stdin:{contents:execFileSync('git',['show','f882c74:src/systems/MortarField.ts'],{encoding:'utf8'}),loader:'ts',resolveDir:process.cwd()},outfile:'output/reference-field.mjs',bundle:true,platform:'node',format:'esm',external:['three']});
const {MortarField}=await import('../output/immediate-field.mjs'),{MortarField:Reference}=await import('../output/reference-field.mjs'),report=[];
for(const x of [-.128,0,.123]){
 const f=new MortarField(),ref=new Reference(),solid=p=>p.z<-.06,profile={frontZ:0,supportZ:()=>-.06},p=new THREE.Vector3(x,1.35,-.06),z=new THREE.Vector3(0,0,1);
 const held=f.add(p,z,.65,solid,profile),referenceHeld=ref.add(p,z,.65,solid,profile);assert.equal(held,referenceHeld);assert.deepEqual([...f.nodes],[...ref.nodes],'Pressure shortcut changed deposit');f.finishImpact();assert.equal(f.settling.length,0);assert(Math.abs(f.mass-held)<1e-9);
 const densities=[...f.nodes].map(([k,n])=>[k,n.value]);for(let i=0;i<120;i++)f.tick(1/60);assert.deepEqual([...f.nodes].map(([k,n])=>[k,n.value]),densities,'Density changes after contact');
 for(const n of f.nodes.values()){assert(!solid(new THREE.Vector3(n.x*f.spacing,n.y*f.spacing,n.z*f.spacing)));ref.set(n.x,n.y,n.z,n.value,n.age,n.dilution);}
 ref.dirty.clear();for(const key of f.dirty)ref.dirty.add(key);
 const a=f.remesh(t=>[t]),b=ref.remesh(t=>[t]);assert.equal(a.length,b.length);
 for(let i=0;i<a.length;i++){assert.equal(a[i].key,b[i].key);for(const attr of ['position','normal'])assert.deepEqual(a[i].geometry.getAttribute(attr).array,b[i].geometry.getAttribute(attr).array,'Remesh optimization changed geometry');a[i].geometry.dispose();b[i].geometry.dispose();}
 f.tick(3600);const cured=new Map([...f.nodes].map(([k,n])=>[k,n.value]));f.add(p.clone().add(new THREE.Vector3(.04,0,0)),z,.65,solid,profile);f.finishImpact();for(const [key,value] of cured)assert.equal(f.nodes.get(key).value,value);
 report.push({x,heldKg:held,meshChunks:a.length,unchangedMesh:true,stableAfterContact:true,curedUnchanged:true});
}
{
 const f=new MortarField(),ref=new Reference(),frontZ=-2.41,supportZ=(x,y)=>frontZ-(Math.abs(x)<.07&&Math.abs(y-1.4)<.06?.06:0),solid=p=>p.z<supportZ(p.x,p.y),profile={frontZ,supportZ,impact:{majorScale:1.2,minorScale:.8,rotationRadians:.71,offsetScale:.15,edgePhase:2}};
 for(const spread of [1.69,2.925,4.55,7.15]){const p=new THREE.Vector3(0,1.4,frontZ-.04),z=new THREE.Vector3(0,0,1),held=f.add(p,z,.65,solid,profile,spread),old=ref.add(p,z,.65,solid,profile,spread);assert.equal(held,old);assert.deepEqual([...f.nodes],[...ref.nodes],'Thin coat/cavity pressure result changed');f.finishImpact();for(let i=0;i<4;i++)ref.settleFresh(.06);assert.deepEqual([...f.nodes],[...ref.nodes],'Cached impact transfers changed final shape');}
 report.push({overlappingCavityAndCoat:true,exactPressureAndCompression:true});
}
await writeFile('output/immediate-mortar-physics.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
