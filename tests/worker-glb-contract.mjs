import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';

const path='public/assets/worker/worker.glb',buffer=await readFile(path);
assert.equal(buffer.toString('utf8',0,4),'glTF','GLB magic');
assert.equal(buffer.readUInt32LE(4),2,'GLB version');
assert.equal(buffer.readUInt32LE(8),buffer.length,'GLB declared byte length');
let offset=12,json;
while(offset<buffer.length){const length=buffer.readUInt32LE(offset),type=buffer.readUInt32LE(offset+4),start=offset+8;if(type===0x4e4f534a)json=JSON.parse(buffer.toString('utf8',start,start+length).replace(/\0+$/,''));offset=start+length;}
assert(json,'GLB JSON chunk');
const directions=['Forward','ForwardLeft','Left','BackwardLeft','Backward','BackwardRight','Right','ForwardRight'];
const expected=new Set(['Walk','Jog','Crouch'].flatMap(mode=>directions.map(direction=>`Worker_${mode}${direction}`)));
const names=new Set((json.animations??[]).map(animation=>animation.name));
assert.deepEqual(names,expected,'exact 24 locomotion clip names');
assert.equal(json.skins?.length,1,'one worker skeleton');
assert.equal(json.skins[0].joints.length,52,'complete 52-joint rig');
assert.equal(json.meshes?.length,2,'consolidated body and head meshes');
for(const animation of json.animations){assert(animation.channels.length>=52,`${animation.name}: incomplete animated rig`);for(const channel of animation.channels)assert(Number.isInteger(channel.target.node)&&['translation','rotation','scale','weights'].includes(channel.target.path),`${animation.name}: invalid target`);}
const report={passed:true,path,bytes:buffer.length,animations:[...names].sort(),skins:json.skins.length,joints:json.skins[0].joints.length,meshes:json.meshes.length,extensionsUsed:json.extensionsUsed??[],extensionsRequired:json.extensionsRequired??[]};
await mkdir('output/full-body-locomotion',{recursive:true});await writeFile('output/full-body-locomotion/glb-contract.json',JSON.stringify(report,null,2));console.log(report);
