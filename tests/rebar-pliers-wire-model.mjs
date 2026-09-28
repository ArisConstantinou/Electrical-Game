import assert from 'node:assert/strict';
import * as THREE from 'three';
import {buildRebarPliers,setRebarPliersClosed,buildRebarHug,setTieWireProgress,setTieWireTarget} from '../src/systems/RebarTyingModels.ts';
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const tool=buildRebarPliers(),size=new THREE.Box3().setFromObject(tool).getSize(V());
for(const [i,expected] of [.047,.250,.023].entries())assert(Math.abs(size.toArray()[i]-expected)<.00005);
const half=tool.getObjectByName('rebar-plier-moving-jaw'),handle=half.children.find(x=>/Red dipped/.test(x.name));
setRebarPliersClosed(tool,0);tool.updateMatrixWorld(true);const open=handle.localToWorld(V(0,-.14,0));
setRebarPliersClosed(tool,1);tool.updateMatrixWorld(true);assert(open.distanceTo(handle.localToWorld(V(0,-.14,0)))>.01);
const left=V(-.045,.22,-.027),right=V(.037,.19,-.046),wire=buildRebarHug(left,right,.07,-.012,.02);
const paths=wire.children.filter(o=>o.isMesh),ids=paths.map(o=>o.geometry.uuid);
function ring(mesh,index){const attribute=mesh.geometry.attributes.position,centre=V();for(let j=0;j<6;j++)centre.add(V().fromBufferAttribute(attribute,index*7+j));return centre.multiplyScalar(1/6);}
for(const progress of [0,.05,.2,.55,.85,1,0,1]){
 setTieWireProgress(wire,progress);wire.updateMatrixWorld(true);
 paths.forEach((mesh,i)=>{
  const position=mesh.geometry.attributes.position;
  assert(wire.localToWorld(ring(mesh,0)).distanceTo(i===0?left:right)<1e-7,'Actual wire vertices must stay at each separately drilled depth');
  for(let k=0;k<=48;k++){const centre=ring(mesh,k);for(let j=0;j<6;j++)assert(Math.abs(V().fromBufferAttribute(position,k*7+j).distanceTo(centre)-.0008)<1e-7,'Keep the 1.6 mm cross section throughout deformation');}
 });
 assert.deepEqual(wire.scale.toArray(),[1,1,1]);assert.deepEqual(paths.map(o=>o.geometry.uuid),ids);
}
setTieWireTarget(wire,.024,.041);wire.updateMatrixWorld(true);
paths.forEach((mesh,i)=>assert(wire.localToWorld(ring(mesh,0)).distanceTo(i===0?left:right)<1e-7));
console.log(JSON.stringify({passed:true,toolDimensionsM:size.toArray(),separateDepthAnchors:true,constantDiameter:true,stableBuffers:true,retargetedPipeEntry:true}));
