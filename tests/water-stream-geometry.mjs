import assert from 'node:assert/strict';
import {build} from 'esbuild';
import * as THREE from 'three';
const compiled=await build({entryPoints:['src/systems/RoomWaterSystem.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {RoomWaterSystem}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const cases=[];
for(const flow of [4,160])for(const aim of [[0,0,-1],[.35,-.3,-1],[0,-1,.001]]){
 const water=new RoomWaterSystem(new THREE.Scene(),{volume:{raycast:()=>null}});
 const origin=new THREE.Vector3(0,1.5,0),direction=new THREE.Vector3(...aim).normalize();
 water.setJetState({active:true,origin,direction,flowLitresPerSecond:flow,speedMps:14,spreadRadians:.05});water.update(.05);
 const mesh=water.jetCore,g=mesh.geometry,positions=g.getAttribute('position'),indices=g.index.array,centres=[];
 for(let ring=0;ring<=water.streamSteps;ring++){
  const centre=new THREE.Vector3();for(let side=0;side<water.coreSides;side++)centre.add(new THREE.Vector3().fromBufferAttribute(positions,ring*water.coreSides+side));centres.push(centre.divideScalar(water.coreSides));
 }
 assert(centres[0].distanceTo(origin)<1e-6,'Water must start at the actual nozzle outlet');
 let minimum=1,triangles=0;
 for(let i=0;i<g.drawRange.count;i+=3){
  const ids=Array.from(indices.slice(i,i+3)),[a,b,c]=ids.map(id=>new THREE.Vector3().fromBufferAttribute(positions,id));
  const normal=b.clone().sub(a).cross(c.clone().sub(a)).normalize();
  const centre=ids.reduce((sum,id)=>sum.add(centres[Math.floor(id/water.coreSides)]),new THREE.Vector3()).divideScalar(3);
  const radial=a.clone().add(b).add(c).divideScalar(3).sub(centre).normalize(),dot=normal.dot(radial);
  assert(dot>.65,`Pressure column triangle faces inward: ${dot}`);minimum=Math.min(minimum,dot);triangles++;
 }
 assert(mesh.visible&&triangles>0);assert.equal(mesh.material.side,THREE.FrontSide);
 assert.equal(water.telemetry.receivedLitres,0,'Rendering creates no water');
 water.setJetState({...water.jetState,active:false});assert.equal(mesh.visible,false,'Releasing USE hides the stream immediately');
 cases.push({flow,aim,triangles,minimumOutwardDot:minimum});
}
console.log(JSON.stringify({passed:true,cases}));
