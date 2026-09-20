import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const out=process.argv[2]??'output/mobile-render-performance';await mkdir(out,{recursive:true});
const report={method:'Headless Chrome, mobile 390x844 DPR3 emulation, rotating accepted view; isolated render through backend completion fence with simulation paused. Does not represent physical iPhone FPS.',cases:[],errors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const backend of ['webgpu','webgl']){
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true});await blockPointerLock(context);
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(`http://127.0.0.1:5365/Electrical-Game/${backend==='webgl'?'?renderer=webgl':''}`);
  await page.waitForFunction(()=>window.__wireTheHouse?.roomWater.waterProActive,undefined,{timeout:120000});
  await page.locator('#start-button').tap();
  await page.evaluate(async()=>{const g=window.__wireTheHouse;g.step=()=>{};await g.renderer.waitForFrame();});
  for(const stage of ['dry-unconditional-water','dry','wet','drained']){
   const result=await page.evaluate(async({backend,stage})=>{
    const g=window.__wireTheHouse,r=g.renderer,b=r.webgl.backend;
    const fence=async()=>{if(b.device)await b.device.queue.onSubmittedWorkDone();else b.gl.finish();};
    if(stage==='wet'){g.roomWater.addFloorWater(0,0,12);for(let i=0;i<120;i++)g.roomWater.update(1/30);}
    if(stage==='drained'){g.roomWater.field.depths.fill(0);g.roomWater.rebuildGeometry();}
    const values=[],calls=[],triangles=[];let index=0;
    let waterUpdates=0;const update=r.water.update.bind(r.water);r.water.update=(...args)=>{waterUpdates++;return update(...args);};
    const frame=async()=>{if(stage==='dry-unconditional-water')r.waterWasVisible=true;r.eyeYaw=Math.sin(index++*.04)*.3;const t=performance.now();r.render();await r.waitForFrame();await fence();return performance.now()-t;};
    for(let i=0;i<20;i++)await frame();
    for(let i=0;i<90;i++){await new Promise(requestAnimationFrame);values.push(await frame());calls.push(r.webgl.info.render.calls);triangles.push(r.webgl.info.render.triangles);}
    r.water.update=update;
    values.sort((a,b)=>a-b);return {backend,stage,meanMs:values.reduce((a,b)=>a+b)/values.length,p95Ms:values[Math.floor(values.length*.95)],calls:Math.max(...calls),triangles:Math.max(...triangles),waterUpdates,pixelRatio:r.webgl.getPixelRatio(),waterVisible:g.roomWater.surface.visible,litres:g.roomWater.field.volumeLitres,canvas:[r.webgl.domElement.width,r.webgl.domElement.height],error:r.renderError,locked:!!document.pointerLockElement};
   },{backend,stage});
   report.cases.push(result);assert.equal(result.error,'');assert.equal(result.locked,false);
   if(stage==='dry')assert.equal(result.waterUpdates,0,'Dry camera rotation should submit no invisible water passes');
   if(stage==='wet')assert.equal(result.waterUpdates,110,'Visible water must update every accepted frame');
   if(stage==='drained')assert.equal(result.waterUpdates,1,'Dry transition must clear vendor visibility and fog exactly once');
   await page.screenshot({path:`${out}/${backend}-${stage}.png`});
  }
  const baseline=report.cases.find(c=>c.backend===backend&&c.stage==='dry-unconditional-water');
  const dry=report.cases.find(c=>c.backend===backend&&c.stage==='dry');
  assert(dry.calls<baseline.calls,'Dry rendering must avoid real draw calls');
  assert(dry.triangles<baseline.triangles,'Dry rendering must avoid redundant triangle submissions');
  assert.equal(dry.pixelRatio,baseline.pixelRatio,'The improvement must retain image resolution');
  await context.close();
 }
 assert.deepEqual(report.errors,[]);
}finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));
