import {build} from 'esbuild';
import assert from 'node:assert/strict';
import * as THREE from 'three';

const compiled=await build({entryPoints:['src/systems/RoomWaterSystem.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {RoomWaterSystem}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const cases=[];
function measure(mesh){
 const matrix=new THREE.Matrix4(),scale=new THREE.Vector3();let diameter=0,length=0;
 for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,matrix);scale.setFromMatrixScale(matrix);diameter=Math.max(diameter,2*scale.x,2*scale.z);length=Math.max(length,2*scale.y);}
 assert(diameter<=.003601,`detached water diameter ${diameter} exceeds 3.6 mm`);
 assert(length<=.005761,`detached water length ${length} exceeds 5.76 mm`);
 return {count:mesh.count,diameterMm:diameter*1000,lengthMm:length*1000};
}
for(const litres of [.0001,.12/60,160/60,160]){
 const water=new RoomWaterSystem(new THREE.Scene(),{volume:{raycast:()=>null}});
 // Fill past the fixed particle budget to exercise volume merging too.
 for(let i=0;i<160;i++)water.addRunoff({point:new THREE.Vector3(0,2,-2),normal:new THREE.Vector3(0,0,1),litres,mortarKg:0});
 water.update(1/60);assert.equal(water.droplets.count,128);
 const visual=measure(water.droplets);assert(Math.abs(water.telemetry.airborneLitres-160*litres)<1e-7);
 for(let i=0;i<180;i++)water.update(1/60);
 assert.equal(water.droplets.count,0);assert(Math.abs(water.telemetry.floorLitres-160*litres)<1e-7);
 assert(Math.abs(water.telemetry.conservationErrorLitres)<1e-7);
 cases.push({litresPerBatch:litres,merged:true,...visual,conservationError:water.telemetry.conservationErrorLitres});
}
for(const flow of [.12,1,4,160]){
 const water=new RoomWaterSystem(new THREE.Scene(),{volume:{raycast:(origin,direction,length)=>{
  const distance=(-2-origin.z)/direction.z;
  return distance>=0&&distance<=length?{point:{x:origin.x+direction.x*distance,y:origin.y+direction.y*distance,z:-2},normal:{x:0,y:0,z:1}}:null;
 }}});
 water.setJetState({active:true,origin:new THREE.Vector3(0,1.5,-1.7),direction:new THREE.Vector3(0,0,-1),flowLitresPerSecond:flow,speedMps:18,spreadRadians:.1});
 water.update(.05);assert(water.sprayDrops.count>0);const visual=measure(water.sprayDrops);
 assert.equal(water.telemetry.receivedLitres,0,'visual splash creates no extra simulation water');
 cases.push({flow,...visual});
}
console.log(JSON.stringify({passed:true,cases}));
