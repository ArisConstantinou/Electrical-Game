import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import * as THREE from 'three';
await mkdir('output',{recursive:true});
await build({entryPoints:['src/systems/MortarSystem.ts'],outfile:'output/mortar-atomic-system.mjs',bundle:true,platform:'node',format:'esm',external:['three']});
const {MortarSystem}=await import('../output/mortar-atomic-system.mjs?'+Date.now());
const wall={volume:{frontZ:0,isOccupied:(x,y,z)=>z<-.06,raycast(origin,direction,max){if(direction.z>=0)return null;const t=(-.06-origin.z)/direction.z;return t>=0&&t<=max?{point:new THREE.Vector3().copy(origin).addScaledVector(direction,t),normal:new THREE.Vector3(0,0,1)}:null;}}};
const system=new MortarSystem(new THREE.Scene(),wall,[]),field=system.field;
const held=system.deposit(new THREE.Vector3(0,1,-.06),.65,new THREE.Vector3(0,0,1));
const report={heldKg:held,frames:[],publications:0,maxSeamMismatches:0};
function geometries(){return new Map(system.deposits.filter(d=>d.fieldKey).map(d=>[d.fieldKey,d.mesh.geometry]));}
function seamMismatches(){let mismatched=0;const map=geometries();
 for(const [key,g]of map){const [x,y,z]=key.split(',').map(Number);if(x!==-1)continue;const other=map.get(`0,${y},${z}`);if(!other)continue;
  const collect=geometry=>{const values=new Set(),a=geometry.getAttribute('position');for(let i=0;i<a.count;i++)if(Math.abs(a.getX(i))<1e-8)values.add(`${a.getY(i).toFixed(7)},${a.getZ(i).toFixed(7)}`);return values;};
  const a=collect(g),b=collect(other);for(const key of a)if(!b.has(key))mismatched++;for(const key of b)if(!a.has(key))mismatched++;
 }
 return mismatched;
}
function seamNormalAngle(){
 let maximum=0;const map=geometries();
 for(const [key,geometry]of map){const[x,y,z]=key.split(',').map(Number);if(x!==-1)continue;const other=map.get(`0,${y},${z}`);if(!other)continue;
  const normals=new Map(),a=geometry.getAttribute('position'),n=geometry.getAttribute('normal');
  for(let i=0;i<a.count;i++)if(Math.abs(a.getX(i))<1e-8)normals.set(`${a.getY(i).toFixed(7)},${a.getZ(i).toFixed(7)}`,new THREE.Vector3().fromBufferAttribute(n,i));
  const b=other.getAttribute('position'),bn=other.getAttribute('normal');
  for(let i=0;i<b.count;i++)if(Math.abs(b.getX(i))<1e-8){const normal=normals.get(`${b.getY(i).toFixed(7)},${b.getZ(i).toFixed(7)}`);if(normal)maximum=Math.max(maximum,normal.angleTo(new THREE.Vector3().fromBufferAttribute(bn,i)));}
 }
 return maximum;
}
assert.equal(seamMismatches(),0);
let previous=geometries();
for(let i=0;i<36;i++){
 field.tick(1/60);
 system.syncFieldGeometry(1);
 const map=geometries(),changed=[...map].filter(([k,g])=>previous.get(k)!==g).length;
 if(changed)report.publications++;
 // No geometry from an unfinished batch may become visible, even if only a
 // subset of the four original chunks needs refreshing in a later revision.
 assert(!changed||!system.pendingFieldMesh,'An unfinished batch was partially published');
 const seams=seamMismatches();report.maxSeamMismatches=Math.max(report.maxSeamMismatches,seams);assert.equal(seams,0,`Visible seam opened on frame ${i+1}`);
 assert(Math.abs(field.mass-held)<1e-9,'Mesh staging changed physical mortar mass');
 if(system.pendingFieldMesh)assert(system.pendingFieldMesh.chunks.length<=3,'Preparation bypassed the one-chunk budget');
 report.frames.push({frame:i+1,changed,pending:system.pendingGeometryChunks,fieldRevision:field.revision});previous=map;
}
assert(report.publications>=3,'Continuous changes starved publication');assert.equal(system.pendingGeometryChunks,0);
// Washing continues changing the live volume while an older immutable batch
// finishes. It must neither restart forever nor restore removed field mass.
field.invalidateGeometry();let removed=0,waterPublications=0;previous=geometries();
for(let i=0;i<16;i++){
 removed+=field.wash(new THREE.Vector3(0,1,-.03),.006).removedKg;
 system.syncFieldGeometry(1);
 const map=geometries();if([...map].some(([k,g])=>previous.get(k)!==g))waterPublications++;previous=map;
 assert(Math.abs(field.mass-(held-removed))<1e-9);assert.equal(seamMismatches(),0);
}
assert(waterPublications>=3,'Holding the hose prevented mortar surface updates');
await system.waitForGeometry();assert.equal(system.pendingGeometryChunks,0);
field.invalidateGeometry();const expected=field.createMeshSnapshot();field.dirty.clear();
const current=geometries();for(const chunk of expected.remesh(t=>[t])){
 const actual=current.get(chunk.key);if(!chunk.geometry.getAttribute('position').count){assert(!actual);chunk.geometry.dispose();continue;}
 assert(actual);assert.deepEqual(actual.getAttribute('position').array,chunk.geometry.getAttribute('position').array,'Published surface did not catch up to washed field');chunk.geometry.dispose();
}
// A moved/inserted box invalidates its old clipping snapshot: drop unpublished
// resources and restore every dirty key so the replacement cannot lose work.
field.invalidateGeometry();system.syncFieldGeometry(1);const batch=system.pendingFieldMesh;assert(batch);
let disposed=0;for(const chunk of batch.chunks)chunk.geometry.addEventListener('dispose',()=>disposed++);
system.cancelFieldMeshBatch();assert.equal(disposed,batch.chunks.length);assert.equal(system.pendingFieldMesh,null);
for(const key of batch.keys)assert(field.dirty.has(key));await system.waitForGeometry();assert.equal(seamMismatches(),0);
// Complete removal must publish empty chunks and retire every old mesh.
field.removeWhere(()=>true);await system.waitForGeometry();assert.equal(system.deposits.filter(d=>d.fieldKey).length,0);assert.equal(field.mass,0);
// A changed node one lattice step inside the right chunk can leave all seam
// positions unchanged but alter the +/-0.6-cell gradient on the left. Dirtying
// only cubes directly touching that node left a permanent lighting seam.
report.normalHaloCases=[];
for(const topDensity of [.5,.7])for(const changedZ of [0,1]){
 for(let x=-3;x<=3;x++)for(let y=121;y<=129;y++)for(let z=-3;z<=0;z++)field.set(x,y,z,z===0?topDensity:1,0);
 system.syncFieldGeometry(Infinity);assert(seamNormalAngle()<1e-5);
 field.set(1,125,changedZ,.25,0);let frames=0,maxAngle=0;
 while(system.pendingGeometryChunks){system.syncFieldGeometry(1);frames++;assert(frames<20);maxAngle=Math.max(maxAngle,seamNormalAngle());assert.equal(seamMismatches(),0);}
 assert(maxAngle<1e-5,`Fractional-density normal halo opened a ${maxAngle*180/Math.PI} degree lighting seam`);
 report.normalHaloCases.push({topDensity,changedZ,frames,maxNormalAngleDegrees:maxAngle*180/Math.PI});
 field.removeWhere(()=>true);await system.waitForGeometry();
}
report.waterPublications=waterPublications;report.cancelledChunksDisposed=disposed;report.passed=true;
await writeFile('output/mortar-atomic-mesh.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,frames:report.frames.length},null,2));
