import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {blockPointerLock} from './browser-safety.mjs';
const out='output/worker-tools';await mkdir(out,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true});const report={cases:[],errors:[]};
try{
 const context=await browser.newContext({viewport:{width:1440,height:810}});await blockPointerLock(context);const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 if(process.env.QA_DIST_ROOT){
  const root=path.resolve(process.env.QA_DIST_ROOT),worker=process.env.QA_WORKER_GLB&&path.resolve(process.env.QA_WORKER_GLB);
  await page.route('http://127.0.0.1:5365/Electrical-Game/**',async route=>{
   const relative=decodeURIComponent(new URL(route.request().url()).pathname).slice('/Electrical-Game/'.length)||'index.html';
   const file=relative==='assets/worker/worker.glb'&&worker?worker:path.resolve(root,relative);
   if(file!==worker&&!file.startsWith(root+path.sep))return route.abort();
   try{const body=await readFile(file),ext=path.extname(file).toLowerCase();
    await route.fulfill({status:200,body,contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.jpg':'image/jpeg','.png':'image/png','.glb':'model/gltf-binary','.gltf':'model/gltf+json','.bin':'application/octet-stream'})[ext]||'application/octet-stream'});
   }catch{await route.fulfill({status:404,body:`Missing isolated asset: ${relative}`});}
  });
 }
 await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');await page.waitForFunction(()=>window.__wireTheHouse?.workerBody.loaded,{},{timeout:90000});await page.locator('#start-button').click({timeout:90000});
 await page.waitForFunction(()=>window.__wireTheHouse?.started&&getComputedStyle(document.querySelector('#start-screen')).visibility==='hidden',null,{timeout:30000});
 await page.evaluate(()=>{const g=window.__wireTheHouse;g.__workerStep=g.step.bind(g);g.step=()=>{};g.input.locked=false;});
 const cases=[...['spray','hammer','fitting','level','spring','cutter','trowel','hose','measure','drill','driver','laser'].map(tool=>({tool,station:false})),...['water','trowel','shovel','mixer','hands'].map(tool=>({tool,station:true})),{tool:'spray',station:false}];
 for(const [i,entry]of cases.entries()){
  const data=await page.evaluate(async({tool,station})=>{
   const g=window.__wireTheHouse,c=g.renderer.camera,w=g.workerBody,m=g.mixing;
   g.player.crouched=false;g.player.yaw=0;g.player.pitch=-.85;g.player.velocity.set(0,0,0);c.position.set(-.5,1.65,-1.3);c.rotation.set(-.85,0,0);g.input.actionHeld=false;g.input.actionRequested=false;
   if(station){m.setActive(true);m.chooseTool(tool);}else{m.setActive(false);g.selectTool(tool);}
   for(let n=0;n<35;n++)g.__workerStep(1/60,0,false);
   const shown=o=>{for(let p=o;p;p=p.parent)if(!p.visible)return false;return true;};
   const legacy=[];
   for(const arms of [...g.fpsRig.armSets.values(),m.arms])for(const a of arms){
    for(const part of [a.upper,a.forearm])part.traverse(o=>{if(o.isMesh&&shown(o))legacy.push(o.name);});
    for(const child of a.hand.children)if(!child.userData.heldAccessory)child.traverse(o=>{if(o.isMesh&&shown(o))legacy.push(o.name);});
   }
   const bounds=[];w.traverse(o=>{if(o.isSkinnedMesh){o.skeleton.update();o.computeBoundingBox();const box=o.boundingBox.clone().applyMatrix4(o.matrixWorld);bounds.push({name:o.name,size:box.max.clone().sub(box.min).toArray()});}});
   g.renderer.render();await g.renderer.waitForFrame();return {tool,station,worker:w.telemetry,legacy,bounds,fpsVisible:g.fpsRig.visible,mixing:m.telemetry};
  },entry);
  report.cases.push(data);await page.screenshot({path:`${out}/${String(i).padStart(2,'0')}-${entry.station?'mix-':''}${entry.tool}.png`});
  assert(data.worker.visible,`${entry.tool}: worker must persist`);assert.deepEqual(data.legacy,[],`${entry.tool}: legacy skin/clothes reappeared`);
  assert(data.bounds.every(b=>b.size.every(Number.isFinite)&&Math.max(...b.size)<2.1),`${entry.tool}: invalid deformed mesh`);
 }
 assert.deepEqual(report.errors,[]);report.passed=true;
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
console.log({passed:report.passed,cases:report.cases.length});
