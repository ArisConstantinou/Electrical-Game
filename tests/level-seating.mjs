import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import * as THREE from 'three';

await mkdir('output', { recursive: true });
await build({stdin:{contents:"export { BoxGroup } from './src/electrical/BoxGroup.ts'; export { InstallationPoint } from './src/electrical/InstallationPoint.ts'; export { LevelingSystem } from './src/systems/LevelingSystem.ts';",resolveDir:process.cwd()},outfile:'output/level-seating-modules.mjs',bundle:true,platform:'node',format:'esm',external:['three']});
const {BoxGroup,InstallationPoint,LevelingSystem}=await import('../output/level-seating-modules.mjs?'+Date.now());
const near=(a,b,message)=>assert(Math.abs(a-b)<1e-7,`${message}: ${a} != ${b}`);
const report=[];
for(const kinds of [['1G'],['2G'],['2G','1G'],['1G','2G','1G']]){
  const group=new BoxGroup(kinds,'seating:'+kinds.join('+'));
  const casingBounds=new THREE.Box3();for(const box of group.boxes)casingBounds.union(new THREE.Box3().setFromObject(box));
  group.levelBar.visible=true;group.updateMatrixWorld(true);
  const edges=[];group.levelBar.traverse(o=>{if(o.name==='Machined aluminium measuring edge')edges.push(o);});
  const edge=edges.map(o=>({object:o,bounds:new THREE.Box3().setFromObject(o)})).sort((a,b)=>a.bounds.min.y-b.bounds.min.y)[0];
  near(edge.bounds.min.y,casingBounds.max.y,'Actual measuring edge rests on actual top rim');
  near((edge.bounds.min.x+edge.bounds.max.x)/2,0,'Seated level is centred across the whole box group');
  assert(edge.bounds.min.x<casingBounds.min.x&&edge.bounds.max.x>casingBounds.max.x,'Measuring edge must span every casing');
  assert(edge.bounds.min.z>=0&&edge.bounds.min.z<.006,'Rear of level must stay outside wall and overlap front rim');
  assert(new THREE.Box3().setFromObject(group.levelBar).min.z>=0,'End caps must also remain outside wall face');
  assert(edge.bounds.max.z>.006,'Level front face must remain visible in front of casing');
  const bubble=group.levelBar.userData.bubble,neutral=bubble.position.clone(),vial=bubble.parent;
  const marks=vial.children.filter(o=>o.name==='Vial calibration line');
  const initialMarks=marks.map(m=>m.position.toArray());
  const contact=new THREE.Vector3(0,casingBounds.max.y,.003);
  const contactInEdge=edge.object.worldToLocal(contact.clone());
  edge.object.geometry.computeBoundingBox();near(contactInEdge.y,edge.object.geometry.boundingBox.min.y,'Rim contact lies on real lower rail geometry');
  for(const degrees of [-15,-3,-.75,0,.75,3,15]){
    group.rotation.z=THREE.MathUtils.degToRad(degrees);group.updateBubble();group.updateMatrixWorld(true);
    const contactWorld=group.localToWorld(contact.clone());
    near(edge.object.worldToLocal(contactWorld).y,edge.object.geometry.boundingBox.min.y,'Measuring edge remains seated when entire group rotates');
    near(bubble.position.x,neutral.x,'Bubble stays on vial axis');near(bubble.position.z,neutral.z,'Bubble depth stays fixed');
    assert(Math.abs(bubble.position.y-neutral.y)<=.009000001,'Bubble escaped finite vial');
    const bubbleInGroup=group.worldToLocal(bubble.getWorldPosition(new THREE.Vector3()));
    const centerInGroup=group.worldToLocal(vial.localToWorld(neutral.clone()));
    if(degrees)assert(Math.sign(bubbleInGroup.x-centerInGroup.x)===Math.sign(degrees),'Bubble must move toward the high end of tilted box');
    else assert.deepEqual(bubble.position.toArray(),neutral.toArray(),'Neutral bubble does not return exactly to centre');
    assert.deepEqual(marks.map(m=>m.position.toArray()),initialMarks,'Neutral calibration centre must not drift with bubble');
  }
  group.rotation.z=0;group.adjustTilt(1);near(group.tiltDegrees,.75,'Rotation keeps fine .75 degree increment');
  for(let i=0;i<100;i++)group.adjustTilt(1);near(group.tiltDegrees,15,'Clockwise angle is bounded');
  for(let i=0;i<100;i++)group.adjustTilt(-1);near(group.tiltDegrees,-15,'Counterclockwise angle is bounded');
  report.push({kinds,width:group.groupWidth,topRimY:casingBounds.max.y,edgeBottomY:edge.bounds.min.y,rimOverlapMm:(.006-edge.bounds.min.z)*1000});
}

