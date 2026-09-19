import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {mkdir,writeFile} from 'node:fs/promises';
import * as THREE from 'three';

await mkdir('output',{recursive:true});
const server=await createServer({server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom',logLevel:'error'});
const report={checks:[],timing:[]};
try{
 const {MasonryVolume}=await server.ssrLoadModule('/src/world/MasonryVolume.ts');
 const {MortarSystem}=await server.ssrLoadModule('/src/systems/MortarSystem.ts');
 const {InstallationPoint}=await server.ssrLoadModule('/src/electrical/InstallationPoint.ts');
 const {BoxPlacementSystem}=await server.ssrLoadModule('/src/systems/BoxPlacementSystem.ts');
 const {GAME_CONFIG}=await server.ssrLoadModule('/src/data/gameConfig.ts');
 let id=0;
 function fixture(kinds=['2G','1G']){
  const points=[],scene=new THREE.Scene(),wall={volume:new MasonryVolume({seed:190319,solidMaterial:1})};
  const mortar=new MortarSystem(scene,wall,points),system=new BoxPlacementSystem(wall,mortar,points),camera=new THREE.PerspectiveCamera();
  const add=()=>{const p=new InstallationPoint({id:`fit-${++id}`,label:'Preflight specimen',kind:'socket',boxes:kinds,x:.4,bottom:.3});points.push(p);scene.add(p);return p;};
  const point=add(),front=wall.volume.frontZ;camera.position.set(0,1.2,front+.42);camera.lookAt(0,1.2,front);camera.updateMatrixWorld(true);
  return{points,scene,wall,mortar,system,camera,point,add,front};
 }
 function excavate(v,width,height,depth){
  const save=v.serialize(),chunks=new Map(save.chunks.map(c=>[c.key,new Map(c.edits.map(e=>[e[0],e]))]));let removed=0;
  for(let x=1;x<=v.nx;x++){
   if(Math.abs(v.nodePosition(x,1,1).x)>width/2)continue;
   for(let y=1;y<=v.ny;y++){
    if(Math.abs(v.nodePosition(x,y,1).y-1.2)>height/2)continue;
    for(let z=1;z<=v.nz;z++){
     if(v.frontZ-v.nodePosition(x,y,z).z>depth)continue;
     const tx=Math.floor(x/v.tileSize),ty=Math.floor(y/v.tileSize),key=`${tx},${ty}`,offset=((y-ty*v.tileSize)*v.tileSize+x-tx*v.tileSize)*(v.nz+2)+z;
     if(!chunks.has(key))chunks.set(key,new Map());chunks.get(key).set(offset,[offset,255,1]);removed++;
    }
   }
  }
  save.chunks=[...chunks].map(([key,edits])=>({key,edits:[...edits.values()]}));save.removedVolume=(save.removedVolume??0)+removed*v.nodeVolume;v.restore(save);return removed;
 }
 const snapshot=f=>({position:f.point.position.toArray(),boxPosition:f.point.boxGroup.position.toArray(),rotation:f.point.boxGroup.quaternion.toArray(),visible:f.point.boxGroup.visible,stage:f.point.stage,placement:JSON.stringify(f.point.boxGroup.userData.placement??null),minimumDepth:f.point.boxGroup.userData.minimumDepth,mass:f.mortar.field.mass,points:f.points.length,revision:f.system.fitRevision});
 function noMutation(f,label){const before=snapshot(f),assessment=f.system.assess(f.point,f.camera);assert.equal(assessment.fits,false,label);assert.deepEqual(snapshot(f),before,`${label}: assessment mutated game state`);if(!assessment.canPlace){assert.equal(f.system.place(f.point,f.camera).success,false,label);assert.deepEqual(snapshot(f),before,`${label}: refusal mutated pose/stage/inventory/mortar`);}else assert(assessment.proudDepthM>.0012,`${label}: partial seating must stay visibly proud`);return assessment;}
 for(const kinds of [['1G'],['2G','1G']]){
  const f=fixture(kinds);f.point.boxGroup.position.set(.01,.02,.03);f.point.boxGroup.rotation.z=.2;
  const intact=noMutation(f,'Intact wall cannot recess complete group');assert.equal(intact.reason,'masonry');assert(intact.blockedCells.length>100);assert(intact.blockedCells.every(c=>c.extraDepthM>.035));assert(intact.blockedCells.length<=4096);
  for(const phase of ['intact','damaged']){
   if(phase==='damaged')excavate(f.wall.volume,f.point.boxGroup.groupWidth+.04,.12,.06);
   for(let i=0;i<5;i++)f.system.assess(f.point,f.camera);
   const times=[];for(let i=0;i<10;i++){const start=performance.now();f.system.assess(f.point,f.camera);times.push(performance.now()-start);}
   const changed=[];for(let i=0;i<10;i++){const x=(i+1)*.00037;f.camera.position.x=x;f.camera.lookAt(x,1.2,f.front);f.camera.updateMatrixWorld(true);const start=performance.now();f.system.assess(f.point,f.camera);changed.push(performance.now()-start);}
   f.camera.position.x=0;f.camera.lookAt(0,1.2,f.front);f.camera.updateMatrixWorld(true);
   report.timing.push({kinds,phase,averageMs:times.reduce((a,b)=>a+b,0)/times.length,maxMs:Math.max(...times),newAimAverageMs:changed.reduce((a,b)=>a+b,0)/changed.length,newAimMaxMs:Math.max(...changed)});
  }
  const before=snapshot(f),fit=f.system.assess(f.point,f.camera);assert.equal(fit.fits,true,'Full cavity accepts full casing');assert.deepEqual(snapshot(f),before,'Successful preview remains read-only');assert.deepEqual(fit.required,{width:f.point.boxGroup.groupWidth,height:.074,depth:.037});assert.equal(fit.blockedCells.length,0);
  assert(f.system.place(f.point,f.camera).success);assert(f.point.boxGroup.visible);assert(f.point.boxGroup.position.z<=.00120001);assert.equal(f.point.stage,'fitted');
  const duplicate=f.add(),original=f.point;f.point=duplicate;const other=noMutation(f,'Existing casing rejects overlapping new group');assert.equal(other.reason,'other-box');assert(original.boxGroup.visible);f.point=original;
  const beforeFall=f.system.fitRevision;f.system.update(.05);assert.notEqual(f.system.fitRevision,beforeFall,'Moving boxes invalidate fit previews');
  report.checks.push(`${kinds.join('+')}: intact proud assessment, exact read-only preview, flush placement, casing overlap rejection, falling invalidation`);
 }
 {
  const f=fixture();excavate(f.wall.volume,.03,.13,.075);const narrow=noMutation(f,'Narrow deep slit cannot accept full group');assert(narrow.blockedCells.some(c=>Math.abs(c.x)>.04));
  excavate(f.wall.volume,.26,.12,.018);const shallow=noMutation(f,'Shallow broad recess cannot accept full depth');assert(shallow.blockedCells.some(c=>c.extraDepthM>.012));
  const before=f.system.fitRevision;excavate(f.wall.volume,.26,.12,.065);assert.notEqual(f.system.fitRevision,before);assert(f.system.assess(f.point,f.camera).fits);
  // The casing needs its rear footprint excavated. Its outward front rim may
  // overlap uncut wall outside the body rectangle without needing extra cuts.
  report.checks.push('narrow slit identifies lateral blockers; shallow recess identifies depth blockers; wall changes invalidate preview');
 }
 for(const cured of [false,true]){
  const f=fixture();excavate(f.wall.volume,.26,.12,.07);let added=0;
  for(const x of [-.08,0,.08])added+=f.mortar.field.add(new THREE.Vector3(x,1.2,f.front-.014),new THREE.Vector3(0,0,1),.8,()=>false);
  f.mortar.stuckMass+=added;if(cured)for(const node of f.mortar.field.nodes.values())node.age=4000;
  if(cured){const hard=noMutation(f,'Hard mortar limits insertion depth');assert.equal(hard.reason,'cured-mortar');assert(hard.blockedCells.some(c=>c.material==='cured-mortar'));}
  else{const mass=f.mortar.field.mass,before=snapshot(f);assert(f.system.assess(f.point,f.camera).fits,'Fresh paste yields inside full cavity');assert.deepEqual(snapshot(f),before);assert(f.system.place(f.point,f.camera).success);const p=f.point.boxGroup.userData.placement;assert(p.displacedKg>0);assert(Math.abs(p.displacedKg-p.repackedKg-p.looseKg)<1e-8);assert(Math.abs(f.mortar.field.mass+f.mortar.telemetry.movingKg+f.mortar.telemetry.floorKg+f.mortar.telemetry.restingKg-mass)<1e-6);}
 }
 report.checks.push('fresh mortar previews do not displace; accepted fresh bed conserves mass; cured mortar previews its proud stop without mutation');
 {
  const f=fixture();f.camera.position.z=f.front+3;f.camera.updateMatrixWorld(true);assert.equal(noMutation(f,'Unreachable wall').reason,'out-of-reach');
  const edge=GAME_CONFIG.room.width/2-.01;f.camera.position.set(edge,1.2,f.front+.42);f.camera.lookAt(edge,1.2,f.front);f.camera.updateMatrixWorld(true);assert.equal(noMutation(f,'Group crosses wall boundary').reason,'out-of-reach');
 }
 report.passed=true;console.log(JSON.stringify(report,null,2));
}finally{await writeFile('output/box-fit-preflight.json',JSON.stringify(report,null,2));await server.close();}
