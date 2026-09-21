import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const buffer=await readFile('public/assets/worker/worker-apprentice-lod.glb');
assert.equal(buffer.toString('utf8',0,4),'glTF');
assert.equal(buffer.readUInt32LE(4),2);
assert.equal(buffer.readUInt32LE(8),buffer.length);
let json;
for(let offset=12;offset<buffer.length;){
  const length=buffer.readUInt32LE(offset),type=buffer.readUInt32LE(offset+4);
  if(type===0x4e4f534a)json=JSON.parse(buffer.toString('utf8',offset+8,offset+8+length));
  offset+=8+length;
}
assert(json,'GLB JSON chunk');
assert.equal(json.skins?.length,1,'one rig shared by all primitives');
assert.equal(json.skins[0].joints.length,52,'complete worker rig');
assert.equal(json.meshes?.length,2,'body and head meshes');
let triangles=0;
for(const mesh of json.meshes)for(const primitive of mesh.primitives){
  assert(Number.isInteger(primitive.attributes.JOINTS_0),'skinning joints retained');
  assert(Number.isInteger(primitive.attributes.WEIGHTS_0),'skinning weights retained');
  const count=json.accessors[primitive.indices].count;
  assert.equal(count%3,0,'triangle indices');
  triangles+=count/3;
}
assert(triangles>50000&&triangles<100000,`unexpected LOD geometry: ${triangles} triangles`);
assert.equal(json.animations?.length??0,0,'runtime-driven apprentice needs no embedded clips');
console.log({passed:true,bytes:buffer.length,triangles,primitives:json.meshes.flatMap(mesh=>mesh.primitives).length,joints:json.skins[0].joints.length});
