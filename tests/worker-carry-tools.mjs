import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {blockPointerLock} from './browser-safety.mjs';
const out='output/worker-carry-tools';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),report={cases:[],errors:[]};
try{
 const context=await browser.newContext({viewport:{width:1440,height:810}});await blockPointerLock(context);
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.routeWebSocket('**',()=>{});
 await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');await page.locator('#start-button').click({timeout:120000});await page.waitForFunction(()=>window.__wireTheHouse.workerBody.loaded);
 await page.evaluate(()=>{const g=window.__wireTheHouse;g.__carryStep=g.step.bind(g);g.step=()=>{};g.mixing.setActive(false);});
 for(const tool of ['spray','trowel','hose','drill','level','fitting'])for(const keys of [['KeyA'],['KeyD'],['KeyW','KeyA'],['KeyS','KeyD']]){
  const result=await page.evaluate(async({tool,keys})=>{
   const g=window.__wireTheHouse,w=g.workerBody,c=g.renderer.camera;
   g.input.keys.clear();g.player.yaw=0;g.player.pitch=-.4;g.player.crouched=false;g.player.velocity.set(0,0,0);c.position.set(1,1.65,-.6);g.selectTool(tool);w.resetPreviewMotion();
   for(let i=0;i<6;i++)g.__carryStep(1/60,0,false);
   for(const key of keys)g.input.keys.add(key);
   const frames=[];
   for(let i=0;i<24;i++){g.__carryStep(1/60,0,false);frames.push({turn:w.travelTurn,grips:w.telemetry.gripReachErrors,contacts:[...g.player.collisionContacts]});}
   g.input.keys.clear();const bounds=[];
   w.traverse(o=>{if(o.isSkinnedMesh){o.skeleton.update();o.computeBoundingBox();bounds.push(o.boundingBox.clone().applyMatrix4(o.matrixWorld).getSize(c.position.clone()).toArray());}});
   g.renderer.render();await g.renderer.waitForFrame();return {tool,keys,frames,bounds};
  },{tool,keys});
  report.cases.push(result);await page.screenshot({path:`${out}/${tool}-${keys.join('-')}.png`});
  assert(result.frames.every(f=>f.contacts.length===0),`${tool}: test aisle obstructed`);
  assert(Math.abs(result.frames.at(-1).turn)>.4,`${tool}: carrying prevents body turn`);
  assert(result.frames.every(f=>Object.values(f.grips).every(e=>Number.isFinite(e)&&e<.01)),`${tool}: moving hand leaves grip`);
  assert(result.bounds.every(b=>b.every(Number.isFinite)&&Math.max(...b)<2.1),`${tool}: invalid deformed body`);
 }
 assert.deepEqual(report.errors,[]);report.passed=true;
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
console.log({passed:report.passed,cases:report.cases.length});
