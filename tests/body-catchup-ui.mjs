import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
import {serveTaskBuild} from './serve-task-build.mjs';
const base='http://127.0.0.1:5365/Electrical-Game/',out='output/body-catchup';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),report={errors:[]};
try{
 const context=await browser.newContext({viewport:{width:430,height:745},isMobile:true,hasTouch:true});await blockPointerLock(context);await serveTaskBuild(context,base);
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.goto(base);
 await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart,undefined,{timeout:120000});await page.locator('#apprentice-count').selectOption('0');await page.locator('#start-button').tap();
 await page.evaluate(async()=>{const g=window.__wireTheHouse;g.player.camera.position.set(0,1.65,2);g.player.yaw=0;g.player.pitch=-.4;g.roomWater.addFloorWater(0,0,12);await g.activateWaterPro();});await page.waitForTimeout(1000);
 await page.evaluate(()=>{
  const g=window.__wireTheHouse,a=window.__bodyAudit={steps:0,presented:0,poses:0,physicsTime:0,poseTime:0};
  const body=g.workerBody.update;g.workerBody.update=function(dt,...args){a.poses++;a.poseTime+=dt;return body.call(this,dt,...args);};
  const step=g.step;g.step=function(dt,waterDt,present,...args){a.steps++;a.physicsTime+=dt;if(present!==false)a.presented++;return step.call(this,dt,waterDt,present,...args);};
  const update=g.renderer.water.update;g.renderer.water.update=async function(...args){await new Promise(resolve=>setTimeout(resolve,90));return update.apply(this,args);};
 });await page.waitForTimeout(2200);
 const state=await page.evaluate(()=>({...window.__bodyAudit,raf:window.__wireTheHouse.animationFrame,error:window.__wireTheHouse.renderer.renderError}));report.state=state;
 assert(state.steps>state.presented*1.5,'Real delayed optical passes must exercise physics catch-up');
 assert.equal(state.poses,state.presented,'Display pose is solved once for the final state of each presented frame');
 assert(Math.abs(state.poseTime-state.physicsTime)<1e-7,'Pose smoothing retains the full bounded simulation time');
 assert(state.raf!==null&&state.error==='');assert.deepEqual(report.errors,[]);report.passed=true;
 await context.close();
}finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify(report));
