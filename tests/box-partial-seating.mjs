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
 let id=0;
 function fixture(kinds=['2G','1G'],options={}){
  const points=[],scene=new THREE.Scene(),wall={volume:new MasonryVolume({seed:190319,solidMaterial:1,...options})};
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

 const pose=f=>({point:f.point.position.toArray(),box:f.point.boxGroup.position.toArray(),visible:f.point.boxGroup.visible,stage:f.point.stage,mass:f.mortar.field.mass});
 for(const kinds of [['1G'],['2G','1G']])for(const bed of ['dry','fresh','cured']){
  const f=fixture(kinds,{cellSize:.01,depth:.16});excavate(f.wall.volume,.3,.15,.011);
  if(bed!=='dry'){
   for(const x of [-.08,0,.08])f.mortar.stuckMass+=f.mortar.field.add(new THREE.Vector3(x,1.2,f.front+.002),new THREE.Vector3(0,0,1),.4,()=>false);
   if(bed==='cured')for(const node of f.mortar.field.nodes.values())node.age=4000;
  }
  const before=pose(f),a=f.system.assess(f.point,f.camera);assert.deepEqual(pose(f),before,'Preview does not change pose, stage, or mortar');
  assert.equal(a.fits,false);assert.equal(a.canPlace,false);assert(a.proudDepthM>.0012,'Casing protrudes beyond the local finish plane');assert(a.blockedCells.length);
  if(bed==='dry')assert(Math.abs(a.proudDepthM-.0282)<.00005,'10 mm cavity stops 37 mm casing 27 mm proud plus collision clearance');
  const mass=f.mortar.field.mass,result=f.system.place(f.point,f.camera);assert.equal(result.success,false);assert.match(result.message,/protrude/);assert.deepEqual(pose(f),before,'Refused proud placement preserves box pose, stage and mortar');assert.equal(f.mortar.field.mass,mass,'Refused placement conserves mortar mass');
  report.checks.push({kinds,bed,cavityMm:10,blockedProtrusionMm:a.proudDepthM*1000,reason:a.reason,proudPlacementRefused:true});
 }
 {
  const f=fixture();f.mortar.stuckMass+=f.mortar.field.add(new THREE.Vector3(0,1.2,f.front+.008),new THREE.Vector3(0,0,1),1,()=>false);
  const before=pose(f),a=f.system.assess(f.point,f.camera);assert(!a.canPlace&&!a.fits);assert(a.proudDepthM>.0012,'Mortar on untouched brick does not create a cavity');assert.equal(f.system.place(f.point,f.camera).success,false);assert.deepEqual(pose(f),before);report.checks.push({untouchedWallWithFreshMortar:true,blockedProtrusionMm:a.proudDepthM*1000});
 }
 {
  const f=fixture();excavate(f.wall.volume,.3,.15,.07);const a=f.system.assess(f.point,f.camera);assert(a.canPlace&&a.fits);assert(f.system.place(f.point,f.camera).success);assert(f.point.boxGroup.position.z<=.0012);report.checks.push('Deep cavity still places flush');
 }
 {
  const f=fixture(),fixed=f.add();fixed.position.set(0,1.2,f.front-.014);fixed.boxGroup.position.set(0,0,0);fixed.boxGroup.visible=true;fixed.updateWorldMatrix(true,true);
  const a=f.system.assess(f.point,f.camera);assert(!a.canPlace&&!a.fits&&a.reason!=='other-box','An older casing behind the actual masonry stop is not on the insertion path');
  fixed.position.z=f.front+.05;fixed.updateWorldMatrix(true,true);const b=f.system.assess(f.point,f.camera);assert(!b.canPlace);assert.equal(b.reason,'other-box');assert.equal(f.system.place(f.point,f.camera).success,false);report.checks.push('Casing sweep uses physical proud endpoint and still rejects actual overlap');
 }
 report.passed=true;console.log(JSON.stringify(report,null,2));
}finally{await writeFile('output/box-partial-seating.json',JSON.stringify(report,null,2));await server.close();}
