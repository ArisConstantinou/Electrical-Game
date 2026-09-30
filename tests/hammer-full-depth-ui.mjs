import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
import {routeBuildingDist} from './building-qa-utils.mjs';
const baseline=process.env.QA_DEPTH_BASELINE==='1',out=process.env.QA_DEPTH_OUT??'output/hammer-depth/after';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});const report={baseline,cases:[],errors:[]};
try{
 for(const mobile of [false,true]){
  if(baseline&&mobile)continue;
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1600,height:772},isMobile:mobile,hasTouch:mobile});await blockPointerLock(context);if(!baseline)await routeBuildingDist(context);
  const p=await context.newPage();p.on('pageerror',e=>report.errors.push(e.message));await p.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');
  await p.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart&&!document.querySelector('#start-button')?.disabled,null,{timeout:120000});await p.locator('#apprentice-count').selectOption('0');await p.locator('#start-button').click();await p.keyboard.press('Digit4');
  const before=await p.evaluate(()=>{const g=window.__wireTheHouse;window.qaDepthStep=g.step.bind(g);g.step=()=>{};g.player.camera.position.set(.8,1.65,g.room.brickWall.volume.frontZ+.8);g.player.yaw=0;g.player.pitch=-.18;g.player.velocity.set(0,0,0);g.player.workPosition.locked=false;g.player.workPosition.released=false;g.hammerAutoSide=false;g.fpsRig.hammerHandedness='right';g.room.brickWall.chiselSideDegrees=-15;g.room.brickWall.chiselTiltDegrees=15;for(let i=0;i<180;i++)window.qaDepthStep(1/60);return {mode:g.hammerMode,interaction:g.interaction.hammerMode};});
  if(!baseline){
   assert.equal(before.mode,'demolish');assert.equal(before.interaction,'demolish');
   const button=p.locator(mobile?'#quick-tool-mode':'#hammer-depth-mode');
   if(mobile){await p.locator('#worker-bar-handle').click();}
   await button[mobile?'tap':'click']();await p.evaluate(()=>window.qaDepthStep(1/60));assert.equal(await p.evaluate(()=>window.__wireTheHouse.interaction.hammerMode),'chase');
   await button[mobile?'tap':'click']();await p.evaluate(()=>window.qaDepthStep(1/60));assert.equal(await p.evaluate(()=>window.__wireTheHouse.interaction.hammerMode),'demolish');
   assert.equal(await button.locator(mobile?'b':':scope').textContent(),mobile?'THROUGH':'FULL DEPTH');
  }
  const state=()=>p.evaluate(()=>{const g=window.__wireTheHouse,w=g.room.brickWall,V=g.player.camera.position.constructor,h=g.fpsRig.tools.get('hammer'),d=new V(0,0,-1).applyQuaternion(h.getWorldQuaternion(g.player.camera.quaternion.clone())),tip=g.fpsRig.chiselTipWorld.clone(),origin=tip.clone().addScaledVector(d,-.5),hit=w.volume.raycast(origin,d,1);return {mode:g.hammerMode,status:g.fpsRig.contactStatus,held:g.input.actionHeld,removed:w.volume.removedNodeCount,depth:w.telemetry.maximumDepthMm,wallDepthM:w.volume.depth,rayEndDepthM:w.volume.frontZ-(origin.z+d.z),hit:hit?.point??null,direction:d.toArray(),tip:tip.toArray(),eye:g.player.camera.position.toArray(),overflow:document.documentElement.scrollWidth>innerWidth};});
  await p.screenshot({path:`${out}/${mobile?'mobile':'desktop'}-before.png`});
  if(mobile){const box=await p.locator('#look-joystick').boundingBox();await p.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);}else {await p.mouse.move(800,386);await p.mouse.down();}
  const trace=[];
  for(let batch=0;batch<50;batch++){
   await p.evaluate(async()=>{const g=window.__wireTheHouse;for(let i=0;i<30;i++){window.qaDepthStep(1/60);if(i%12===0)await g.chasing.waitForDebrisSplits();}await g.room.brickWall.waitForGeometry();await g.renderer.waitForFrame();g.renderer.render();await g.renderer.waitForFrame();});
   const sample=await state();trace.push(sample);if(!sample.hit&&sample.removed>100)break;
  }
  if(!mobile)await p.mouse.up();await p.screenshot({path:`${out}/${mobile?'mobile':'desktop'}-after.png`});const item={mobile,before,trace,last:trace.at(-1)};report.cases.push(item);console.log(JSON.stringify({mobile,before,last:item.last}));await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
  if(!baseline){assert(item.last.held,'USE did not hold');assert(item.last.rayEndDepthM>item.last.wallDepthM+.1,'Probe must cross the complete wall thickness');assert.equal(item.last.hit,null,'Solid material still blocks the complete shaft line');assert(!item.last.overflow);}
  await context.close();
 }
 assert.deepEqual(report.errors,[]);
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
