import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'error'});
try{
 const {ChasingSystem}=await server.ssrLoadModule('/src/systems/ChasingSystem.ts');
 const front=-2.41,normal=new THREE.Vector3(0,0,-1),contact=new THREE.Vector3(0,1.2,front-.10);
 let backingBlows=0;
 const wall={contactProvider:()=>({point:contact,direction:normal,energyJ:4}),volume:{raycast:()=>({distance:.3})},isSolidAt:()=>false,processPendingSupport:()=>null,removeAtAim:()=>{backingBlows++;return null;}};
 const system=new ChasingSystem(new THREE.Scene(),wall),camera=new THREE.PerspectiveCamera();
 const geometry=new THREE.BoxGeometry(.12,.08,.012).toNonIndexed();
 const volume=.12*.08*.012;
 system.spawnDebris({seed:10,fragments:[{position:{x:0,y:1.2,z:front},size:{x:.12,y:.08,z:.012},volume,material:1,detached:true,positions:geometry.getAttribute('position').array}]});geometry.dispose();
 const parent=system.particles[0];parent.settled=true;parent.wallSupported=true;
 const result=system.freeHit(camera);
 assert(result,'Physical shaft must strike loose plate before the wall behind');
 assert.equal(backingBlows,0,'Loose plate cannot be intangible and let the blow drill backing');
 assert.equal(system.particles.length,2,'Large loose plate must fracture into smaller closed pieces');
 assert.equal(result.removedVolume,0,'Rebreaking debris cannot remove additional masonry');
 assert(Math.abs(system.totalEmittedVolume-volume)<1e-10);
 assert(Math.abs(system.activeFragmentVolume-volume)<1e-10);
 assert.equal(system.totalRetiredVolume,0);
 assert(system.particles.every(p=>!p.settled&&p.mesh.scale.equals(new THREE.Vector3(1,1,1))));
 for(let i=0;i<360;i++)system.update(1/60);
 assert.equal(system.settledFragmentCount,2);assert.equal(system.unsupportedSettledFragmentCount,0);
 assert(system.particles.every(p=>p.mesh.position.y<.10),'Rebroken pieces should reach floor');
 // Prevent rotation into a wall: the original update rotated after collision
 // resolution, so a long plate could penetrate solid and remain stuck forever.
 const blocker={...wall,isSolidAt:(_x,_y,z)=>z<front};
 const rotating=new ChasingSystem(new THREE.Scene(),blocker);
 const box=new THREE.BoxGeometry(.12,.08,.012).toNonIndexed();
 rotating.spawnDebris({seed:22,fragments:[{position:{x:0,y:1.2,z:front+.008},size:{x:.12,y:.08,z:.012},volume,material:1,detached:true,positions:box.getAttribute('position').array}]});box.dispose();
 const piece=rotating.particles[0];piece.velocity.set(0,0,0);piece.angularVelocity.set(0,12,0);
 assert.equal(rotating.overlapsWall(piece),false);
 for(let i=0;i<120;i++){rotating.update(1/60);assert.equal(rotating.overlapsWall(piece),false,'Rotation penetrated surviving masonry');}
 assert(piece.mesh.position.y<.1,'Unattached rotating plate should continue falling');
 // A real intervening shell shields debris deeper in the wall.
 const shielded=new ChasingSystem(new THREE.Scene(),{...wall,volume:{raycast:()=>({distance:.05})}});
 const shape=new THREE.BoxGeometry(.12,.08,.012).toNonIndexed();
 shielded.spawnDebris({seed:10,fragments:[{position:{x:0,y:1.2,z:front},size:{x:.12,y:.08,z:.012},volume,material:1,detached:true,positions:shape.getAttribute('position').array}]});shape.dispose();
  assert.equal(shielded.strikeDebris(camera),null,'Tool cannot reach loose clay through an intact shell');
 // A conservative geometry rejection must not turn loose material invulnerable.
 // Repeated physical blows pulverize it with the same material ledger.
 const crushed=new ChasingSystem(new THREE.Scene(),wall),solid=new THREE.BoxGeometry(.08,.05,.01).toNonIndexed(),smallVolume=.08*.05*.01;
 crushed.spawnDebris({seed:42,fragments:[{position:{x:0,y:1.2,z:front},size:{x:.08,y:.05,z:.01},volume:smallVolume,material:1,detached:true,positions:solid.getAttribute('position').array}]});solid.dispose();
 const jammed=crushed.particles[0];jammed.mesh.userData.splitUnsupported=true;jammed.mesh.userData.debrisHits=3;
 crushed.freeHit(camera);
 assert.equal(crushed.debrisCrushCount,1);assert(!crushed.particles.includes(jammed));
  assert(crushed.particles.every(p=>p.mesh.userData.crushed&&p.mesh.geometry.getAttribute('position').count===12),'Crushed fines are angular tetrahedra, not scaled copies of a large plate');
 for(const p of crushed.particles){const positions=p.mesh.geometry.getAttribute('position');let meshVolume=0;for(let i=0;i<positions.count;i+=3){const a=new THREE.Vector3().fromBufferAttribute(positions,i),b=new THREE.Vector3().fromBufferAttribute(positions,i+1),c=new THREE.Vector3().fromBufferAttribute(positions,i+2);meshVolume+=a.dot(b.cross(c))/6;}assert(Math.abs(Math.abs(meshVolume)-p.mesh.userData.volume)<p.mesh.userData.volume*1e-5,'Angular fines geometry matches its conserved material volume');}
 assert(Math.abs(crushed.totalEmittedVolume-smallVolume)<1e-10);assert(Math.abs(crushed.activeFragmentVolume-smallVolume)<1e-10);
 for(let i=0;i<360;i++)crushed.update(1/60);
 assert(Math.abs(crushed.totalEmittedVolume-crushed.totalRetiredVolume-crushed.activeFragmentVolume)<1e-10,'Crushing and fines retirement preserve all mass');
 console.log(JSON.stringify({passed:true,checks:['real shaft mesh hit','rebreak before backing','closed children fall','no extra material','collision-safe rotation','intact wall shielding']}));
}finally{await server.close();}
