import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom',logLevel:'error'});
try{
 const {PvcOffcuts}=await server.ssrLoadModule('/src/systems/PvcOffcuts.ts');
 const {PvcTube}=await server.ssrLoadModule('/src/systems/PvcModels.ts');
 const {PvcBend}=await server.ssrLoadModule('/src/systems/PvcBend.ts');
 for(const [from,to]of [[0,.35],[.35,.5],[.5,.7],[.7,1.08]]){
  const bend=new PvcBend(.9);bend.angles.fill(90/16);const tube=new PvcTube();tube.update(bend,from,to);
  tube.position.set(.4,bend.topHeight,-2.34);tube.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0,-1,0),new THREE.Vector3(0,0,1),new THREE.Vector3(-1,0,0)));tube.updateMatrixWorld(true);
  const geometry=tube.geometry,position=geometry.attributes.position,before=[0,position.count-1].map(i=>tube.localToWorld(new THREE.Vector3().fromBufferAttribute(position,i)));
  const motion=new PvcOffcuts();motion.release(tube);tube.updateMatrixWorld(true);
  for(const [j,i]of [0,position.count-1].entries())assert(before[j].distanceTo(tube.localToWorld(new THREE.Vector3().fromBufferAttribute(position,i)))<1e-6,'Rebasing the pivot must preserve the actual detached render vertices');
  for(let i=0;i<600;i++)motion.update(1/120);
  assert(motion.telemetry[0].settled);assert.equal(geometry,tube.geometry);assert(tube.position.toArray().every(Number.isFinite));
  let minimum=Infinity;for(let i=0;i<position.count;i++)minimum=Math.min(minimum,tube.localToWorld(new THREE.Vector3().fromBufferAttribute(position,i)).y);
  assert(minimum>=.00099&&minimum<.00101,'All actual hollow geometry must rest on the floor without penetration or levitation');
  const atRest=tube.position.clone();motion.update(.1);assert(atRest.equals(tube.position),'Sleeping floor geometry must stop moving');
 }
 console.log('PASS: actual offcut vertices retained at release; four straight/curved pieces fall, settle on the floor, keep geometry identity and sleep');
}finally{await server.close();}
