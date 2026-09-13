import assert from 'node:assert/strict';
import { createServer } from 'vite';
import * as THREE from 'three';
const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'error'});
try{
 const {MortarSystem}=await server.ssrLoadModule('/src/systems/MortarSystem.ts');
 const wall={volume:{frontZ:-3,isOccupied:()=>false,raycast:()=>null}};
 const system=new MortarSystem(new THREE.Scene(),wall,[]);
 for(let i=0;i<12;i++)system.launch(new THREE.Vector3(i*.01,4,0),new THREE.Vector3(0,-.1,-3),.65);
 const geometries=[...new Set(system.projectiles.map(clod=>clod.mesh.geometry))];
 assert(geometries.length<system.projectiles.length,'Every scoop allocates its own vertex geometry');
 const snapshots=geometries.map(geometry=>({geometry,position:geometry.getAttribute('position'),array:geometry.getAttribute('position').array.slice(),version:geometry.getAttribute('position').version}));
 let disposedShared=0;
 for(const geometry of geometries){
  geometry.addEventListener('dispose',()=>disposedShared++);
  const p=geometry.getAttribute('position'),radii=[];
  for(let i=0;i<p.count;i++){radii.push(Math.hypot(p.getX(i),p.getY(i),p.getZ(i)));assert(Number.isFinite(p.getX(i)+p.getY(i)+p.getZ(i)));}
  assert(Math.max(...radii)-Math.min(...radii)>.35,'The flying scoop still has a regular rounded silhouette');
  assert(geometry.morphAttributes.position?.length,'Flight has no deformable paste skin');
  const colors=geometry.getAttribute('color');assert(colors&&colors.count===p.count);
  geometry.computeBoundingSphere();assert(geometry.boundingSphere.radius>0);
 }
 const before=system.projectiles[0].mesh.morphTargetInfluences[0];
 for(let i=0;i<20;i++)system.update(.01);
 assert(Math.abs(system.projectiles[0].mesh.morphTargetInfluences[0]-before)>.01,'Airborne mortar stays rigid');
 for(const saved of snapshots){assert.equal(saved.geometry.getAttribute('position'),saved.position);assert.equal(saved.position.version,saved.version,'Flight uploads a new vertex buffer every frame');assert.deepEqual(saved.position.array,saved.array,'One scoop mutates the shared geometry of another');}
 // A ledge creates its own clipped resting skin. Washing that skin must not
 // dispose the geometry still used by flying scoops or pooled floor splats.
 const resting=system.projectiles.shift();system.restOnLedge(resting,{point:new THREE.Vector3(0,1,0),normal:new THREE.Vector3(0,1,0),distance:0,box:false});
 assert(!geometries.includes(resting.mesh.geometry),'Resting clipping overwrites a shared airborne skin');
 const floor=system.projectiles.shift();system.settle(floor);assert(geometries.includes(floor.mesh.geometry));assert.equal(floor.mesh.morphTargetInfluences[0],0);
 system.applyWater(new THREE.Vector3(0,1,0),new THREE.Vector3(0,1,0),5);
 assert.equal(disposedShared,0,'Resting washout disposed a live shared flying/floor geometry');
 const t=system.telemetry,error=t.launchedKg-t.stuckKg-t.restingKg-t.floorKg-t.movingKg;
 assert(Math.abs(error)<1e-8,'Visual shape changed finite mortar mass');
 console.log(JSON.stringify({passed:true,sharedGeometries:geometries.length,launchedScoops:12,trianglesPerSkin:geometries[0].getAttribute('position').count/3,morphBefore:before,morphAfter:system.projectiles[0].mesh.morphTargetInfluences[0],sharedDisposals:disposedShared,massError:error}));
}finally{await server.close();}
