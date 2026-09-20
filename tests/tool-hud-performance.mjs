import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { blockPointerLock } from './browser-safety.mjs';
const out=process.argv[2]??'output/tool-hud-performance';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={method:'60 real simulation steps per idle tool, identical geometry; counts DOM writes and synchronous step time, not physical-device FPS.',cases:[],errors:[]};
try{
 const context=await browser.newContext({viewport:{width:1366,height:768}});await blockPointerLock(context);
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://127.0.0.1:5365/Electrical-Game/');await page.waitForFunction(()=>window.__wireTheHouse?.roomWater.waterProActive);await page.locator('#start-button').click();
 await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.renderer.waitForFrame();window.__hudStep=g.step.bind(g);g.step=()=>{};});
 for(const [tool,key] of [['spray','Digit3'],['hammer','Digit4'],['trowel','Digit7'],['hose','Digit8']]){
  await page.keyboard.press(key);
  const result=await page.evaluate(async()=>{
   const g=window.__wireTheHouse;window.__hudStep(1/60);await g.renderer.waitForFrame();
   let mutations=0;const observer=new MutationObserver(records=>mutations+=records.length);observer.observe(g.hud.shell,{attributes:true,childList:true,subtree:true,characterData:true});
   const times=[];for(let i=0;i<60;i++){const t=performance.now();window.__hudStep(1/60);times.push(performance.now()-t);await g.renderer.waitForFrame();}
   mutations+=observer.takeRecords().length;observer.disconnect();
   return{tool:g.selectedTool,mutations,mutationsPerFrame:mutations/60,stepMeanMs:times.reduce((a,b)=>a+b)/times.length,locked:!!document.pointerLockElement,renderError:g.renderer.renderError};
  });
  assert.equal(result.tool,tool);assert.equal(result.locked,false);assert.equal(result.renderError,'');
  assert(result.mutationsPerFrame<2,'Idle tools must not rebuild dozens of unchanged HUD nodes every frame');report.cases.push(result);
 }
 assert.deepEqual(report.errors,[]);console.log(JSON.stringify(report,null,2));await context.close();
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
