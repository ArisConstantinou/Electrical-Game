import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createServer } from 'vite';

const server=await createServer({server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom',logLevel:'error'});
const report=[];
try{
  const {MasonryVolume}=await server.ssrLoadModule('/src/world/MasonryVolume.ts');
  const {MortarSystem}=await server.ssrLoadModule('/src/systems/MortarSystem.ts');
  const {InstallationPoint}=await server.ssrLoadModule('/src/electrical/InstallationPoint.ts');
  const {BoxPlacementSystem}=await server.ssrLoadModule('/src/systems/BoxPlacementSystem.ts');
  // A completely excavated material volume isolates casing collisions. All
  // casings, insertion/gravity, mortar fields and floor contacts are production.
  const scene=new THREE.Scene(),points=[],wall={volume:new MasonryVolume({seed:193187,solidMaterial:0})};
  const mortar=new MortarSystem(scene,wall,points),placement=new BoxPlacementSystem(wall,mortar,points),camera=new THREE.PerspectiveCamera();
  let sequence=0;
  const create=(x,y,boxes=['1G'])=>{const point=new InstallationPoint({id:`test-${++sequence}`,label:'Collision specimen',kind:'socket',boxes,x,bottom:y-.037});points.push(point);scene.add(point);return point;};
  const aim=(x,y,z=wall.volume.frontZ+.4)=>{camera.position.set(x,y,z);camera.lookAt(x,y,wall.volume.frontZ);camera.updateMatrixWorld(true);};
  const put=(x,y,boxes)=>{const point=create(x,y,boxes);aim(x,y);assert.equal(placement.place(point,camera).success,true);return point;};
  const step=(seconds)=>{for(let elapsed=0;elapsed<seconds;elapsed+=.02)placement.update(.02);};
  const bounds=point=>{point.updateWorldMatrix(true,true);return new THREE.Box3().setFromObject(point.boxGroup.boxes[0]);};
  const state=point=>placement.telemetry.find(item=>item.id===point.definition.id);

  const lower=put(0,1);
  const duplicate=create(0,1);aim(0,1);
  assert.equal(placement.place(duplicate,camera).success,false,'Insertion must not put coincident casing panels inside an existing box');
  assert.equal(duplicate.boxGroup.visible,false,'Rejected placement must remain in inventory');
  assert.equal(state(duplicate).state,'held');
  const neighboring=put(.09,1);
  assert.equal(points.length,3,'Live shared points array supports independent added groups');
  assert(bounds(lower).max.x<bounds(neighboring).min.x,'A real narrow gap between adjacent rims must remain placeable');
  aim(0,1);assert.equal(placement.target(camera),lower,'Nearest actual back/rim ray selects its own placed box');
  report.push('independent live points; exact duplicate rejected; adjacent casings accepted; real target selection');

  step(1.2);
  assert.equal(state(lower).state,'floor');assert.equal(state(neighboring).state,'floor');
  const upper=put(0,1.3),upperNeighbor=put(.09,1.3);step(1.3);
  assert.equal(state(upper).state,'supported');assert.equal(state(upper).contactMaterial,'box');
  assert.equal(state(upperNeighbor).state,'supported');
  assert(bounds(upper).min.y>=bounds(lower).max.y+.0009,'Swept gravity stops above another casing without interpenetrating its rim');
  assert.equal(placement.canAdjust(upper),true,'A box resting on a casing is physically supported');
  upper.setStage('leveling');upper.boxGroup.levelBar.visible=true;step(.3);
  assert.equal(upper.stage,'leveling','Unbonded supported box may retain a live spirit level');
  report.push('gravity stacks on actual casing; clearance preserved; unbonded stable level remains active');

  let old=upper.boxGroup.position.clone(),tilt=upper.boxGroup.rotation.z;
  upper.boxGroup.rotation.z=.22;
  assert.equal(placement.constrainAdjustment(upper,old,tilt),false,'Tilting into adjacent/supporting panels must fail');
  assert.equal(upper.boxGroup.rotation.z,tilt,'Rejected tilt restores previous rotation');
  assert.deepEqual(upper.boxGroup.position.toArray(),old.toArray(),'Rejected tilt restores previous translation');
  // Place another casing behind the upper one, with separated Z extents. A
  // direct outward-to-inward depth motion must sweep, not jump through it.
  upper.boxGroup.position.z=.16;
  const rear=create(0,1);rear.boxGroup.visible=true;rear.position.copy(upper.position);rear.boxGroup.position.copy(upper.boxGroup.position);rear.boxGroup.position.z=.08;rear.updateWorldMatrix(true,true);
  old=upper.boxGroup.position.clone();tilt=upper.boxGroup.rotation.z;upper.boxGroup.position.z=0;
  assert.equal(placement.constrainAdjustment(upper,old,tilt),false,'Depth adjustment cannot tunnel through a different box');
  assert.deepEqual(upper.boxGroup.position.toArray(),old.toArray());
  rear.boxGroup.visible=false;
  upper.boxGroup.position.z=0;
  old=upper.boxGroup.position.clone();upper.boxGroup.position.z+=.002;
  assert.equal(placement.constrainAdjustment(upper,old,tilt),false,'Outward depth adjustment stops at the bare-wall finish plane');
  assert.deepEqual(upper.boxGroup.position.toArray(),old.toArray());
  upper.boxGroup.position.z-=.002;
  assert.equal(placement.constrainAdjustment(upper,old,tilt),true,'Clear inward depth adjustment succeeds until the physical back-stop');
  report.push('tilt rollback; swept depth rejects tunnelling; finish plane blocks outward travel while inward travel succeeds');

  placement.retrieve(lower);step(1);
  assert.equal(state(upper).state,'floor','Removing the supporting box makes its upper box fall');
  assert.equal(upper.boxGroup.levelBar.visible,false,'An unsupported/fallen box drops its level');
  assert.equal(state(upperNeighbor).state,'supported','Retrieving one stack must leave the neighboring stack intact');
  placement.retrieve(upperNeighbor);placement.retrieve(neighboring);

  const pivotBase=put(1,1,['2G','1G']);step(1.2);
  const pivotBox=put(1,1.3,['2G','1G']);step(1.3);
  assert.equal(state(pivotBox).contactMaterial,'box');
  const groupBottom=point=>{point.updateWorldMatrix(true,true);return Math.min(...point.boxGroup.boxes.map(box=>new THREE.Box3().setFromObject(box).min.y));};
  const supportBottom=groupBottom(pivotBox),initialPosition=pivotBox.boxGroup.position.clone();
  pivotBox.setStage('leveling');pivotBox.boxGroup.levelBar.visible=true;
  for(const direction of [1,1,1,1,-1,-1,-1,-1]){
    const previous=pivotBox.boxGroup.position.clone(),previousTilt=pivotBox.boxGroup.rotation.z;
    pivotBox.boxGroup.adjustTilt(direction);
    assert.equal(placement.constrainAdjustment(pivotBox,previous,previousTilt),true,'A wide dry supported group must rotate on its ledge');
    assert(Math.abs(groupBottom(pivotBox)-supportBottom)<1e-8,'Tilt must preserve the actual casing support height');
    step(.16);assert.equal(state(pivotBox).state,'supported');assert.equal(pivotBox.stage,'leveling');
    assert(Math.abs(groupBottom(pivotBox)-supportBottom)<.00015,'The rotated box must retain its support after gravity checks');
  }
  assert(Math.abs(pivotBox.boxGroup.rotation.z)<1e-10);
  assert(pivotBox.boxGroup.position.distanceTo(initialPosition)<.00015,'Reversing the correction returns the supported group without accumulated lift');
  // Bond classification is authored only to isolate its pivot contract; this
  // does not claim that the empty mortar fixture forms a physical bond.
  const bonded=pivotBox.boxGroup.userData.placement;bonded.state='bonded';bonded.secured=true;bonded.contactMaterial='mortar';
  const bondedPosition=pivotBox.boxGroup.position.clone();pivotBox.boxGroup.rotation.z=.002;
  assert.equal(placement.constrainAdjustment(pivotBox,bondedPosition,0),true);
  assert.deepEqual(pivotBox.boxGroup.position.toArray(),bondedPosition.toArray(),'Bonded groups retain their existing centre pivot');
  placement.retrieve(pivotBox);placement.retrieve(pivotBase);
  report.push('wide dry group rotates and reverses on real casing support; no cumulative lift; bonded centre pivot unchanged');

  let calls=0;const raycast=mortar.field.raycast.bind(mortar.field);mortar.field.raycast=(...args)=>{calls++;return raycast(...args);};
  step(1);assert.equal(calls,0,'Idle floor boxes must not rescan mortar and gravity every frame');
  report.push('independent retrieval; removal invalidates upper support; idle floor boxes require no field rays');
  console.log(JSON.stringify({passed:true,checks:report},null,2));
}finally{await server.close();}
