import assert from 'node:assert/strict';
import {MortarSlump} from '../src/systems/MortarSlump.ts';
import {mortarSurfaceGeometry,MORTAR_SEGMENTS,MORTAR_DIRECTIONS,mortarReliefAt} from '../src/systems/MortarAppearance.ts';

const geometry=mortarSurfaceGeometry(),indices=geometry.index.array,edges=new Map();
for(let i=0;i<indices.length;i+=3)for(const [a,b] of [[indices[i],indices[i+1]],[indices[i+1],indices[i+2]],[indices[i+2],indices[i]]]){
 assert.notEqual(a,b,'No collapsed triangles at the centre');const key=a<b?`${a}:${b}`:`${b}:${a}`;edges.set(key,(edges.get(key)??0)+1);
}
const boundary=[...edges].filter(([,count])=>count===1),rimStart=geometry.getAttribute('position').count-MORTAR_SEGMENTS;
assert.equal(boundary.length,MORTAR_SEGMENTS,'Only the outside rim may be open; no radial cuts');
assert(boundary.every(([key])=>key.split(':').every(v=>Number(v)>=rimStart)));assert([...edges.values()].every(n=>n===1||n===2));geometry.dispose();
const gaps=MORTAR_DIRECTIONS.map((a,i)=>{const b=MORTAR_DIRECTIONS[(i+1)%MORTAR_SEGMENTS];return Math.hypot((a.x-b.x)*.335,(a.z-b.z)*.462);});
assert(Math.max(...gaps)<.012,'Resolve small clods at every edge, including the centre axes');
const relief=[];for(let z=-.34;z<-.14;z+=.004)for(let x=-.24;x<.24;x+=.004)relief.push(mortarReliefAt(x,z));
relief.sort((a,b)=>a-b);assert(relief[Math.floor(relief.length*.95)]-relief[Math.floor(relief.length*.05)]>.008,'The reported smooth region needs millimetre-scale geometric clods, independent of its texture');

for(const seed of [1,77,3185,92026]){
 const material=new MortarSlump(seed),heights=()=>Array.from({length:30},(_,i)=>material.height((i%5-2)*.12,(Math.floor(i/5)-2.5)*.12));
 const rest=heights();for(let i=0;i<240;i++)material.update(1/120,.04,-.04);
 assert.deepEqual(heights(),rest,'Gentle force must leave sticky mortar at rest, without time-based waves');
 for(let i=0;i<90;i++)material.update(1/120,.25,0);
 const shifted=material.telemetry.patches.map(p=>p.offset[0]);assert(Math.max(...shifted)>.035);assert(Math.max(...shifted)-Math.min(...shifted)>.01,'Regions must slip unevenly');
 for(let i=0;i<360;i++)material.update(1/120,0,0);
 const settled=heights();assert(settled.some((h,i)=>Math.abs(h-rest[i])>.008),'Slump must leave a permanent uneven shape');
 for(let i=0;i<240;i++)material.update(1/120,0,0);
 assert.deepEqual(heights(),settled,'Settled mortar must not keep oscillating');
 const chunks=[];for(let i=0;i<800;i++){material.update(1/120,0,0);const m=material.takeChunk(1/120,.08,false);if(m)chunks.push(m);}
 assert(chunks.length>3&&chunks.every(m=>m>=.35),'Overflow must release cohesive chunks');assert(new Set(chunks.map(m=>m.toFixed(2))).size>3,'Chunk sizes must vary');
}
for(const side of [-1,1]){
 const m=new MortarSlump(3185),mean=x=>Array.from({length:21},(_,i)=>m.height(x,-.25+i*.025)).reduce((a,b)=>a+b,0)/21;
 const highBefore=mean(-side*.2),lowBefore=mean(side*.3);
 for(let i=0;i<180;i++)m.update(1/120,side*.55,0);
 assert(mean(-side*.2)<highBefore-.04,'The uphill bulk must visibly empty, not just lose its texture crests');
 assert(mean(side*.3)>lowBefore+.035,'Transferred bulk must build up at the downhill lip');
 assert(m.loadOffset.x*side>.08,'The retained load centre must follow the sliding material');
}
console.log('PASS: adhesion, uneven slipping, persistent shape, no waves at rest, irregular chunk release (4 seeds)');
