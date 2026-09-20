import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from '../tests/browser-safety.mjs';
import {build} from 'esbuild';
await build({stdin:{contents:"export * as T from 'three'; export {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js'; export {createWheelbarrow,createConcreteMixer} from './src/world/SiteEquipmentModels.ts';",resolveDir:process.cwd()},outfile:'output/site-equipment-export.js',bundle:true,format:'esm',platform:'browser'});
const output='assets/exports';await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage();await blockPointerLock(page.context());
 await page.goto('http://127.0.0.1:5365/Electrical-Game/');await page.waitForFunction(()=>window.__wireTheHouse);
 for(const kind of ['wheelbarrow','concrete-mixer']){
  const encoded=await page.evaluate(async kind=>{
   const models=await import('/Electrical-Game/output/site-equipment-export.js');
   const {T,GLTFExporter}=models;
   const root=kind==='wheelbarrow'?models.createWheelbarrow().group:models.createConcreteMixer();
   if(kind==='concrete-mixer')root.scale.x=-1;
   // Standard glTF meshes for DCC editing; no instancing extension required.
   const instances=[];root.traverse(o=>{if(o.isInstancedMesh)instances.push(o);});
   for(const inst of instances){const group=new T.Group();group.name=inst.name;group.position.copy(inst.position);group.quaternion.copy(inst.quaternion);group.scale.copy(inst.scale);inst.parent.add(group);for(let i=0;i<inst.count;i++){const m=new T.Mesh(inst.geometry,inst.material);m.name=`${inst.name}-${i+1}`;inst.getMatrixAt(i,m.matrix);m.matrix.decompose(m.position,m.quaternion,m.scale);group.add(m);}inst.removeFromParent();}
   const result=await new GLTFExporter().parseAsync(root,{binary:true});
   let binary='';for(const byte of new Uint8Array(result))binary+=String.fromCharCode(byte);return btoa(binary);
  },kind);
  const bytes=Buffer.from(encoded,'base64');await writeFile(`${output}/${kind}.glb`,bytes);console.log(`${kind}: ${bytes.length} bytes`);
 }
} finally {await browser.close();}
