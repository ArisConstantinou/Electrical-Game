import assert from 'node:assert/strict';
import {createServer} from 'vite';
import * as THREE from 'three';
const server=await createServer({server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,entries:[]},appType:'custom',logLevel:'error'});
let cases=0;
try{
  const {PlayerController}=await server.ssrLoadModule('/src/player/PlayerController.ts');
  for(const wallYaw of [0,Math.PI/2,Math.PI,-Math.PI/2])for(const viewSide of [-55,0,55]){
    const normal=new THREE.Vector3(Math.sin(wallYaw),0,Math.cos(wallYaw)),tangent=new THREE.Vector3(0,1,0).cross(normal);
    const point=new THREE.Vector3(3,0,4),keys=new Set();
    const input={pressed:key=>keys.has(key),mobileMove:{x:0,y:0},mobileLook:{x:0,y:0}};
    const c=new THREE.PerspectiveCamera(),p=new PlayerController(c,input);c.rotation.order='YXZ';
    p.setMansionPreview(true);
    c.position.copy(point).addScaledVector(normal,.35);c.position.y=1.65;
    p.yaw=wallYaw+viewSide*Math.PI/180;p.pitch=-.15;c.rotation.set(p.pitch,p.yaw,0);
    p.wallWorkPlane={point,normal};p.wallWorkSnap=true;p.wallWorkEnabled=true;p.wallWorkDistance=.75;
    for(let i=0;i<90;i++)p.update(1/60);
    assert(p.workPosition.locked);assert(Math.abs(p.workPosition.distanceM-.75)<1e-9,'Selecting a nearby hammer must correct distance without W');
    const before=c.position.clone();p.wallToolTravelSpeedMps=.2;
    input.mobileMove.x=1;for(let i=0;i<60;i++)p.update(1/60);input.mobileMove.x=0;
    assert(c.position.distanceTo(before.clone().addScaledVector(tangent,.2))<1e-8,'Side joystick must follow actual wall tangent');
    p.wallWorkDistance=1.2;for(let i=0;i<30;i++)p.update(1/60);
    assert(Math.abs(p.workPosition.distanceM-.75)<1e-9,'Pose changes must not reposition a braced player');
    assert.equal(p.yaw,wallYaw+viewSide*Math.PI/180);assert.equal(p.pitch,-.15);
    keys.add('KeyS');for(let i=0;i<4;i++)p.update(1/60);keys.clear();
    for(let i=0;i<30;i++)p.update(1/60);assert(!p.workPosition.locked,'Backward release must persist after input ends');
    input.mobileMove.y=-1;for(let i=0;i<60;i++)p.update(1/60);input.mobileMove.y=0;
    assert(p.workPosition.locked,'Deliberate reapproach must reactivate snap');
    p.wallWorkSnap=false;p.wallWorkDistance=.46;for(let i=0;i<90;i++)p.update(1/60);
    assert(Math.abs(p.workPosition.distanceM-.46)<1e-9,'Switching to hand work must take up its shorter reach once');
    p.wallWorkEnabled=false;p.update(1/60);assert(!p.workPosition.locked,'Changing away from wall work must release');
    cases++;
  }
  console.log(JSON.stringify({pass:true,cases,checks:['nearby stationary snap','four facade orientations','oblique joystick feed','stable look and distance','backward release','reapproach','tool release']}));
}finally{await server.close();}
