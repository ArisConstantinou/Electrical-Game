import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom',logLevel:'error'});
try{
 const {buildRebarHug,setRebarDepth}=await server.ssrLoadModule('/src/systems/PvcSecuringModels.ts');
 const left=new THREE.Vector3(-.08642,.206,-2.486927),right=new THREE.Vector3(.02530,.140749,-2.471542),pipeX=-.0335;
 const group=buildRebarHug(left,right,-1.887,pipeX),mesh=group.getObjectByName('Open wall-anchored tying wire'),geometry=mesh.geometry,position=geometry.getAttribute('position');
 const path=geometry.parameters.path,initialBow=path.getPoint(.5).clone().add(group.position),samples=[];
 for(let frame=0;frame<=69;frame++){
  const depth=1-THREE.MathUtils.smoothstep(frame/69,0,1)*.9,start=performance.now();setRebarDepth(group,depth);samples.push(performance.now()-start);group.updateMatrixWorld(true);
  assert(mesh.localToWorld(path.getPoint(0)).distanceTo(left)<1e-8,'Left anchor must remain at its actual hole depth in every frame');
  assert(mesh.localToWorld(path.getPoint(1)).distanceTo(right)<1e-8,'Right anchor must remain at its different hole depth in every frame');
  const bow=mesh.localToWorld(path.getPoint(.5));assert(Math.abs(bow.x-pipeX)<1e-8);assert(Math.abs(bow.z-(group.position.z+(initialBow.z-group.position.z)*depth))<1e-8);
  assert.equal(mesh.geometry,geometry);assert.equal(geometry.getAttribute('position'),position,'Tightening must reuse the existing GPU geometry');
  assert(Array.from(position.array).every(Number.isFinite));
 }
 samples.sort((a,b)=>a-b);console.log(JSON.stringify({passed:true,frames:70,meanMs:samples.reduce((a,b)=>a+b)/70,p95Ms:samples[66],maxMs:samples[69]}));
 group.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();o.material.dispose();}});
}finally{await server.close();}