const point=new InstallationPoint({id:'A',label:'Supported dry group',kind:'socket',boxes:['2G','1G'],x:0,bottom:1.2});
const level=new LevelingSystem();point.setStage('fitted');
assert.equal(level.begin(point),false,'A hidden inventory box cannot receive the level');
point.boxGroup.visible=true;
for(const state of ['proud','loose','floor']){
  point.boxGroup.userData.placement={state,secured:false};assert.equal(level.begin(point),false,`${state} box is not stable enough for leveling`);
  assert.equal(point.stage,'fitted');assert.equal(point.boxGroup.levelBar.visible,false);
}
point.boxGroup.userData.placement={state:'supported',secured:false};
assert.equal(level.begin(point),true,'Dry supported boxes can receive the level before mortar');
assert.equal(level.begin(point),true,'Repeated begin remains in same session');
assert.equal(level.adjust(point,'right'),true);near(point.boxGroup.tiltDegrees,.75,'Level arrows rotate real box');
assert.equal(level.confirm(point),false,'Dry alignment cannot complete mortar-dependent mission');
level.cancel(point);assert.equal(point.stage,'fitted','Cancel restores actual pre-level stage');assert.equal(point.boxGroup.levelBar.visible,false);
level.placementSystem={canAdjust:()=>true,constrainAdjustment:(p,position,tilt)=>{p.boxGroup.position.copy(position);p.boxGroup.rotation.z=tilt;return false;}};
assert(level.begin(point));const before=point.boxGroup.rotation.z;assert.equal(level.adjust(point,'right'),false);near(point.boxGroup.rotation.z,before,'Collision rejection restores box rotation');
level.cancel(point);
point.boxGroup.userData.placement={state:'bonded',secured:true};point.setStage('mortared');assert(level.begin(point));level.cancel(point);assert.equal(point.stage,'mortared');
point.boxGroup.rotation.z=0;point.boxGroup.position.z=0;assert(level.begin(point));assert.equal(level.confirm(point),true);assert.equal(point.stage,'leveled');
for(const stage of ['conduit','complete']){
  point.setStage(stage);point.pipeStep=stage==='complete'?'done':'install';
  const pipeStep=point.pipeStep,conduit=new THREE.Group();point.conduit=conduit;point.add(conduit);
  assert(level.begin(point));assert.equal(point.stage,'leveling');assert(level.confirm(point));
  assert.equal(point.stage,stage,'Passing a level recheck must preserve later installation progress');
  assert.equal(point.pipeStep,pipeStep);assert.equal(point.conduit,conduit,'Rechecking the level must preserve existing conduit');
  assert(level.begin(point));level.cancel(point);assert.equal(point.stage,stage,'Cancelling a recheck must preserve later progress');
  point.remove(conduit);
}
console.log(JSON.stringify({suite:'level-seating',passed:true,groups:report,supportedBeforeMortar:true,fallingRejected:true,priorStageRestored:true,advancedStageRecheckPreserved:true,collisionRollback:true,neutralCalibrationFixed:true}));
