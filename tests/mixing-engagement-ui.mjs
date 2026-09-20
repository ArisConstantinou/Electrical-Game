import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
const baseline=process.argv.includes('--baseline'),out=`output/mixing-engagement/${baseline?'before':'after'}`;await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});const report={baseline,errors:[]};
try{
 const context=await browser.newContext({viewport:{width:1440,height:900}});await blockPointerLock(context);
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://127.0.0.1:5365/Electrical-Game/');await page.locator('#start-button').click({timeout:120000});await page.waitForTimeout(600);
 await page.evaluate(()=>{const g=window.__wireTheHouse;window.mixStep=g.step.bind(g);g.step=()=>{};g.selectTool('hammer');const c=g.renderer.camera;c.position.set(.9,1.65,.65);c.lookAt(.9,.30,2.18);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;});
 const step=async(n=2)=>page.evaluate(n=>{for(let i=0;i<n;i++)window.mixStep(1/60);},n);
 const snap=async name=>{await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/${name}.png`});};
 const state=()=>page.evaluate(()=>{const g=window.__wireTheHouse,m=g.mixing,b=m.models.bucket,p=m.models.mixer;return{receipt:!document.querySelector('#mixing-receipt').hidden,active:m.active,inserted:m.inserted,tool:m.tool,mixer:p.position.toArray(),bucket:b.position.toArray(),paddleFloor:p.position.y+.024,aim:m.telemetry.aimedTarget};});
 await step(10);report.looking=await state();await snap('01-looking');
 if(!baseline){
  assert.equal(report.looking.receipt,false,'Looking at the station must not open the receipt');
  assert(Math.hypot(report.looking.mixer[0]-report.looking.bucket[0],report.looking.mixer[2]-report.looking.bucket[2])<.01,'Parked mixer must be centred inside the green bucket');
  assert(report.looking.paddleFloor>report.looking.bucket[1]+.025&&report.looking.paddleFloor<report.looking.bucket[1]+.25,'Paddle must be inside, above the bucket floor');
  assert.equal(report.looking.inserted,false,'Storage placement must not auto-start mixing');
  await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera,target=c.position.clone().set(0,.66,0);g.mixing.models.mixer.localToWorld(target);c.lookAt(target);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;});await step();
  assert.equal((await state()).aim,'mixer');await page.keyboard.down('KeyE');await step();await page.keyboard.up('KeyE');await step();report.interacting=await state();
  assert(report.interacting.active&&report.interacting.receipt);assert.equal(report.interacting.tool,'mixer');await snap('02-interacting');
  await page.keyboard.press('Digit4');await step();assert.equal((await state()).active,false);assert.equal((await state()).receipt,false);
  await step(60);assert.equal((await state()).receipt,false,'Panel must remain closed when looking again after leaving mixing');await snap('03-returned');
  await page.locator('[data-mix-equip="water"]').click();await step();assert.equal((await state()).receipt,true,'Explicit mixing-tool selection opens the receipt');
  assert.equal(report.errors.length,0);report.passed=true;
 }
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify(report));
