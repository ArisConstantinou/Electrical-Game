import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
import {routeBuildingDist} from './building-qa-utils.mjs';

const out='output/m18-tools/work';await mkdir(out,{recursive:true});
const live=process.env.M18_LIVE==='1';
const report={fixture:'Stationary camera faces actual concrete. Native inputs create the pencil mark, drill, mount and tighten the laser; no targets or progress are injected.',cases:[],errors:[],physicalMobile:false};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1366,height:768},hasTouch:mobile,isMobile:mobile});await blockPointerLock(context);if(!live)await routeBuildingDist(context);
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto('http://127.0.0.1:5365/Electrical-Game/');await page.locator('#apprentice-count').selectOption('0');await page.locator('#start-button').click({timeout:120000});
  await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera;window.workStep=g.step.bind(g);g.step=()=>{};g.mixing.finished=true;g.mixing.setActive(false);g.player.update=()=>{c.rotation.set(g.player.pitch,g.player.yaw,0);};});
  const step=n=>page.evaluate(n=>{for(let i=0;i<n;i++)window.workStep(1/60,0,false);},n);
  const select=async kind=>{
   if(mobile){if(!await page.locator('#mobile-tool-slider').isVisible())await page.locator('#worker-bar-handle').tap();const b=page.locator(`#mobile-tool-slider [data-tool="${kind}"]`);await b.scrollIntoViewIfNeeded();await b.tap();}
   else await page.keyboard.press({measure:'Digit9',drill:'Digit0',driver:'KeyB',laser:'KeyL'}[kind]);
   await step(8);
  };
  const shot=async name=>{await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/${mobile?'mobile':'desktop'}-${name}.png`});};
  const state=()=>page.evaluate(()=>{const g=window.__wireTheHouse,t=g.fpsRig.tools.get(g.selectedTool),motor=t?.getObjectByName('reference-motor'),target=g.laserLevel.target;const tip=t?.userData.tipPoint?t.localToWorld(g.renderer.camera.position.clone().fromArray(t.userData.tipPoint)):null;return{measure:g.heightMeasure.telemetry,laser:g.laserLevel.telemetry,pose:g.fpsRig.debugPose(),body:g.workerBody.telemetry,rotor:motor?.rotation.z,tip:tip?.toArray(),tipError:target&&tip?target.distanceTo(tip):null,held:g.input.actionHeld};});
  const use=async n=>{if(mobile)await page.locator('#look-joystick').tap();else await page.mouse.down();await step(n);};
  const stop=async()=>{if(mobile)await page.locator('#look-joystick').tap();else await page.mouse.up();await step(2);};
  try{
   await select('measure');
   await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera,column=g.room.referenceWalls.find(o=>o.userData.studioEntityId==='world:column:-2.72');column.geometry.computeBoundingBox();const centre=column.getWorldPosition(c.position.clone()),face=column.localToWorld(c.position.clone().set(0,0,column.geometry.boundingBox.max.z)).z;c.position.set(centre.x,g.player.eyeHeight,face+.34);c.lookAt(centre.x,g.player.eyeHeight-.20,face);g.player.pitch=c.rotation.x;g.player.yaw=c.rotation.y;});await step(5);
   const measured=await state();assert.equal(measured.measure.mode,'ready',JSON.stringify(measured.measure));
   if(mobile)await page.locator('#measure-mark').tap();else await page.keyboard.press('KeyM');await step(5);assert.equal((await state()).measure.count,1);
   await select('drill');const before=await state();assert.equal(before.laser.phase,'drill-ready',JSON.stringify(before.laser));
   const staticBefore=await page.evaluate(()=>{const t=window.__wireTheHouse.fpsRig.tools.get('drill');return t.getObjectByName('M18 FPD3 fixed housing').quaternion.toArray();});
   await use(12);const drilling=await state();assert(drilling.laser.working&&drilling.laser.progress>0&&drilling.laser.progress<1);assert(Math.abs(drilling.rotor-before.rotor)>.1);assert(drilling.tipError<.005,`Drill contact drift ${drilling.tipError}`);await shot('drilling');
   assert.deepEqual(await page.evaluate(()=>window.__wireTheHouse.fpsRig.tools.get('drill').getObjectByName('M18 FPD3 fixed housing').quaternion.toArray()),staticBefore,'Fixed housing and auxiliary handle must not spin');
   await step(50);await stop();assert.equal((await state()).laser.phase,'drilled');
   await select('laser');await page.locator('#laser-place')[mobile?'tap':'click']();await step(5);assert((await state()).laser.mounted);
   await select('driver');const driveBefore=await state();await use(12);const fastening=await state();assert(fastening.laser.working&&fastening.laser.progress>0);assert(Math.abs(fastening.rotor-driveBefore.rotor)>.1);assert(fastening.tipError<.005,`Driver contact drift ${fastening.tipError}`);await shot('fastening');
   await step(45);await stop();const done=await state();assert(done.laser.active&&!done.held);report.cases.push({mobile,measured,before,drilling,fastening,done});
  }catch(error){report.cases.push({mobile,error:String(error),state:await state()});await shot('failure');throw error;}finally{await context.close();}
 }
 assert.deepEqual(report.errors,[]);
}finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify({passed:true,cases:report.cases.map(c=>({mobile:c.mobile,drillTipError:c.drilling.tipError,driverTipError:c.fastening.tipError,body:c.fastening.body.gripReachErrors})),errors:report.errors}));
