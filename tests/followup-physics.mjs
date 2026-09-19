import {createServer} from 'vite';
import * as THREE from 'three';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const baseline=process.argv.includes('--baseline'),out=`output/followup-${baseline?'before':'after'}`;await mkdir(out,{recursive:true});
const server=await createServer({plugins:baseline?[{name:'protected-source',enforce:'pre',load(id){const file=id.replaceAll('\\','/').split('/src/')[1];if(['systems/MortarSystem.ts','systems/MortarField.ts','systems/ChasingSystem.ts'].includes(file))return execFileSync('git',['show',`d8bd3a8:src/${file}`],{encoding:'utf8'});}}]:[],server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'error'}),report={};
try{
 const {MortarSystem}=await server.ssrLoadModule('/src/systems/MortarSystem.ts');
 const {MasonryVolume}=await server.ssrLoadModule('/src/world/MasonryVolume.ts');
 const {ChasingSystem}=await server.ssrLoadModule('/src/systems/ChasingSystem.ts');
 const {InstallationPoint}=await server.ssrLoadModule('/src/electrical/InstallationPoint.ts');
 const {BoxPlacementSystem}=await server.ssrLoadModule('/src/systems/BoxPlacementSystem.ts');
 let removedSupport=false;
 const v=new MasonryVolume({seed:260913}),wall={volume:v,isSolidAt:(x,y,z)=>!removedSupport&&v.isOccupied(x,y,z),processPendingSupport:()=>null},scene=new THREE.Scene(),points=[],m=new MortarSystem(scene,wall,points),c=new THREE.PerspectiveCamera(),f=v.frontZ;
 c.position.set(0,1.65,f+.65);c.lookAt(0,1.4,f);c.updateMatrixWorld(true);const tip=new THREE.Vector3(.05,1.4,f+.25);
 const step=(held,n)=>{for(let i=0;i<n;i++){m.swing(held,1/60,c,tip);m.update(1/60);}};
 step(true,28);step(false,24);step(true,40);report.rearm={phase:m.throwFeedback.phase,holding:m.throwFeedback.holding,launched:m.launchedMass};step(false,65);
 // Broad unchanged bed makes global box invalidation measurable.
 for(let x=-.4;x<=.4001;x+=.10)for(let y=1.15;y<=1.7501;y+=.1){const kg=m.deposit(new THREE.Vector3(x,y,f),.65,new THREE.Vector3(0,0,1),false,1.69);m.stuckMass+=kg;m.launchedMass+=kg;}
 for(let i=0;i<120;i++)m.update(1/60);await m.waitForGeometry();
 const latency=()=>{const old=new Map(m.deposits.map(d=>[d.fieldKey,d.mesh.geometry]));let first=null,last=0;const times=[];for(let i=0;i<90;i++){const t=performance.now();m.update(1/60);times.push(performance.now()-t);if(m.deposits.some(d=>old.get(d.fieldKey)!==d.mesh.geometry)&&first===null)first=i+1;if(m.pendingGeometryChunks)last=i+1;}return{firstFrame:first,lastPendingFrame:last,maxUpdateMs:Math.max(...times)};};
 m.deposit(new THREE.Vector3(.44,1.45,f),.65,new THREE.Vector3(0,0,1),false,1.69);report.impactLatency=latency();
 const placement=new BoxPlacementSystem(wall,m,points),add=()=>{const p=new InstallationPoint({id:`test-${points.length}`,label:'test',kind:'socket',boxes:['2G','1G'],x:0,bottom:1.4});points.push(p);scene.add(p);return p;};
 const a=add();c.lookAt(0,1.4,f);c.updateMatrixWorld(true);report.firstBox=placement.place(a,c);report.boxLatency=latency();
 const b=add(),gap=a.boxGroup.groupWidth+.012;c.position.set(0,1.65,f+.65);c.lookAt(gap,1.4,f);c.updateMatrixWorld(true);report.neighbor=placement.assess(b,c);
 // Real removed fragments remain at their native fracture coordinates.
 const debris=new ChasingSystem(scene,wall);let strikes=0;
 for(let pass=0;pass<3;pass++)for(let x=-.17;x<=.1701;x+=.034)for(let y=1.25;y<=1.4501;y+=.04){const hit=v.raycast({x,y,z:f+.1},{x:0,y:0,z:-1},.3);if(hit&&f-hit.point.z<.07){const impact=v.impact({point:hit.point,direction:{x:0,y:0,z:-1},chisel:'flat',widthM:.025,energyJ:5});debris.spawnDebris(impact);strikes++;}debris.update(1/60);}
 const times=[];for(let i=0;i<1200;i++){const start=performance.now();debris.update(1/60);times.push(performance.now()-start);}
 const suspended=debris.particles.filter(p=>!p.settled&&p.mesh.position.y>.2);
 times.sort((a,b)=>a-b);
 report.debris={strikes,total:debris.particles.length,suspended:suspended.map(p=>({p:p.mesh.position.toArray(),velocity:p.velocity.toArray(),spin:p.angularVelocity.length(),overlap:debris.overlapsWall(p),supported:debris.hasWallSupport(p)})),unsupported:debris.unsupportedSettledFragmentCount,p95Ms:times[Math.floor(times.length*.95)],maxMs:times.at(-1)};
 const supported=debris.particles.filter(p=>p.wallSupported);removedSupport=true;v.surfaceSequence++;
 for(let i=0;i<180;i++)debris.update(1/60);
 report.supportRemoval={before:supported.length,remainingHigh:supported.filter(p=>p.mesh.visible&&p.mesh.position.y>.2).length,unsupported:debris.unsupportedSettledFragmentCount};
 await writeFile(`${out}/physics.json`,JSON.stringify(report,null,2));
 if(!baseline){assert(report.rearm.holding&&report.rearm.phase>0,'New hold after release was discarded');assert(report.impactLatency.firstFrame<=4,'Mortar impact remains invisible');assert(report.boxLatency.firstFrame<=4,'Box displacement remains invisible');assert(report.neighbor.canPlace,'Clear adjacent casing is blocked');assert.equal(suspended.length,0,'Broken bricks remain spinning in the wall');assert.equal(report.debris.unsupported,0);assert(report.supportRemoval.before>0);assert.equal(report.supportRemoval.remainingHigh,0,'Fragments stay floating after their support is removed');assert.equal(report.supportRemoval.unsupported,0);}
 console.log(JSON.stringify({...report,neighbor:{canPlace:report.neighbor.canPlace,reason:report.neighbor.reason},debris:{...report.debris,suspended:report.debris.suspended.slice(0,6)}}));
}finally{await server.close();}
