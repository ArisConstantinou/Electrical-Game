import assert from 'node:assert/strict';
import {createServer} from 'vite';
import * as THREE from 'three';
import {readFile} from 'node:fs/promises';
const server=await createServer({plugins:process.env.QA_COMPARE_BEFORE==='1'?[{name:'protected-before',enforce:'pre',load:id=>id.replaceAll('\\','/').endsWith('/src/player/PlayerController.ts')?readFile('output/directional-jump/before-source/src/player/PlayerController.ts','utf8'):null}]:[],server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,entries:[]},appType:'custom',logLevel:'error'});
let cases=0;
try{
 const {PlayerController}=await server.ssrLoadModule('/src/player/PlayerController.ts');
 const dirs=[[0,1],[0,-1],[-1,0],[1,0],[-1,1],[1,1],[-1,-1],[1,-1]];
 for(const mobile of [false,true])for(const sprint of [false,true])for(const yaw of [0,.65,Math.PI/2])for(const floor of [0,3.3,-6.8])for(const [x,y] of dirs){
  const keys=new Set(sprint?['ShiftLeft']:[]);
  if(!mobile){if(x)keys.add(x>0?'KeyD':'KeyA');if(y)keys.add(y>0?'KeyW':'KeyS');}
  const input={pressed:k=>keys.has(k),mobileMove:mobile?{x,y:-y}:{x:0,y:0},mobileLook:{x:0,y:0},jumpRequested:false};
  const camera=new THREE.PerspectiveCamera(),p=new PlayerController(camera,input);p.setMansionPreview(true);p.setWallAssist(false);p.yaw=yaw;camera.position.set(20,floor+1.65,-12);p.setSurfaceProvider(()=>floor);p.setCeilingProvider(()=>floor+3.05);
  for(let i=0;i<6;i++)p.update(1/60);
  const v=p.velocity.clone(),start=camera.position.clone();input.jumpRequested=true;
  for(let i=0;i<10;i++)p.update(1/60);
  assert(!p.grounded&&p.jumpOffset>.2,'Moving jump must launch');assert(camera.position.clone().sub(start).dot(v)>.1);
  const release=camera.position.clone();keys.clear();input.mobileMove={x:0,y:0};
  for(let i=0;i<9;i++)p.update(1/60);
  assert(Math.abs(camera.position.x-release.x-v.x*.15)<1e-8);assert(Math.abs(camera.position.z-release.z-v.z*.15)<1e-8,'Airborne release must retain direction and speed');
  input.jumpRequested=true;let launches=0;
  for(let i=0;i<75;i++){const before=p.grounded;p.update(1/60);if(before&&!p.grounded)launches++;}
  assert.equal(launches,0,'No double jump');assert(p.grounded);assert.equal(p.velocity.length(),0,'Landing with no input stops walking');assert(Math.abs(camera.position.y-floor-1.65)<1e-7);cases++;
 }
 function fixture(){const input={pressed:()=>false,mobileMove:{x:0,y:0},mobileLook:{x:0,y:0},jumpRequested:true};const camera=new THREE.PerspectiveCamera(),p=new PlayerController(camera,input);p.setMansionPreview(true);camera.position.set(0,1.65,2);return {input,camera,p};}
 {const {p,camera}=fixture();for(let i=0;i<60;i++)p.update(1/60);assert.equal(camera.position.x,0);assert.equal(camera.position.z,2);assert(p.grounded);}
 {const {p,input,camera}=fixture();for(let i=0;i<10;i++)p.update(1/60);input.mobileMove={x:1,y:0};for(let i=0;i<8;i++)p.update(1/60);assert(camera.position.x>0,'An idle jump can steer sideways');}
 {const {p,input,camera}=fixture();input.mobileMove={x:1,y:0};for(let i=0;i<10;i++)p.update(1/60);const x=camera.position.x;p.setObstacleProvider(()=>[{id:'wall',minX:x+.3,maxX:x+.5,minZ:0,maxZ:4}]);input.mobileMove={x:0,y:0};for(let i=0;i<20;i++)p.update(1/60);assert(camera.position.x<=x+.021,'Air momentum cannot pass through walls');}
 {const {p,input,camera}=fixture();input.mobileMove={x:1,y:0};for(let i=0;i<10;i++)p.update(1/60);const x=camera.position.x;p.setSurfaceProvider(px=>px>x+.03?.3:0);for(let i=0;i<10;i++)p.update(1/60);assert(camera.position.x>x+.2,'Airborne feet must clear a 30 cm riser');}
 {const {p,input,camera}=fixture();input.mobileMove={x:1,y:0};for(let i=0;i<10;i++)p.update(1/60);const x=camera.position.x;p.setSurfaceProvider(px=>px>x+.03?2:0);for(let i=0;i<10;i++)p.update(1/60);assert(camera.position.x<=x+.03,'A ledge above the feet must block flight');}
 console.log(JSON.stringify({passed:true,directionalCases:cases,edgeCases:5}));
}finally{await server.close();}
