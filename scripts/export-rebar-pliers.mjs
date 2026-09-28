import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {buildRebarPliers,buildHeldRebar} from '../src/systems/RebarTyingModels.ts';

// Node 24 provides Blob and strips types; the exporter also uses FileReader.
globalThis.FileReader??=class {
 readAsArrayBuffer(blob){blob.arrayBuffer().then(result=>{this.result=result;this.onloadend?.();});}
 readAsDataURL(blob){blob.arrayBuffer().then(result=>{this.result=`data:${blob.type};base64,${Buffer.from(result).toString('base64')}`;this.onloadend?.();});}
};
const out=process.argv[2]??'artifacts/rebar-pliers-wire';await mkdir(out,{recursive:true});
const tool=buildRebarPliers(),times=[0,.3,.8,1.1],tracks=[];
for(const name of ['fixed-jaw','rebar-plier-moving-jaw']) {
 const half=tool.getObjectByName(name),sign=name==='fixed-jaw'?-1:1,values=[];
 for(const angle of [.085,0,0,.085])new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),sign*angle).toArray(values,values.length);
 tracks.push(new THREE.QuaternionKeyframeTrack(`${half.uuid}.quaternion`,times,values));
}
const animations=[new THREE.AnimationClip('Jaw open close — complete forged halves',1.1,tracks)];
const report={units:'metres',engine:'Three.js 0.185.1',files:[]};
for(const [file,model,clips] of [['rebar-pliers-250mm.glb',tool,animations],['tie-wire-1.6mm-held.glb',buildHeldRebar(),[]]]) {
 const buffer=await new GLTFExporter().parseAsync(model,{binary:true,animations:clips});
 await writeFile(`${out}/${file}`,Buffer.from(buffer));
 const imported=await new GLTFLoader().parseAsync(buffer,'');
 const size=new THREE.Box3().setFromObject(imported.scene).getSize(new THREE.Vector3());
 let triangles=0,meshes=0;imported.scene.traverse(object=>{if(object.isMesh){meshes++;triangles+=(object.geometry.index?.count??object.geometry.attributes.position.count)/3;}});
 if(file.startsWith('rebar')){
  assert(Math.abs(size.y-.250)<.00005,'Reimported tool must be 250 mm');assert.equal(imported.animations.length,1);
  const moving=imported.scene.getObjectByName('rebar-plier-moving-jaw');assert(moving?.children.some(o=>/handle/i.test(o.name)));
  const mixer=new THREE.AnimationMixer(imported.scene);mixer.clipAction(imported.animations[0]).play();
  mixer.setTime(0);const open=moving.quaternion.clone();mixer.setTime(.4);assert(open.angleTo(moving.quaternion)>.07,'Jaw clip must move the complete half');
 }
 report.files.push({file,bytes:buffer.byteLength,sizeM:size.toArray(),meshes,triangles,clips:imported.animations.map(c=>c.name)});
}
await writeFile(`${out}/export-validation.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
