import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';

const directory='public/assets/tools/milwaukee-m18/';
const stats=[];
for(const name of ['m18_fid3','m18_fpd3','masonry_6mm','masonry_12mm','impact_ph2']){
 const bytes=await readFile(`${directory}${name}.glb`);assert.equal(bytes.readUInt32LE(0),0x46546c67);assert.equal(bytes.readUInt32LE(8),bytes.length);
 const jsonSize=bytes.readUInt32LE(12),j=JSON.parse(bytes.subarray(20,20+jsonSize)),bin=bytes.subarray(28+jsonSize);
 assert(j.buffers.every(b=>!b.uri));assert(j.images?.every(i=>i.bufferView!==undefined)??true);
 const array=index=>{const a=j.accessors[index],v=j.bufferViews[a.bufferView],size={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type],start=(v.byteOffset??0)+(a.byteOffset??0);assert.equal(a.componentType,5126);return Array.from({length:a.count},(_,i)=>Array.from({length:size},(_,c)=>bin.readFloatLE(start+i*(v.byteStride??size*4)+c*4)));};
 const bounds=new THREE.Box3(),head=new THREE.Box3();let triangles=0,draws=0;
 const visit=(index,parent)=>{
  const n=j.nodes[index],m=new THREE.Matrix4();if(n.matrix)m.fromArray(n.matrix);else m.compose(new THREE.Vector3().fromArray(n.translation??[0,0,0]),new THREE.Quaternion().fromArray(n.rotation??[0,0,0,1]),new THREE.Vector3().fromArray(n.scale??[1,1,1]));m.premultiply(parent);
  if(n.mesh!==undefined)for(const primitive of j.meshes[n.mesh].primitives){
   draws++;const positions=array(primitive.attributes.POSITION),normals=array(primitive.attributes.NORMAL);assert(positions.flat().every(Number.isFinite));assert(normals.every(v=>Math.abs(Math.hypot(...v)-1)<.015),'Unit mesh normals');
   triangles+=(primitive.indices!==undefined?j.accessors[primitive.indices].count:positions.length)/3;
   for(const p of positions){const v=new THREE.Vector3().fromArray(p).applyMatrix4(m);bounds.expandByPoint(v);if(v.y>.037)head.expandByPoint(v);}
  }
  for(const child of n.children??[])visit(child,m);
 };
 for(const node of j.scenes[j.scene??0].nodes)visit(node,new THREE.Matrix4());
 if(name.startsWith('m18_')){
  const drill=name.endsWith('fpd3'),expected=drill?.175:.113;assert(Math.abs(head.max.z-head.min.z-expected)<.001,`Verified head length excludes battery and bits: ${name} ${head.min.toArray()} to ${head.max.toArray()}`);
  assert(j.nodes.some(n=>n.name==='reference-motor-export'));assert(j.nodes.some(n=>n.name.startsWith('Index finger trigger')));assert(draws<15);
  const normalMaterial=j.materials.find(m=>m.name==='Black textured rubber overmould');assert(normalMaterial.normalTexture,'Rubber normal detail must survive glTF export');
 }else{
  const driver=name==='impact_ph2',width=bounds.max.x-bounds.min.x;
  if(driver){const transverse=[width,bounds.max.y-bounds.min.y].sort((a,b)=>a-b);assert(Math.abs(transverse[0]-.00635)<.0001&&transverse[1]>=.007&&transverse[1]<=.007334+.00001,`Quarter inch across flats and chamfered corners: ${transverse}`);}
  else assert(Math.abs(width-(name==='masonry_12mm'?.012:.006))<.0001,`${name} physical diameter ${width}`);
  assert(Math.abs(bounds.min.z+(driver?.070:.145))<.00001,'Actual metal tip matches the contact datum');
 }
 stats.push({name,bytes:bytes.length,triangles,draws,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()}});
}
console.log(JSON.stringify({passed:true,stats}));
