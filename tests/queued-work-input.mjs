import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {blockPointerLock} from './browser-safety.mjs';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext();await blockPointerLock(context);const page=await context.newPage();
 await page.goto('http://127.0.0.1:5362/Electrical-Game/');await page.waitForFunction(()=>window.__wireTheHouse?.roomWater.waterProActive);await page.locator('#start-button').click();
 await page.evaluate(async()=>{
  const g=window.__wireTheHouse,r=g.renderer,c=r.camera;await r.waitForFrame();
  c.position.set(0,1.65,-1.95);c.lookAt(0,1.4,-2.41);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;g.selectTool('trowel');
  // This test observes dispatch timing/aim only. Material deposition and box
  // collision are covered by their real geometry regressions.
  window.__calls=[];g.fpsRig.canReachPoint=()=>true;
  g.mortar.pack=camera=>{window.__calls.push({type:'pack',yaw:camera.rotation.y,expected:g.player.yaw});return true;};
  g.leveling.adjust=(_point,direction)=>window.__calls.push({type:'level',direction});
  const update=r.water.update.bind(r.water);
  window.__holdNext=()=>{let once=true;r.water.update=async dt=>{if(once){once=false;await new Promise(resolve=>{window.__releaseFrame=resolve;});}return update(dt);};};
  window.__holdNext();
 });
 await page.waitForFunction(()=>!!window.__releaseFrame);
 const oldYaw=await page.evaluate(()=>window.__wireTheHouse.renderer.camera.rotation.y);
 await page.evaluate(()=>window.__wireTheHouse.player.look(20,0));await page.keyboard.press('KeyP');
 assert.equal(await page.evaluate(()=>window.__calls.length),0,'P must wait for the accepted pose');
 assert.equal(await page.evaluate(()=>window.__wireTheHouse.renderer.camera.rotation.y),oldYaw);
 await page.evaluate(()=>{window.__releaseFrame();window.__releaseFrame=null;});await page.waitForFunction(()=>window.__calls.length===1);
 const pack=await page.evaluate(()=>window.__calls[0]);assert.equal(pack.type,'pack');assert.equal(pack.yaw,pack.expected);assert.notEqual(pack.yaw,oldYaw);
 await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.renderer.waitForFrame();g.mission.activePoint.setStage('leveling');window.__holdNext();});
 await page.waitForFunction(()=>!!window.__releaseFrame);await page.keyboard.press('KeyA');
 assert.equal(await page.evaluate(()=>window.__calls.length),1,'Level adjustment must wait until optical passes finish');
 await page.evaluate(()=>{window.__releaseFrame();window.__releaseFrame=null;});await page.waitForFunction(()=>window.__calls.length===2);
 assert.deepEqual(await page.evaluate(()=>window.__calls[1]),{type:'level',direction:'left'});
 assert.equal(await page.evaluate(()=>!!document.pointerLockElement),false);
 console.log(JSON.stringify({passed:true,checks:['P waits for current aim','level movement waits for scene boundary','Pointer Lock prohibited']}));
}finally{await browser.close();}
