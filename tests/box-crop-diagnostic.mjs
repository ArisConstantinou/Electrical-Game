import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
const out=process.argv[2]??'output/box-crop-diagnostic';await mkdir(out,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true}),report=[];
try{for(const [name,width,height]of [['desktop',1366,768],['portrait',390,844]]){
 const context=await browser.newContext({viewport:{width,height}});await blockPointerLock(context);const p=await context.newPage();await p.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');await p.locator('#start-button').click({timeout:120000});await p.keyboard.press('Digit5');
 await p.evaluate(async()=>{const g=window.__wireTheHouse;await g.renderer.waitForFrame();g.step=()=>{};});
 for(const depth of [false,true]){
  const data=await p.evaluate(async depth=>{const g=window.__wireTheHouse,r=g.renderer;await r.waitForFrame();for(const root of [g.fpsRig.fittingAssemblyRoot,g.fpsRig.fittingCandidateRoot])root.traverse(o=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material]){m.depthTest=depth;m.depthWrite=depth;m.needsUpdate=true;}});r.render();await r.waitForFrame();const bounds=[];for(const root of [g.fpsRig.fittingAssemblyRoot,g.fpsRig.fittingCandidateRoot]){const points=[];root.updateWorldMatrix(true,true);root.traverse(o=>{if(!o.isMesh)return;const a=o.geometry.attributes.position;for(let i=0;i<a.count;i++){const v=o.position.clone().set(a.getX(i),a.getY(i),a.getZ(i)).applyMatrix4(o.matrixWorld).project(r.renderCamera);points.push(v);}});bounds.push({name:root.name,minX:Math.min(...points.map(v=>v.x)),maxX:Math.max(...points.map(v=>v.x)),minY:Math.min(...points.map(v=>v.y)),maxY:Math.max(...points.map(v=>v.y))});}const frameMs=[];for(let i=0;i<40;i++){await new Promise(requestAnimationFrame);const start=performance.now();r.render();await r.waitForFrame();if(i>=10)frameMs.push(performance.now()-start);}frameMs.sort((a,b)=>a-b);return{bounds,renderSubmitMs:{median:frameMs[15],p95:frameMs[28],max:frameMs[29]},render:{...r.webgl.info.render}};},depth);
  await p.screenshot({path:`${out}/${name}-${depth?'depth-on':'before'}.png`});report.push({name,depth,...data});
 }await context.close();}
}finally{await browser.close();await writeFile(out+'/report.json',JSON.stringify(report,null,2));}console.log(report);
