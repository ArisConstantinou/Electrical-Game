import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createServer } from 'vite';

const server=await createServer({server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom',logLevel:'error'});
try{
  const {MasonryVolume}=await server.ssrLoadModule('/src/world/MasonryVolume.ts');
  const {MortarSystem}=await server.ssrLoadModule('/src/systems/MortarSystem.ts');
  const {InstallationPoint}=await server.ssrLoadModule('/src/electrical/InstallationPoint.ts');
  const {BoxPlacementSystem}=await server.ssrLoadModule('/src/systems/BoxPlacementSystem.ts');
  const scene=new THREE.Scene(),points=[],wall={volume:new MasonryVolume({seed:92026,solidMaterial:0})};
  const mortar=new MortarSystem(scene,wall,points),placement=new BoxPlacementSystem(wall,mortar,points);
  const point=new InstallationPoint({id:'finish-plane',label:'Finish plane fixture',kind:'socket',boxes:['1G'],x:0,bottom:1.163});points.push(point);scene.add(point);
  const front=wall.volume.frontZ;
  for(const [x,y] of [[-.045,1.2],[.045,1.2],[0,1.155],[0,1.245]]){
    const accepted=mortar.field.add(new THREE.Vector3(x,y,front+.009),new THREE.Vector3(0,0,1),.24,()=>false);mortar.stuckMass+=accepted;
  }
  const camera=new THREE.PerspectiveCamera();camera.position.set(0,1.2,front+.46);camera.lookAt(0,1.2,front);camera.updateMatrixWorld(true);
  const fit=placement.assess(point,camera);assert(fit.canPlace);assert(fit.seatDepthM>.002&&fit.seatDepthM<=.04,`mortar finish was ${fit.seatDepthM}`);assert(fit.backstopDepthM<fit.seatDepthM);
  assert(placement.place(point,camera).success);assert(Math.abs(point.boxGroup.position.z-fit.seatDepthM)<1e-8);
  point.boxGroup.userData.placement.state='bonded';point.boxGroup.userData.placement.secured=true;
  let previous=point.boxGroup.position.clone();point.boxGroup.position.z+=.002;assert.equal(placement.constrainAdjustment(point,previous,0),false,'box cannot move beyond mortar finish');
  previous=point.boxGroup.position.clone();point.boxGroup.position.z-=.002;assert.equal(placement.constrainAdjustment(point,previous,0),true,'box can move inward from mortar finish');
  console.log(JSON.stringify({passed:true,finishDepthMm:fit.seatDepthM*1000,backstopDepthMm:fit.backstopDepthM*1000,inwardDepthMm:point.boxGroup.position.z*1000}));
}finally{await server.close();}
