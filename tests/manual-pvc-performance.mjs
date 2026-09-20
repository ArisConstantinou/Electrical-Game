import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
const browser=await chromium.launch({channel:'chrome',headless:true});const report=[];
try{
 for(const port of [5365,5367]){
  const context=await browser.newContext({viewport:{width:1366,height:768}});await blockPointerLock(context);
  const page=await context.newPage();await page.goto(`http://127.0.0.1:${port}/Electrical-Game/`);await page.locator('#start-button').click({timeout:120000});
  const profile=await page.evaluate(async()=>{
   const g=window.__wireTheHouse,c=g.renderer.camera,step=g.step.bind(g);g.step=()=>{};await g.workerBody.ready;
   c.position.set(.9,1.65,.75);c.lookAt(3.45,1.25,1.2);g.player.pitch=c.rotation.x;g.player.yaw=c.rotation.y;
   for(let i=0;i<40;i++)step(1/60,0,false);
   const phases=g.pvc?['stock','marking']:['stock'],result=[];
   for(const phase of phases){
    if(phase==='marking'){g.pvc.phase='marking';g.pvc.stock.layout(1);g.pvc.setFocus();for(let i=0;i<60;i++)step(1/60,0,false);}
    const samples=[];for(let i=0;i<120;i++){const start=performance.now();step(1/60,0,false);samples.push(performance.now()-start);}
    g.renderer.render();await g.renderer.waitForFrame();samples.sort((a,b)=>a-b);
    result.push({phase,simulationMeanMs:samples.reduce((a,b)=>a+b)/samples.length,simulationP95Ms:samples[114],simulationMaxMs:samples[119],calls:g.renderer.webgl.info.render.calls,triangles:g.renderer.webgl.info.render.triangles,geometries:g.renderer.webgl.info.memory.geometries,textures:g.renderer.webgl.info.memory.textures,jsHeap:performance.memory?.usedJSHeapSize??null});
   }return result;
  });report.push({port,profile});await context.close();
 }
}finally{await browser.close();}
await mkdir('output/manual-pvc',{recursive:true});await writeFile('output/manual-pvc/performance.json',JSON.stringify({environment:'Chrome headless on this Windows host, 1366x768. Simulation CPU samples, not GPU frame times or physical-phone FPS.',report},null,2));console.log(JSON.stringify(report));
