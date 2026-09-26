import assert from 'node:assert/strict';
import * as THREE from 'three';
import {mapBuildingSurfaces} from '../src/world/BuildingSurfaceMapping.ts';
const root=new THREE.Group(),material=new THREE.MeshStandardMaterial();material.userData.constructionTileMeters=1.8;
const slab=new THREE.Mesh(new THREE.BoxGeometry(14,.22,2),material);slab.rotation.set(.37,.52,.1);root.add(slab);
const batch=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),material,3);
for(let i=0;i<3;i++)batch.setMatrixAt(i,new THREE.Matrix4().compose(new THREE.Vector3(i*4,2,0),new THREE.Quaternion().setFromEuler(new THREE.Euler(i*.3,0,i*.2)),new THREE.Vector3(i+1,.22,3+i)));
root.add(batch);
function check(){
 let triangles=0,maxError=0;
 for(const mesh of [slab,batch]){
  const p=mesh.geometry.attributes.position,uv=mesh.geometry.attributes.uv;
  const a=new THREE.Vector3(),b=a.clone(),c=a.clone();
  for(let i=0;i<p.count;i+=3){
   a.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);b.fromBufferAttribute(p,i+1).applyMatrix4(mesh.matrixWorld);c.fromBufferAttribute(p,i+2).applyMatrix4(mesh.matrixWorld);
   const area=b.sub(a).cross(c.sub(a)).length()/2;
   const ua=uv.getX(i),va=uv.getY(i),ub=uv.getX(i+1),vb=uv.getY(i+1),uc=uv.getX(i+2),vc=uv.getY(i+2);
   const mapped=Math.abs((ub-ua)*(vc-va)-(vb-va)*(uc-ua))/2*1.8**2;
   maxError=Math.max(maxError,Math.abs(mapped-area));triangles++;
  }
 }
 assert(maxError<.00004,`Surface density area error ${maxError}`);return {triangles,maxError};
}
mapBuildingSurfaces(root);const initial=check();assert.equal(batch.count,1);
slab.scale.set(2,.7,.6);batch.rotation.y=.8;mapBuildingSurfaces(root);const resized=check();
slab.geometry=new THREE.BoxGeometry(3,.2,12);mapBuildingSurfaces(root);const replaced=check();
assert.equal(mapBuildingSurfaces(root),0,'Unchanged scene should not remap');
console.log(JSON.stringify({initial,resized,replaced,passed:true}));
