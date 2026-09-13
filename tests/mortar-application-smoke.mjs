import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const url=process.argv[2]??'http://127.0.0.1:5362/Electrical-Game/';
const out=process.argv[3]??'output/mortar';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const errors=[];const results={url,checks:[],errors};
try {
 const page=await browser.newPage({viewport:{width:1366,height:768}});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url,{waitUntil:'networkidle'});await page.locator('#start-button').click();await page.evaluate(()=>document.exitPointerLock());await page.waitForTimeout(100);
 const physical=await page.evaluate(async()=>{
  const g=window.__wireTheHouse,MortarSystem=g.mortar.constructor;
  const m=new MortarSystem(g.renderer.scene,g.room.brickWall,[]),c=g.renderer.camera;
  c.position.set(0,1.3,-1);c.lookAt(0,1.3,-2.41);c.updateMatrixWorld(true);
  const p=c.position.clone().set(0,1.3,-2.41),n=p.clone().set(0,0,1),v=p.clone().set(0,0,-4);
  const dry=m.retention(p,v,n);
  // Test adhesion at the actual wetted receiver. The hose now follows gravity
  // and its stream from 1.4m away no longer lands at the camera's sight height.
  for(let i=0;i<40;i++)m.applyWater(p,n,.001);
  const damp=m.retention(p,v,n),moist={...m.moistureAt(p)};
  const glancing=m.retention(p,v.clone().set(4,0,-.4),n),weak=m.retention(p,v.clone().set(0,0,-.3),n);
  for(let i=0;i<220;i++)m.applyWater(p,n,.001);
  const saturated=m.retention(p,v,n),flood={...m.moistureAt(p)};
  m.launch(p.clone().set(.8,1.2,-1.5),v.clone().set(0,0,-4));
  m.launch(p.clone().set(-.8,.8,-1.5),v.clone().set(0,-2,1));
  for(let i=0;i<400;i++)m.update(.015);
  return {dry,damp,glancing,weak,saturated,moist:{pore:moist.pore,film:moist.film},flood:{pore:flood.pore,film:flood.film},telemetry:m.telemetry};
 });
 assert(physical.damp>physical.dry+.15,'Damp substrate should retain more than dry high-suction masonry');
 assert(physical.saturated<physical.damp,'Surface water should impair retention');
 assert(physical.glancing<physical.damp*.3,'Grazing impact must mostly shed');assert(physical.weak<physical.damp,'Weak impact must not match useful stroke');
 const mass=physical.telemetry;assert(Math.abs(mass.launchedKg-mass.stuckKg-(mass.restingKg??0)-mass.floorKg-mass.movingKg)<1e-6,'Mass balance');assert(mass.floorKg>0&&mass.stuckKg>0,'Real impact and floor spill missing');results.checks.push({name:'moisture-incidence-mass-balance',...physical});
 await page.keyboard.press('Digit7');await page.evaluate(()=>{const g=window.__wireTheHouse;g.renderer.camera.position.set(0,1.4,-1);g.player.pitch=0;g.player.yaw=0;g.step(.017);});
 const before=await page.evaluate(()=>window.__wireTheHouse.mortar.launchedMass);
 await page.keyboard.down('KeyE');await page.evaluate(()=>window.advanceTime(500));
 assert(await page.evaluate(()=>window.__wireTheHouse.mortar.charge)>.45,'Holding does not charge');
 await page.keyboard.up('KeyE');await page.evaluate(()=>window.advanceTime(1000));
 assert(await page.evaluate(()=>window.__wireTheHouse.mortar.launchedMass)>before,'Release did not launch');
 await page.keyboard.down('KeyE');await page.evaluate(()=>window.advanceTime(400));await page.keyboard.press('Digit8');await page.keyboard.up('KeyE');
 const canceled=await page.evaluate(()=>window.__wireTheHouse.mortar.launchedMass);await page.evaluate(()=>window.advanceTime(100));
 assert.equal(await page.evaluate(()=>window.__wireTheHouse.mortar.launchedMass),canceled,'Switching tool caused accidental launch');
 await page.keyboard.press('Digit7');await page.keyboard.down('KeyE');await page.evaluate(()=>window.advanceTime(500));await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.keyboard.up('KeyE');await page.evaluate(()=>window.advanceTime(100));
 assert.equal(await page.evaluate(()=>window.__wireTheHouse.mortar.launchedMass),canceled,'Blur caused accidental launch');
 await page.keyboard.down('ControlLeft');await page.evaluate(()=>window.advanceTime(500));
 assert(await page.evaluate(()=>window.__wireTheHouse.renderer.camera.position.y)<1,'Crouch did not lower working eye height');
 await page.keyboard.up('ControlLeft');await page.evaluate(()=>window.advanceTime(500));
 assert(await page.evaluate(()=>window.__wireTheHouse.renderer.camera.position.y)>1.64,'Standing eye height did not restore');
 await page.keyboard.down('KeyE');await page.evaluate(()=>window.advanceTime(300));await page.mouse.click(680,370,{button:'right'});await page.keyboard.up('KeyE');await page.evaluate(()=>window.advanceTime(100));
 assert.equal(await page.evaluate(()=>window.__wireTheHouse.mortar.launchedMass),canceled,'Right click should cancel a charged trowel');
 results.checks.push({name:'keyboard-hold-release-switch-blur-crouch-right-cancel',pass:true});
 await page.screenshot({path:out+'/desktop-mortar.png'});
 assert.deepEqual(errors,[]);await writeFile(out+'/report.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await browser.close();}
