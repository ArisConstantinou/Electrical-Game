import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {blockPointerLock} from './browser-safety.mjs';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:810}});await blockPointerLock(context);const page=await context.newPage();
 await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');await page.waitForFunction(()=>window.__wireTheHouse?.workerBody.loaded,{},{timeout:90000});await page.locator('#start-button').click();await page.waitForTimeout(800);
 await page.evaluate(()=>{const g=window.__wireTheHouse;g.__testStep=g.step.bind(g);g.step=()=>{};g.mixing.setActive(false);g.selectTool('spray');});
 const cases=[],inputs=[['w',['w']],['a',['a']],['s',['s']],['d',['d']],['w+a',['w','a']],['w+d',['w','d']],['s+a',['s','a']],['s+d',['s','d']]];
 for(const [name,keys] of inputs){
  await page.evaluate(()=>{const g=window.__wireTheHouse;g.player.yaw=.6;g.player.pitch=-.35;g.player.crouched=false;g.renderer.camera.position.set(0,1.65,.5);g.workerBody.travelTurn=0;});
  for(const key of keys)await page.keyboard.down(key);
  const moving=await page.evaluate(()=>{const g=window.__wireTheHouse;const frames=[];for(let i=0;i<24;i++){g.__testStep(1/60,0,false);frames.push({velocity:g.player.velocity.toArray(),position:g.renderer.camera.position.toArray(),phase:g.workerBody.phase,head:g.workerBody.headParts.every(p=>p.visible)});}return frames;});
  for(const key of keys)await page.keyboard.up(key);
  const stopped=await page.evaluate(()=>{const g=window.__wireTheHouse;for(let i=0;i<90;i++)g.__testStep(1/60,0,false);return {velocity:g.player.velocity.toArray(),blend:g.workerBody.gaitBlend,visible:g.workerBody.visible,bodyTurn:g.workerBody.travelTurn};});
  assert(Math.hypot(moving.at(-1).velocity[0],moving.at(-1).velocity[2])>1,`${name}: native movement missing`);
  assert(moving.at(-1).phase>moving[0].phase,`${name}: gait not advancing`);assert(moving.every(f=>f.head),`${name}: shadow head disappeared`);
  assert(stopped.blend<.001&&Math.hypot(...stopped.velocity)<.001,`${name}: gait continues after release`);assert(stopped.visible);
  cases.push({name,keys,moving,stopped});
 }
 const speeds=cases.map(c=>Math.hypot(c.moving.at(-1).velocity[0],c.moving.at(-1).velocity[2]));
 assert(Math.max(...speeds)-Math.min(...speeds)<1e-8,'Diagonal WASD speed must equal cardinal speed');
 const presses=[];
 for(const crouch of [false,true]){
  await page.evaluate(crouch=>{const g=window.__wireTheHouse;g.player.yaw=0;g.player.pitch=-.75;g.player.crouched=crouch;g.renderer.camera.position.set(-.5,crouch?.95:1.65,-1.3);for(let i=0;i<90;i++)g.__testStep(1/60,0,false);},crouch);
  await page.mouse.move(720,405);await page.mouse.down();
  const down=await page.evaluate(()=>{const g=window.__wireTheHouse;for(let i=0;i<8;i++)g.__testStep(1/60,0,false);return {held:g.input.actionHeld,button:g.fpsRig.tools.get('spray').getObjectByName('spray-actuator').position.y,index:g.workerBody.telemetry.fingerFit.indexR.error};});
  await page.mouse.up();
  const up=await page.evaluate(()=>{const g=window.__wireTheHouse;for(let i=0;i<8;i++)g.__testStep(1/60,0,false);return {held:g.input.actionHeld,button:g.fpsRig.tools.get('spray').getObjectByName('spray-actuator').position.y,index:g.workerBody.telemetry.fingerFit.indexR.error};});
  assert(down.held&&!up.held);assert(Math.abs(up.button-down.button-.002)<1e-6);assert(down.index<.006&&up.index<.006);
  presses.push({crouch,down,up});
 }
 await writeFile('output/worker-three-fixes/movement-input.json',JSON.stringify({cases,presses,speeds},null,2));console.log({passed:true,inputs:cases.length,presses:presses.length});
}finally{await browser.close();}
