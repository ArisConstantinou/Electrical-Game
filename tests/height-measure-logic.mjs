import assert from 'node:assert/strict';
import {createServer} from 'vite';
import * as THREE from 'three';

const context={fillRect(){},save(){},restore(){},translate(){},rotate(){},fillText(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}};
globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>context})};
const server=await createServer({server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom',logLevel:'error'});
try{
  const {HeightMeasureSystem}=await server.ssrLoadModule('/src/systems/HeightMeasureSystem.ts');
  const {MasonryVolume}=await server.ssrLoadModule('/src/world/MasonryVolume.ts');
  const {queryWallWorkSurface}=await server.ssrLoadModule('/src/systems/WallWorkSurface.ts');
  const volume=new MasonryVolume({solidMaterial:1}),raycaster=new THREE.Raycaster();
  const wall={volume,aim(camera,max=2.35){camera.updateMatrixWorld(true);raycaster.setFromCamera(new THREE.Vector2(),camera);const hit=volume.raycast(raycaster.ray.origin,raycaster.ray.direction,max);return hit?{point:new THREE.Vector3(hit.point.x,hit.point.y,hit.point.z)}:null;}};
  const scene=new THREE.Scene(),system=new HeightMeasureSystem(scene,wall),camera=new THREE.PerspectiveCamera();
  const aim=(x,y,d=.6)=>{camera.position.set(x,y,volume.frontZ+d);camera.lookAt(x,y,volume.frontZ);camera.updateMatrixWorld(true);};
  const reachable=p=>p.distanceTo(camera.position)<.8;
  const before=JSON.stringify(volume.serialize());
  aim(0,1.20);system.update(camera,true,reachable);
  assert.equal(system.heightM,1.2);assert.equal(system.telemetry.mode,'ready');assert(system.target);assert.equal(system.target.y,1.2);
  const tape=system.root.children.find(child=>child.name.startsWith('Yellow'));
  const geometry=tape.geometry,texture=tape.material.map;
  assert(Math.abs(tape.position.y-tape.scale.y/2)<1e-9,'Zero always lies on floor');
  assert(Math.abs(tape.geometry.attributes.uv.getY(0)-1.2/volume.height)<1e-6,'Ruler is cropped at physical height');
  assert(system.mark());assert.equal(system.telemetry.count,1);assert.equal(system.telemetry.marks[0].heightM,1.2);
  assert(!system.mark(),'Holding mark does not create duplicate signs');
  system.update(camera,false,reachable);assert.equal(system.telemetry.mode,'hidden');assert(!system.root.visible);assert.equal(system.marksRoot.children.length,1);assert(system.marksRoot.visible);
  assert(!system.mark(),'Hidden tape cannot mark');
  aim(.2,1.204);system.update(camera,true,reachable);assert.equal(system.heightM,1.2);assert(system.mark());
  aim(.4,1.456);system.update(camera,true,reachable);assert.equal(system.heightM,1.46);assert(system.mark());
  assert.equal(tape.geometry,geometry);assert.equal(tape.material.map,texture,'Continuous aim never regenerates tape texture');
  aim(0,1.2,2);system.update(camera,true,reachable);assert.equal(system.telemetry.mode,'out-of-reach');assert.equal(system.target,null);assert(!system.mark());
  aim(0,4);system.update(camera,true,reachable);assert.equal(system.telemetry.mode,'no-wall');assert(!system.mark());
  for(let n=0;n<40;n++){aim(-1+n*.05,1.1);system.update(camera,true,reachable);system.mark();}
  assert.equal(system.telemetry.count,32,'Persistent mark resources are bounded');
  for(const mark of system.marksRoot.children){assert.equal(mark.children[0].material.depthTest,true,'Pencil marks obey occlusion');assert.equal(mark.children[0].material.depthWrite,false);}
  assert.equal(JSON.stringify(volume.serialize()),before,'Measuring and pencil marking never damage masonry');
  const sideWall=new THREE.Mesh(new THREE.PlaneGeometry(5,3),new THREE.MeshBasicMaterial());sideWall.position.set(-1.2,1.5,0);sideWall.rotation.y=Math.PI/2;scene.add(sideWall);
  const stableSystem=new HeightMeasureSystem(scene,wall,[sideWall]);
  camera.position.set(-.6,1.2,0);camera.lookAt(-1.2,1.2,0);camera.updateMatrixWorld(true);
  let reachNormal=null;stableSystem.update(camera,true,(point,normal)=>{reachNormal=normal.clone();return reachable(point);});
  assert.equal(stableSystem.telemetry.mode,'ready');assert.equal(stableSystem.targetStable,true);assert.equal(stableSystem.heightM,1.2);assert(reachNormal.distanceTo(new THREE.Vector3(1,0,0))<1e-6);
  const stableTape=stableSystem.root.children.find(child=>child.name.startsWith('Yellow'));
  stableSystem.root.updateMatrixWorld(true);
  const floorEnd=new THREE.Vector3(0,-.5,0).applyMatrix4(stableTape.matrixWorld),topEnd=new THREE.Vector3(0,.5,0).applyMatrix4(stableTape.matrixWorld);
  assert(Math.abs(floorEnd.y)<1e-9);assert(Math.abs(topEnd.y-1.2)<1e-9);assert(Math.abs(topEnd.x-floorEnd.x)<1e-9);assert(Math.abs(topEnd.z-floorEnd.z)<1e-9,'Side-wall tape stays vertically floor referenced');
  assert(stableSystem.mark());assert.equal(stableSystem.marks[0].stable,true);assert.equal(stableSystem.marks[0].heightM,1.2);assert(stableSystem.marks[0].normal.distanceTo(new THREE.Vector3(1,0,0))<1e-6);
  const markPosition=stableSystem.marks[0].point.toArray();stableSystem.marks[0].point.set(100,100,100);assert.deepEqual(stableSystem.marks[0].point.toArray(),markPosition,'Consumers cannot mutate reference marks');
  const saved=volume.serialize();volume.restore(saved);stableSystem.update(camera,false,reachable);assert.deepEqual(stableSystem.marks[0].point.toArray(),markPosition,'Concrete reference remains independent of masonry state and tool selection');
  const column=new THREE.Mesh(new THREE.BoxGeometry(.2,3,.3),new THREE.MeshBasicMaterial());column.position.set(0,1.5,volume.frontZ+.2);scene.add(column);aim(0,1.2);
  const closest=queryWallWorkSurface(camera,wall,[column]);assert(closest?.stable);assert(closest.point.z>volume.frontZ+.3,'Column intercepts the masonry behind it');
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(5,5),new THREE.MeshBasicMaterial());floor.rotation.x=-Math.PI/2;camera.position.set(0,1,0);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);assert.equal(queryWallWorkSurface(camera,wall,[floor]),null,'Horizontal surfaces are excluded');
  const cutSave=volume.serialize(),cutChunks=new Map();
  for(let x=1;x<=volume.nx;x++){
    if(Math.abs(volume.nodePosition(x,1,1).x)>.016)continue;
    for(let y=1;y<=volume.ny;y++){
      if(Math.abs(volume.nodePosition(x,y,1).y-1.2)>.016)continue;
      for(let z=1;z<=volume.nz;z++){
        if(volume.frontZ-volume.nodePosition(x,y,z).z>.04)continue;
        const tx=Math.floor(x/volume.tileSize),ty=Math.floor(y/volume.tileSize),key=`${tx},${ty}`;
        const index=((y-ty*volume.tileSize)*volume.tileSize+x-tx*volume.tileSize)*(volume.nz+2)+z;
        if(!cutChunks.has(key))cutChunks.set(key,[]);cutChunks.get(key).push([index,255,1]);
      }
    }
  }
  cutSave.chunks=[...cutChunks].map(([key,edits])=>({key,edits}));volume.restore(cutSave);
  await new Promise(resolve=>setTimeout(resolve,110));system.update(camera,false,reachable);stableSystem.update(camera,false,reachable);
  assert.equal(system.marksRoot.children[0].visible,false,'Destroyed masonry hides its unsupported pencil mark');assert(!system.marks.some(mark=>mark.id==='height-1'));
  assert.equal(stableSystem.marksRoot.children[0].visible,true);assert.deepEqual(stableSystem.marks[0].point.toArray(),markPosition,'Side-wall reference survives masonry demolition');
  console.log('Height measure logic passed: 1.20 m, floor origin, centimetre rounding, persistent marks, duplicate suppression, reach/bounds, bounded resources and unchanged wall.');
}finally{await server.close();delete globalThis.document;}
