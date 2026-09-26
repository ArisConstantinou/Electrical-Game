import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
import {serveTaskBuild} from './serve-task-build.mjs';
const base='http://127.0.0.1:5365/Electrical-Game/',out='output/site-route-preparation';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),report={errors:[]};let release;
const held=new Promise(resolve=>{release=resolve;});
try{
 // Read the authored state from the real protected pre-warm build. The main
 // entry intentionally exposes the game only after READY, so it cannot be
 // queried while the candidate's tree request is held.
 const baselineContext=await browser.newContext({viewport:{width:430,height:745}});await blockPointerLock(baselineContext);
 const previousCore=process.env.TASK_BUILD_CORE;process.env.TASK_BUILD_CORE='output/performance-before-routewarm/core';
 await serveTaskBuild(baselineContext,base);if(previousCore)process.env.TASK_BUILD_CORE=previousCore;else delete process.env.TASK_BUILD_CORE;
 const baselinePage=await baselineContext.newPage();await baselinePage.goto(base);await baselinePage.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart,undefined,{timeout:120000});
 const initialRemoved=await baselinePage.evaluate(()=>window.__wireTheHouse.room.brickWall.volume.removedVolume);report.initialRemoved=initialRemoved;await baselineContext.close();
 const context=await browser.newContext({viewport:{width:430,height:745},isMobile:true,hasTouch:true,deviceScaleFactor:3});await blockPointerLock(context);await serveTaskBuild(context,base);
 await context.route('**/assets/vegetation/courtyard-tree/courtyard-tree-optimized.glb',async route=>{report.requested=true;await held;await route.fallback();});
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.goto(base);await page.waitForTimeout(7500);
 assert(report.requested);assert(await page.locator('#start-button').isDisabled(),'READY waits for the actual retained tree before preparing its route');
 release();await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart,undefined,{timeout:120000});
 const state=await page.evaluate(()=>{
  const g=window.__wireTheHouse,r=g.renderer,m=g.room.mansionWing;
  return{started:g.started,camera:g.player.camera.position.toArray(),yaw:g.player.yaw,pitch:g.player.pitch,tool:g.selectedTool,removed:g.room.brickWall.volume.removedVolume,water:g.roomWater.field.volumeLitres,tree:m.courtyard.tree.userData.scannedReady,materials:[r.webgl.info.memory.geometries,r.webgl.info.memory.textures],canvas:[r.webgl.domElement.width,r.webgl.domElement.height],pending:r.framePending,error:r.renderError,progress:document.querySelector('#start-load-percent').value,fill:document.querySelector('#start-screen').style.getPropertyValue('--load-progress')};
 });report.state=state;
 assert.equal(state.started,false);assert.deepEqual(state.camera,[0,1.65,5.2]);assert.equal(state.yaw,Math.PI);assert.equal(state.pitch,-.08);assert.equal(state.tool,'spray');assert.equal(state.removed,initialRemoved,'Preparation must preserve the authored PVC wall channels');assert.equal(state.water,0);assert(state.tree);assert.equal(state.progress,'READY');assert.equal(state.fill,'100%');assert.equal(state.pending,false);assert.equal(state.error,'');assert.deepEqual(state.canvas,[752,1303]);
 await page.locator('#apprentice-count').selectOption('0');await page.locator('#start-button').tap();await page.waitForTimeout(600);
 assert(await page.evaluate(()=>window.__wireTheHouse.started&&window.__wireTheHouse.animationFrame!==null));assert.deepEqual(report.errors,[]);report.passed=true;await context.close();
}finally{release();await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify(report));
