import assert from 'node:assert/strict';
import {createServer} from 'vite';
import * as THREE from 'three';
const server=await createServer({server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,entries:[]},appType:'custom',logLevel:'error'});
const report=[];
try{
 const {PlayerController}=await server.ssrLoadModule('/src/player/PlayerController.ts');
 for(const floor of [0,3.3,13.2,-6.8])for(const dt of [1/60,1/30,.05]){
  const input={pressed:()=>false,mobileMove:{x:0,y:0},mobileLook:{x:0,y:0},jumpRequested:false};
  const camera=new THREE.PerspectiveCamera(),player=new PlayerController(camera,input);player.setMansionPreview(true);
  camera.position.set(0,floor+1.65,2);player.setSurfaceProvider(()=>floor);player.setCeilingProvider(()=>floor+3.05);
  input.jumpRequested=true;let peak=0,launches=0,last=true;
  for(let i=0;i<Math.ceil(1.2/dt);i++){
   if(i===3)input.jumpRequested=true; // no double jump
   player.update(dt);peak=Math.max(peak,player.jumpOffset);if(last&&!player.grounded)launches++;last=player.grounded;
   assert(camera.position.y+.22<=floor+3.05);
  }
  assert(peak>.48&&peak<.52);assert.equal(launches,1);assert(player.grounded);assert(Math.abs(camera.position.y-floor-1.65)<1e-6);
  report.push({floor,dt,peak});
 }
 const input={pressed:()=>false,mobileMove:{x:0,y:0},mobileLook:{x:0,y:0},jumpRequested:true};
 const camera=new THREE.PerspectiveCamera(),player=new PlayerController(camera,input);camera.position.set(0,1.65,2);player.setCeilingProvider(()=>2.1);
 let maxHead=0;for(let i=0;i<90;i++){player.update(1/60);maxHead=Math.max(maxHead,camera.position.y+.22);}
 assert(maxHead<=2.100001);assert(player.grounded);
 console.log(JSON.stringify({passed:true,ballistic:report,lowCeilingMaxHead:maxHead}));
}finally{await server.close();}
