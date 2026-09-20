import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';
import assert from 'node:assert/strict';

const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const backend of ['webgpu','webgl']){
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true});await blockPointerLock(context);
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:5365/Electrical-Game/${backend==='webgl'?'?renderer=webgl':''}`);
  await page.waitForFunction(()=>window.__wireTheHouse?.roomWater.waterProActive,undefined,{timeout:120000});
  const result=await page.evaluate(async()=>{
   const g=window.__wireTheHouse,r=g.renderer,w=g.roomWater;
   g.step=()=>{};await r.waitForFrame();r.render();await r.waitForFrame();
   let mesh;r.scene.traverse(o=>{if(o.userData.waterPro)mesh=o;});
   const initial={visible:mesh.visible,submerged:mesh.userData.waterPro.cameraSubmerged};
   let updates=0;const original=r.water.update.bind(r.water);r.water.update=(dt)=>{updates++;return original(dt);};
   const frame=async()=>{r.render();await r.waitForFrame();};
   await frame();await frame();const dryUpdates=updates;
   w.addFloorWater(0,0,12);for(let i=0;i<120;i++)w.update(1/30);
   const i=w.field.indexAt(0,0),wetDepth=w.field.depths[i];
   r.camera.position.set(0,w.field.bed[i]+wetDepth*.5,0);
   await frame();const submerged={visible:mesh.visible,submerged:mesh.userData.waterPro.cameraSubmerged,updates};
   // Controlled drain fixture: verify the last wet pass cannot leave the
   // underwater tint or water mesh latched on the following dry frames.
   w.field.depths.fill(0);w.rebuildGeometry();await frame();
   const drained={visible:mesh.visible,submerged:mesh.userData.waterPro.cameraSubmerged,updates};
   await frame();await frame();
   return{initial,dryUpdates,wetDepth,submerged,drained,finalUpdates:updates,error:r.renderError,locked:!!document.pointerLockElement};
  });
  assert.deepEqual(result.initial,{visible:false,submerged:false});assert.equal(result.dryUpdates,0);assert(result.wetDepth>0);
  assert.deepEqual(result.submerged,{visible:true,submerged:true,updates:1});
  assert.deepEqual(result.drained,{visible:false,submerged:false,updates:2});assert.equal(result.finalUpdates,2);
  assert.equal(result.error,'');assert.equal(result.locked,false);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({backend,...result}));await context.close();
 }
}finally{await browser.close();}
