import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import * as THREE from 'three';
await mkdir('output',{recursive:true});
await build({entryPoints:['src/systems/MortarSystem.ts'],outfile:'output/mortar-soft-system.mjs',bundle:true,platform:'node',format:'esm',external:['three']});
const {MortarSystem}=await import('../output/mortar-soft-system.mjs');
const Z=new THREE.Vector3(0,0,1),report={checks:[]};
function cavity(half=.04,depth=.04){
 const solid=(x,y,z)=>z< -depth||(z<0&&(Math.abs(x)>half||Math.abs(y-1)>half));
 return {volume:{frontZ:0,isOccupied:solid,raycast(origin,direction,max){for(let t=0;t<=max;t+=.001){const p=new THREE.Vector3().copy(origin).addScaledVector(direction,t);if(solid(p.x,p.y,p.z))return{point:p,normal:Z.clone()};}return null;}}};
}
const snapshot=f=>new Map([...f.nodes].map(([k,n])=>[k,{...n}]));
const changed=(a,f)=>[...new Set([...a.keys(),...f.nodes.keys()])].reduce((s,k)=>s+Math.abs((a.get(k)?.value??0)-(f.nodes.get(k)?.value??0))*f.nodeMass,0);
{
 const system=new MortarSystem(new THREE.Scene(),cavity(.07,.06),[]),f=system.field;
 const held=system.deposit(new THREE.Vector3(0,1,-.06),.65,Z,false),initial=snapshot(f),frames=[];
 for(let i=0;i<4;i++){f.tick(.061);frames.push({time:(i+1)*.061,changedKg:changed(initial,f),mass:f.mass});assert(Math.abs(f.mass-held)<1e-9);}
 assert(frames[0].changedKg>.015,'Landing has no actual short plastic response');
 assert(frames[3].changedKg>frames[0].changedKg,'Settling stops after one instantaneous update');
 const settled=snapshot(f);for(let i=0;i<60;i++)f.tick(1/60);assert.equal(changed(settled,f),0,'Mortar keeps melting after the impact ends');
 for(const n of f.nodes.values())assert(!system.wall.volume.isOccupied(n.x*f.spacing,n.y*f.spacing,n.z*f.spacing));
 f.tick(3600);const cured=snapshot(f);system.deposit(new THREE.Vector3(.04,1,-.04),.65,Z,false);for(let i=0;i<5;i++)f.tick(.061);
 for(const [key,n] of cured)assert.equal(f.nodes.get(key)?.value,n.value,'A later scoop remobilized cured mortar');
 report.checks.push({name:'short settling, finite mass, cured bed unchanged',heldKg:held,frames});
}
{
 const scene=new THREE.Scene(),system=new MortarSystem(scene,cavity(.08,.07),[]),f=system.field;
 const held=system.deposit(new THREE.Vector3(0,1,-.07),.65,Z,false);system.stuckMass+=held;system.launchedMass+=held;
 const point=new THREE.Group(),group=new THREE.Group(),box=new THREE.Group();box.width=box.height=.074;box.depth=.047;group.boxes=[box];group.add(box);point.add(group);point.boxGroup=group;point.position.y=1;point.definition={id:'moving-box'};scene.add(point);system.points.push(point);
 system.refreshOpeningGeometry();for(let i=0;i<4;i++)f.tick(.061);
 for(const n of f.nodes.values())assert(!system.insideBox(new THREE.Vector3(n.x*f.spacing,n.y*f.spacing,n.z*f.spacing)),'Settling refilled a newly inserted box');
 assert(Math.abs(system.telemetry.launchedKg-system.stuckMass-system.pendingWashMass)<1e-8);
 report.checks.push({name:'box inserted during settling stays clear',fieldKg:f.mass,displacedKg:system.pendingWashMass});
}
{
 const system=new MortarSystem(new THREE.Scene(),cavity(.07,.06),[]),f=system.field;
 system.deposit(new THREE.Vector3(0,1,-.06),.65,Z,false);
 const count=f.nodes.size,mass=f.mass;f.maxNodes=count;
 for(let i=0;i<5;i++)f.tick(.061);
 assert(f.nodes.size<=count,'Settling bypassed the node budget');assert(Math.abs(f.mass-mass)<1e-9);
 assert.equal(f.settling.length,0,'Settling work never drained');
 report.checks.push({name:'bounded node count and finite settling queue',maxNodes:count,massKg:mass});
}
await writeFile('output/mortar-soft-settling.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
