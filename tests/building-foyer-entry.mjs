import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {routeBuildingDist} from './building-qa-utils.mjs';
import {blockPointerLock} from './browser-safety.mjs';
const phase=process.argv[2]??'after',out=`output/building-foyer-entry/${phase}`;await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});const report={phase,checks:[],errors:[]};
try{
 const context=await browser.newContext({viewport:{width:1366,height:768}});await blockPointerLock(context);await routeBuildingDist(context);
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');
 await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart&&!document.querySelector('#start-button')?.disabled,null,{timeout:120000});await page.locator('#apprentice-count').selectOption('5');await page.locator('#start-button').click();
 // Reproduce the user's exact submitted view once; all subsequent travel is W input.
 await page.evaluate(()=>{const g=window.__wireTheHouse;g.player.camera.position.set(3.1,1.65,12.9);g.player.yaw=-1.05;g.player.pitch=.2;});await page.waitForTimeout(600);await page.screenshot({path:`${out}/submitted-view.png`});
 for(const [name,x,z,floor] of [['foyer-approach',3.35,8.8,0],['open-foyer-doorway',3.35,7.25,0],['stair-foot',5.5,7.25,0],['first-flight',5.5,11.64,1.65],['mid-turn',7.5,11.64,1.65],['L1-arrival',7.5,7.25,3.3]]){
  await page.evaluate(({x,z})=>{const g=window.__wireTheHouse,p=g.player;p.yaw=Math.atan2(p.camera.position.x-x,p.camera.position.z-z);p.pitch=-.04;window.__entryReached=false;window.__entryStep=g.step;g.step=function(...args){const r=window.__entryStep.apply(this,args);if(Math.hypot(p.camera.position.x-x,p.camera.position.z-z)<.14)window.__entryReached=true;return r;};},{x,z});
  await page.keyboard.down('KeyW');let reached=true;
  try{await page.waitForFunction(()=>window.__entryReached,null,{timeout:8000});}catch{reached=false;}
  finally{await page.keyboard.up('KeyW');await page.evaluate(()=>window.__wireTheHouse.step=window.__entryStep);}
  await page.waitForTimeout(180);const state=await page.evaluate(()=>{const g=window.__wireTheHouse,p=g.player;return {position:p.camera.position.toArray(),feet:p.camera.position.y-p.eyeHeight,contacts:p.collisionContacts};});report.checks.push({name,reached,...state});
  await page.screenshot({path:`${out}/${name}.png`});
  if(!reached){report.blocked=name;break;}assert(Math.abs(state.feet-floor)<.1);
 }
 if(phase==='before')assert.equal(report.blocked,'open-foyer-doorway');else assert.equal(report.blocked,undefined);
 assert.deepEqual(report.errors,[]);report.passed=true;
}finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify(report));
