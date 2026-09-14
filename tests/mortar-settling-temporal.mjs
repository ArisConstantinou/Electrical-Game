import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import * as THREE from 'three';
await mkdir('output',{recursive:true});
for(const version of ['before','after'])await build({entryPoints:['src/systems/MortarField.ts'],outfile:`output/mortar-temporal-${version}.mjs`,bundle:true,platform:'node',format:'esm',external:['three'],plugins:version==='before'?[{name:'baseline',setup(b){b.onLoad({filter:/[\\/]src[\\/]systems[\\/]MortarField\.ts$/},()=>({contents:execFileSync('git',['show','a49481a2fc6a9f6b961ae21feba3c2aa517a19b3:src/systems/MortarField.ts'],{encoding:'utf8'}),loader:'ts'}));}}]:[]});
const{MortarField:Before}=await import('../output/mortar-temporal-before.mjs'),{MortarField:After}=await import('../output/mortar-temporal-after.mjs'),Z=new THREE.Vector3(0,0,1),p=new THREE.Vector3(0,1,-.06),profile={frontZ:0,supportZ:()=>-.06},solid=q=>q.z<-.06,report={temporal:[],snapshot:null};
for(const[version,Field]of [['before',Before],['after',After]])for(const hz of version==='before'?[60]:[30,60,120]){
 const f=new Field(),held=f.add(p,Z,.65,solid,profile),frames=[];
 for(let i=0;i<hz*.6;i++){
  const old=new Map([...f.nodes].map(([k,n])=>[k,n.value]));f.tick(1/hz);let changed=0,max=0;
  for(const[k,n]of f.nodes){const delta=Math.abs(n.value-(old.get(k)??0));changed+=delta*f.nodeMass;max=Math.max(max,delta);}
  assert(Math.abs(f.mass-held)<1e-8);frames.push({frame:i+1,changedKg:changed,maxNodeDelta:max});
 }
 const result={version,hz,heldKg:held,frames,activeFrames:frames.filter(f=>f.changedKg>1e-8).length,maxNodeDelta:Math.max(...frames.map(f=>f.maxNodeDelta))};report.temporal.push(result);
 if(version==='after'){assert(frames[0].changedKg>0,'Settling still waits then jumps');assert(result.activeFrames>=Math.floor(hz*.2));assert(frames.slice(Math.ceil(hz*.25)).every(f=>f.changedKg===0),'Mortar keeps wobbling after settling');assert.equal(f.settling.length,0);}
}
const before=report.temporal.find(r=>r.version==='before'),after=report.temporal.find(r=>r.version==='after'&&r.hz===60);assert(after.maxNodeDelta<before.maxNodeDelta*.5,'Per-frame settling jumps remain too large');
{
 const field=new After();field.add(new THREE.Vector3(2,2,-.06),Z,.65,solid,profile);for(const c of field.remesh(t=>[t]))c.geometry.dispose();field.add(p,Z,.65,solid,profile);
 const dirty=[...field.dirty],snapshot=field.createMeshSnapshot(),reference=new After();for(const n of field.nodes.values())reference.set(n.x,n.y,n.z,n.value,n.age,n.dilution);reference.dirty.clear();for(const k of dirty)reference.dirty.add(k);
 assert.deepEqual([...field.dirty],dirty,'Snapshot stole dirty state from the live field');assert(snapshot.nodes.size<field.nodes.size,'Snapshot copied distant unchanged deposits');
 const expected=new Map(reference.remesh(t=>[t]).map(c=>[c.key,c]));let chunks=0;
 while(snapshot.dirty.size){field.tick(1/120);for(const c of snapshot.remesh(t=>[t],1)){const e=expected.get(c.key);assert(e);assert.deepEqual(c.geometry.getAttribute('position').array,e.geometry.getAttribute('position').array,'Snapshot mixed field revisions across frames');assert.deepEqual(c.geometry.getAttribute('normal').array,e.geometry.getAttribute('normal').array,'Snapshot omitted the normal halo');assert.equal(c.mass,e.mass);c.geometry.dispose();e.geometry.dispose();chunks++;}}
 report.snapshot={chunks,snapshotNodes:snapshot.nodes.size,liveNodes:field.nodes.size,coherentWithFullCopy:true};
}
await writeFile('output/mortar-settling-temporal.json',JSON.stringify(report,null,2));console.log(JSON.stringify({temporal:report.temporal.map(({frames,...r})=>r),snapshot:report.snapshot},null,2));
