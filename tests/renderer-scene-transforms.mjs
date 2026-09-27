import assert from 'node:assert/strict';
import * as THREE from 'three';
import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';

await mkdir('output/scene-transform-test',{recursive:true});
let entry='src/core/Renderer.ts';
if(process.env.SCENE_TEST_BASE_REF){
 entry='src/core/.scene-transform-baseline.ts';
 await writeFile(entry,execFileSync('git',['show',`${process.env.SCENE_TEST_BASE_REF}:src/core/Renderer.ts`]));
}
try{
 await build({entryPoints:[entry],outfile:'output/scene-transform-test/renderer.mjs',bundle:true,format:'esm',platform:'node',external:['three','three/*']});
 const {Renderer}=await import('../output/scene-transform-test/renderer.mjs?'+Date.now());
 const scene=new THREE.Scene(),group=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());
 scene.add(group);group.add(mesh);let traversals=0;
 const update=scene.updateMatrixWorld.bind(scene);scene.updateMatrixWorld=(...args)=>{traversals++;return update(...args);};
 const renderer=Object.create(Renderer.prototype);const observed=[];
 Object.assign(renderer,{modelViewport:null,activeRenderCamera:new THREE.PerspectiveCamera(),gpu:{render(s,c){
  if(s.matrixWorldAutoUpdate)s.updateMatrixWorld();observed.push(mesh.matrixWorld.elements[12]);
  if(c===renderer.activeRenderCamera)this.render(s,new THREE.OrthographicCamera());
 }}});
 renderer.fenceSubmittedFrame=()=>{};
 group.position.x=3;renderer.drawScene(scene);
 assert.equal(traversals,1,'Colour and nested shadow must share one current scene transform traversal');
 assert.deepEqual(observed,[3,3]);assert.equal(scene.matrixWorldAutoUpdate,true);
 group.position.x=7;renderer.drawScene(scene);assert.equal(traversals,2);assert.deepEqual(observed.slice(2),[7,7],'The next frame must include moved parents');
 scene.matrixWorldAutoUpdate=false;renderer.drawScene(scene);assert.equal(traversals,2);assert.equal(scene.matrixWorldAutoUpdate,false,'Preserve explicitly managed scenes');
 scene.matrixWorldAutoUpdate=true;renderer.gpu.render=()=>{throw new Error('GPU encoder fixture');};
 assert.throws(()=>renderer.drawScene(scene),/GPU encoder fixture/);assert.equal(scene.matrixWorldAutoUpdate,true,'Restore automatic transforms even after a graphics failure');
 console.log('PASS: production renderer shares current transforms across colour/shadows, refreshes movement, preserves explicit scenes and restores state after errors.');
}finally{
 if(process.env.SCENE_TEST_BASE_REF){const {unlink}=await import('node:fs/promises');await unlink(entry);}
}
