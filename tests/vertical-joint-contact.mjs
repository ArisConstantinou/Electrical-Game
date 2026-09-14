import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createServer } from 'vite';
import * as THREE from 'three';

const out='output/vertical-joint-contact';
await mkdir(out,{recursive:true});
const server=await createServer({server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom',logLevel:'error'});
const report={fixture:'A saved shallow chase retains a recessed mortar joint. Actual FPSRig, stance, full-width blade rays and MasonryVolume impacts run unchanged; only starting camera and saved masonry are fixtures.',cases:[]};
const previous={window:globalThis.window,width:globalThis.innerWidth,height:globalThis.innerHeight};
globalThis.window={matchMedia:()=>({matches:false})};globalThis.innerWidth=390;globalThis.innerHeight=844;
function chase(volume,blockLip=false){
  const x=-volume.width/2+13*volume.width/21,y=10.5*volume.height/23,saved=volume.serialize(),chunks=new Map();
  for(let iy=1;iy<=volume.ny;iy++)for(let ix=1;ix<=volume.nx;ix++){
    const p=volume.nodePosition(ix,iy,1);
    if(Math.abs(p.x-x)>.13||Math.abs(p.y-y)>.06)continue;
    for(let iz=1;iz<=volume.nz;iz++){
      const material=volume.baseMaterial(ix,iy,iz),p=volume.nodePosition(ix,iy,iz),depth=volume.frontZ-p.z;
      if(!material||depth>(material===2?.032:.065))continue;
      if(blockLip&&p.x>x+.024&&p.x<x+.045&&depth<.016)continue;
      const tx=Math.floor(ix/volume.tileSize),ty=Math.floor(iy/volume.tileSize),key=`${tx},${ty}`;
      const offset=((iy-ty*volume.tileSize)*volume.tileSize+ix-tx*volume.tileSize)*(volume.nz+2)+iz;
      if(!chunks.has(key))chunks.set(key,[]);chunks.get(key).push([offset,255,1]);
    }
  }
  saved.chunks=[...chunks].map(([key,edits])=>({key,edits}));volume.restore(saved);return{x,y};
}
try{
  const {MasonryVolume,MaterialId}=await server.ssrLoadModule('/src/world/MasonryVolume.ts');
  const {FPSRig}=await server.ssrLoadModule('/src/player/FPSRig.ts');
  const {HammerWorkStance}=await server.ssrLoadModule('/src/player/HammerWorkStance.ts');
  const rigs=[['current',FPSRig]];
  if(process.argv.includes('--compare')){
    report.baselineRef='63e0753';
    const source=execFileSync('git',['show',`${report.baselineRef}:src/player/FPSRig.ts`],{encoding:'utf8'}).replaceAll("'./","'/src/player/").replaceAll("'../","'/src/");
    await writeFile(`${out}/FPSRig.baseline.ts`,source);
    rigs.unshift(['baseline',(await server.ssrLoadModule(`/${out}/FPSRig.baseline.ts`)).FPSRig]);
  }
  for(const[name,Rig]of rigs)for(const config of[
    ...[-45,-15,15,45].map(side=>({side,eyeX:.10,width:.05})),
    ...[-15,15].map(side=>({side,eyeX:-Math.sign(side)*.45,width:.05})),
    {side:-15,eyeX:.10,width:.025},
    {side:-45,eyeX:.10,width:.05,blockLip:true},
  ]){
    const volume=new MasonryVolume({seed:193187}),target=chase(volume,config.blockLip);
    const camera=new THREE.PerspectiveCamera(65,390/844,.01,100);
    camera.position.set(target.x+config.eyeX,target.y+.22,volume.frontZ+.82);
    camera.lookAt(target.x,target.y,volume.frontZ-.032);camera.updateMatrixWorld(true);
    const initialCamera=camera.matrixWorld.toArray();
    const visible=volume.raycast(camera.position,camera.getWorldDirection(new THREE.Vector3()),1.3);
    assert.equal(visible?.material,MaterialId.Mortar,'The fixture crosshair must actually see the recessed joint');
    const rig=new Rig();camera.add(rig);rig.show('hammer');rig.workPositionLocked=true;
    const stance=new HammerWorkStance(),wall={volume,chiselType:'flat',chiselTiltDegrees:15,chiselWidthM:config.width,chiselEdgeAngle:Math.PI/2,chiselEnergyJ:4};
    const record={name,...config,blows:[]};
    for(let blow=0;blow<(config.blockLip?1:8);blow++){
      let contact;
      for(let frame=0;frame<60;frame++){
        stance.update(camera,1/60,config.side,true,15);
        rig.workStanceSide=stance.sideDegrees/75;rig.workHeadLeanM=stance.headLeanM;rig.workStanceTiltDegrees=stance.actualTiltDegrees;
        rig.beginFrame(1/60);rig.update(1/60,false);contact=rig.contact(camera,wall);
      }
      const result=contact?volume.impact(contact):null;
      record.blows.push({valid:!!contact,material:result?.contact?.material,depthMm:result?.contact?(volume.frontZ-result.contact.point.z)*1000:null,mortarNodes:result?.removedByMaterial.mortar??0,removedNodes:result?.removedNodes??0});
      if(name==='current'){
        assert(contact&&result?.contact,`Physical contact stopped: ${JSON.stringify(config)} blow ${blow}, ${rig.contactStatus}`);
        assert.deepEqual(camera.matrixWorld.toArray(),initialCamera,'Joint targeting must not move or turn the camera');
        assert(contact.point.distanceTo(rig.chiselTipWorld.clone().addScaledVector(contact.edge,contact.bladeOffsetM??0))<1e-6,'Contact must be on the actual visible cutting edge');
        assert(Math.abs(result.removedVolume-result.fragments.reduce((sum,piece)=>sum+piece.volume,0))<1e-12,'Removed joint volume must become real conserved fragments');
        if(blow===0)assert.equal(result.contact.material,config.blockLip?MaterialId.Clay:MaterialId.Mortar,config.blockLip?'A nearer intact lip must block the shaft':'The angled blade must strike the joint under the crosshair');
        if(config.blockLip)assert(record.blows[0].depthMm<16,'The blade skipped its intervening front lip');
      }
    }
    record.mortarNodes=record.blows.reduce((sum,blow)=>sum+blow.mortarNodes,0);
    if(name==='current'&&!config.blockLip)assert(record.mortarNodes>=4,'Repeated real strikes must progressively remove the selected joint');
    report.cases.push(record);
  }
  report.passed=true;
  console.log(JSON.stringify({passed:true,cases:report.cases.map(c=>({name:c.name,side:c.side,eyeX:c.eyeX,width:c.width,blockLip:c.blockLip,firstMaterial:c.blows[0].material,mortarNodes:c.mortarNodes}))},null,2));
}finally{
  globalThis.window=previous.window;globalThis.innerWidth=previous.width;globalThis.innerHeight=previous.height;
  await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await server.close();
}
