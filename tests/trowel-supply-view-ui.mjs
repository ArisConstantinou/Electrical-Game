import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
import {prepareFinishedMortar} from './prepared-mortar-fixture.mjs';
const url=process.argv.find(a=>/^https?:/.test(a))??'http://127.0.0.1:5364/Electrical-Game/';
const baseline=process.argv.includes('--baseline'),out=`output/trowel-supply-view-${baseline?'before':'after'}`;
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),report={url,baseline,cases:[]};
try{for(const mobile of [false,true]){
 const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1366,height:768},isMobile:mobile,hasTouch:mobile});await blockPointerLock(page.context());
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.routeWebSocket('**',()=>{});
 await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse);await page.locator('#start-button')[mobile?'tap':'click']();await page.waitForTimeout(400);
 await page.evaluate(()=>{const g=window.__wireTheHouse;window.__supplyStep=g.step.bind(g);g.step=()=>{};});
 if(mobile)await page.locator('[data-tool="trowel"]').tap();else await page.keyboard.press('Digit7');
 const step=()=>page.evaluate(()=>{for(let i=0;i<3;i++)window.__supplyStep(1/60);});
 const read=()=>page.evaluate(()=>{const g=window.__wireTheHouse;return{visible:g.fpsRig.tools.get('trowel').getObjectByName('trowel-load').visible,ready:g.mixing.batch.ready,launched:g.mortar.telemetry.launchedKg};});
 const capture=async name=>{await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/${mobile?'mobile':'desktop'}-${name}.png`});};
 await step();const initial=await read();await capture('ready-wheelbarrow');
 await prepareFinishedMortar(page);await step();const prepared=await read();
 const yaw=await page.evaluate(()=>{
  const g=window.__wireTheHouse,c=g.renderer.camera,rig=g.fpsRig,tool=rig.tools.get('trowel'),Q=c.quaternion.constructor;
  const samples=[];c.position.set(0,1.65,1);g.player.pitch=-.45;
  for(let degrees=-180;degrees<=180;degrees++){
   c.rotation.set(-.45,degrees*Math.PI/180,0);g.player.yaw=c.rotation.y;c.updateMatrixWorld(true);
   rig.update(0,false);rig.poseTrowel(c,g.mortar.throwFeedback.motion,0,g.room.brickWall.volume.frontZ);
   const q=c.getWorldQuaternion(new Q()).invert().multiply(tool.getWorldQuaternion(new Q()));
   samples.push({degrees,q:q.toArray()});
  }
  let maximumStep=0;for(let i=1;i<samples.length;i++)maximumStep=Math.max(maximumStep,new Q().fromArray(samples[i-1].q).angleTo(new Q().fromArray(samples[i].q)));
  c.rotation.set(-.45,Math.PI*.75,0);g.player.yaw=c.rotation.y;c.updateMatrixWorld(true);rig.poseTrowel(c,g.mortar.throwFeedback.motion,0,g.room.brickWall.volume.frontZ);
  return{maximumStep,samples};
 });await capture('carry');
 await page.evaluate(()=>window.__wireTheHouse.mixing.batch.consumeKg(1e6));await step();const fallback=await read();
 await page.evaluate(()=>window.__wireTheHouse.mixing.reserveScoop(1e6));await step();const depleted=await read();await capture('depleted');
 report.cases.push({mobile,initial,prepared,fallback,depleted,yaw,errors});
 if(!baseline){assert(initial.visible,'Fresh game starts loaded from the ready wheelbarrow');assert(prepared.visible,'Prepared batch must appear on the blade');assert(fallback.visible,'Empty bucket falls back to the ready wheelbarrow');assert(!depleted.visible,'Exhausting both supplies removes the load');assert(yaw.maximumStep<.08,'Camera yaw flips the wrist or snaps between carry and work poses');assert.deepEqual(errors,[]);}
 await page.close();
}}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify(report.cases.map(({yaw,...s})=>({...s,maximumYawStep:yaw.maximumStep}))));
