import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
import {serveTaskBuild} from './serve-task-build.mjs';
const base='http://127.0.0.1:5365/Electrical-Game/',out=process.argv[2]??'output/encoder-recovery';
await mkdir(out,{recursive:true});const report={method:'Real portrait WebGPU runtime; injection of the exact observed iPhone encoder exception. This proves error-path recovery, not removal of the underlying physical GPU fault.',cases:[],errors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({viewport:{width:430,height:932},deviceScaleFactor:2,isMobile:true,hasTouch:true});await blockPointerLock(context);await serveTaskBuild(context,base);
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.goto(base);await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart,undefined,{timeout:120000});await page.locator('#start-button').tap();
 await page.waitForTimeout(1200);
 await page.evaluate(()=>{
  const g=window.__wireTheHouse;if(!g.renderer.webgl.backend.isWebGPUBackend)throw Error('Test requires actual WebGPU');
  window.__encoderFrames=0;const draw=g.renderer.drawScene;g.renderer.drawScene=function(...args){const result=draw.apply(this,args);window.__encoderFrames++;return result;};
  window.__encoderObjects=[g.renderer.scene,g.room.brickWall.volume,g.roomWater.field,g.mission,g.mortar,g.player.camera];
 });
 const state=()=>page.evaluate(()=>{const g=window.__wireTheHouse;return{frames:window.__encoderFrames,animationFrame:g.animationFrame,paused:g.lifecyclePaused,waterPreparing:!!g.waterProTask,error:g.renderer.renderError,graphics:g.renderer.lifecycleTelemetry,position:g.player.camera.position.toArray(),tool:g.selectedTool,removed:g.room.brickWall.volume.removedVolume,water:g.roomWater.telemetry.receivedLitres,sameObjects:[g.renderer.scene,g.room.brickWall.volume,g.roomWater.field,g.mission,g.mortar,g.player.camera].every((o,i)=>o===window.__encoderObjects[i])};});
 for(const kind of ['dry-sync','wet-async']){
  if(kind==='wet-async')await page.evaluate(async()=>{const g=window.__wireTheHouse;g.player.camera.position.set(0,1.65,2);g.player.yaw=0;g.player.pitch=.3;g.roomWater.addFloorWater(0,0,12);await g.activateWaterPro();});
  await page.waitForTimeout(500);const before=await state(),record={kind,before};report.cases.push(record);
  await page.evaluate(kind=>{
   const g=window.__wireTheHouse,message=kind==='dry-sync'?'GPUDevice.createCommandEncoder: Unable to make command encoder.':'GPUCommandEncoder.beginRenderPass: Unable to begin render pass.';
   const target=kind==='dry-sync'?g.renderer.gpu.backend.device:g.renderer.water,method=kind==='dry-sync'?'createCommandEncoder':'update',original=target[method];
   target[method]=function(...args){target[method]=original;const error=new DOMException(message,'InvalidStateError');if(kind==='wet-async')return Promise.reject(error);throw error;};
  },kind);
  try{await page.waitForFunction(previous=>{const g=window.__wireTheHouse;return window.__encoderFrames>previous+12&&(g.renderer.lifecycleTelemetry.recoveries??0)>0&&!g.lifecyclePaused;},before.frames,{timeout:25000});}
  catch(error){record.failedState=await state();throw error;}
  const after=await state();record.after=after;
  assert.equal(after.graphics.recoveries,before.graphics.recoveries+1,'Each encoder failure rebuilds exactly once');
  assert(after.sameObjects&&after.tool===before.tool&&after.removed===before.removed&&after.water===before.water,'Recovery preserves gameplay and excavation');
  assert(after.position.every((v,i)=>Math.abs(v-before.position[i])<1e-6),'Recovery keeps the camera position');assert.equal(after.error,'');
  assert(after.graphics.graphicsErrors.some(e=>e.message.includes(kind==='dry-sync'?'createCommandEncoder':'beginRenderPass')),'Fault remains available to phone diagnostics');
  await page.screenshot({path:`${out}/${kind}.png`});
 }
 assert.deepEqual(report.errors,[]);report.passed=true;
}finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify(report));
