import assert from 'node:assert/strict';
import {createServer} from 'vite';
import * as THREE from 'three';

const canvasContext={fillRect(){},save(){},restore(){},translate(){},rotate(){},fillText(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},fill(){},stroke(){}};
globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>canvasContext})};
const server=await createServer({server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom',logLevel:'error'});
try{
  const {HeightMeasureSystem}=await server.ssrLoadModule('/src/systems/HeightMeasureSystem.ts');
  const {LaserLevelSystem}=await server.ssrLoadModule('/src/systems/LaserLevelSystem.ts');
  const {MasonryVolume}=await server.ssrLoadModule('/src/world/MasonryVolume.ts');
  const volume=new MasonryVolume({solidMaterial:1}),raycaster=new THREE.Raycaster(),scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();
  const wall={volume,aim(camera,max=2.35){camera.updateMatrixWorld(true);raycaster.setFromCamera(new THREE.Vector2(),camera);const hit=volume.raycast(raycaster.ray.origin,raycaster.ray.direction,max);return hit?{point:new THREE.Vector3(hit.point.x,hit.point.y,hit.point.z)}:null;}};
  const back=new THREE.Mesh(new THREE.BoxGeometry(5,3,.1),new THREE.MeshBasicMaterial());back.position.set(0,1.5,2.5);
  const left=new THREE.Mesh(new THREE.BoxGeometry(.1,3,5),new THREE.MeshBasicMaterial());left.position.set(-2.5,1.5,0);scene.add(back,left);
  const stableWalls=[back,left],measure=new HeightMeasureSystem(scene,wall,stableWalls),laser=new LaserLevelSystem(scene,measure,wall,stableWalls);
  const aim=(point,normal,d=.55)=>{camera.position.copy(point).addScaledVector(normal,d);camera.lookAt(point);camera.updateMatrixWorld(true);};
  const reach=p=>p.distanceTo(camera.position)<.8;
  const ticks=(tool,held=false,n=1)=>{for(let i=0;i<n;i++)laser.update(camera,tool,held,1/60,reach);};
  const backPoint=new THREE.Vector3(0,1.2,2.45),backNormal=new THREE.Vector3(0,0,-1);
  const brickPoint=new THREE.Vector3(-.8,1.2,volume.frontZ),brickNormal=new THREE.Vector3(0,0,1);
  const addMark=(point,normal)=>{aim(point,normal);measure.update(camera,true,reach);assert.equal(measure.telemetry.mode,'ready');assert(measure.mark());return measure.marks.at(-1);};
  const pristine=volume.serialize();
  aim(backPoint,backNormal);ticks('laser');assert.equal(laser.telemetry.phase,'aim-mark');assert(!laser.action().success,'An unmarked wall cannot accept a reference laser');
  const reference=addMark(backPoint,backNormal);assert(reference.stable);assert.equal(reference.heightM,1.2);
  ticks('laser');assert(!laser.action().success,'Mark alone does not replace a drilled fixing');
  ticks('driver',true,90);assert(!laser.telemetry.mounted);assert(!laser.telemetry.active,'Driver cannot bypass drilling and hanging');
  ticks('drill',true,24);const partial=laser.telemetry.progress;assert(Math.abs(partial-.5)<1e-8);assert(laser.working);
  aim(backPoint,backNormal,2);ticks('drill',true,60);assert.equal(laser.telemetry.phase,'out-of-reach');assert.equal(laser.telemetry.progress,partial,'Out-of-reach drilling never advances');assert.equal(laser.target,null);assert(!laser.working);
  aim(backPoint.clone().add(new THREE.Vector3(.4,0,0)),backNormal);ticks('drill',true,60);assert.equal(laser.telemetry.phase,'aim-mark');assert.equal(laser.telemetry.fixings[0].progress,partial,'Looking away pauses the original fixing');
  aim(backPoint,backNormal);ticks('drill',false,60);assert.equal(laser.telemetry.progress,partial,'Releasing the trigger pauses drilling');ticks('drill',true,26);assert.equal(laser.telemetry.phase,'drilled');assert.equal(laser.telemetry.progress,1);
  const anchor=laser.root.getObjectByName(`Drilled fixing ${reference.id}`);assert(anchor?.visible);assert(anchor.children[1].visible,'Completed drill exposes the anchor ring');
  ticks('laser');assert.equal(laser.telemetry.phase,'mount-ready');assert(laser.action().success);assert(laser.telemetry.mounted);assert(!laser.telemetry.active);assert.equal(laser.activeHeightM,null);
  assert(laser.device.visible);assert(laser.mountedPoint.distanceTo(reference.point)<1e-10);
  assert(new THREE.Vector3(0,0,1).applyQuaternion(laser.device.quaternion).distanceTo(backNormal)<1e-10,'Installed model faces into the room');
  assert(new THREE.Vector3(0,1,0).applyQuaternion(laser.device.quaternion).distanceTo(new THREE.Vector3(0,1,0))<1e-10,'Mounted laser remains upright');
  ticks('driver',true,20);const partialDrive=laser.telemetry.progress;assert(partialDrive>0&&partialDrive<1);assert.equal(laser.telemetry.phase,'fastening');
  const fixingTip=reference.point.clone().addScaledVector(reference.normal,.013);assert(laser.target.distanceTo(fixingTip)<1e-10,'Driver reaches the exposed screw in the original drilled hole');
  ticks('driver',false,60);assert.equal(laser.telemetry.progress,partialDrive,'Release pauses tightening');assert(!laser.telemetry.active);
  aim(backPoint,backNormal,2);ticks('driver',true,60);assert.equal(laser.telemetry.progress,partialDrive,'Remote tightening is rejected');
  aim(backPoint,backNormal);ticks('driver',true,25);assert.equal(laser.telemetry.phase,'active');assert(laser.telemetry.active);assert.equal(laser.activeHeightM,1.2);
  const lockedPosition=laser.device.position.toArray();
  aim(backPoint.clone().add(new THREE.Vector3(.7,.3,0)),backNormal);ticks('laser');assert.equal(laser.telemetry.phase,'aim-mark');assert.equal(laser.activeHeightM,1.2,'Looking elsewhere never changes reference height');assert(!laser.action().success);
  const cutBacking=()=>{
    const save=volume.serialize(),chunks=new Map(save.chunks.map(c=>[c.key,new Map(c.edits.map(e=>[e[0],e]))]));
    for(let x=1;x<=volume.nx;x++){
      if(Math.abs(volume.nodePosition(x,1,1).x-brickPoint.x)>.03)continue;
      for(let y=1;y<=volume.ny;y++){
        if(Math.abs(volume.nodePosition(x,y,1).y-brickPoint.y)>.03)continue;
        for(let z=1;z<=volume.nz;z++){
          if(volume.frontZ-volume.nodePosition(x,y,z).z>.05)continue;
          const tx=Math.floor(x/volume.tileSize),ty=Math.floor(y/volume.tileSize),key=`${tx},${ty}`;
          const index=((y-ty*volume.tileSize)*volume.tileSize+x-tx*volume.tileSize)*(volume.nz+2)+z;
          if(!chunks.has(key))chunks.set(key,new Map());chunks.get(key).set(index,[index,255,1]);
        }
      }
    }
    save.chunks=[...chunks].map(([key,edits])=>({key,edits:[...edits.values()]}));volume.restore(save);
  };
  cutBacking();ticks('hammer',false,30);assert(laser.telemetry.active);assert.deepEqual(laser.device.position.toArray(),lockedPosition,'Demolishing brick does not move the opposite solid-wall reference');assert.equal(laser.activeHeightM,1.2);
  aim(backPoint,backNormal);ticks('laser');assert(laser.action().success);assert(!laser.telemetry.active);assert(!laser.telemetry.mounted);assert(!laser.device.visible);assert(anchor.visible,'Retrieval retains the existing drilled anchor');
  ticks('laser');assert(laser.action().success,'A prepared existing fixing can be reused');ticks('driver',true,45);assert(laser.telemetry.active);ticks('laser');assert(laser.action().success);
  volume.restore(pristine);
  const brickMark=addMark(brickPoint,brickNormal);assert.equal(brickMark.stable,false);
  ticks('drill',true,50);ticks('laser');assert(laser.action().success,'Brick marks are allowed, with their actual supporting surface');ticks('driver',true,45);assert(laser.telemetry.active);assert.equal(laser.activeHeightM,1.2);
  const beforeFall=laser.device.position.y;cutBacking();ticks('hammer',false,12);
  assert(!laser.telemetry.active);assert(!laser.telemetry.mounted);assert.equal(laser.activeHeightM,null);assert.equal(laser.mountedPoint,null);assert(laser.telemetry.fallen);assert(laser.device.position.y<beforeFall,'Unsupported laser visibly falls instead of floating');
  ticks('hammer',false,180);assert(Math.abs(new THREE.Box3().setFromObject(laser.device).min.y)<1e-8,'Actual dropped housing settles above the floor without clipping');assert(laser.device.visible);assert.equal(laser.telemetry.fixings.find(f=>f.id===brickMark.id).progress,0,'Destroyed backing invalidates its drilled anchor');
  const sideMark=addMark(new THREE.Vector3(-2.45,1.35,0),new THREE.Vector3(1,0,0));ticks('drill',true,50);ticks('laser');assert(laser.action().success,'A fallen unit can be remounted on a new prepared wall');ticks('driver',true,45);assert.equal(laser.activeHeightM,1.35);assert.equal(laser.telemetry.fallen,false);assert(laser.mountedPoint.distanceTo(sideMark.point)<1e-8);
  assert(laser.device.getObjectByName('Horizontal laser lens').material.emissiveIntensity>0);
  console.log('Laser reference logic passed: real marks and wall rays; drill/hang/fasten order; interruptions and reach; exact fixing and upright mounting; fixed height after unrelated demolition; retrieval; brick mounting and physical fall after backing loss; relocation to another wall.');
}finally{await server.close();delete globalThis.document;}
