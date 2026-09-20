import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
const url=process.argv.find(arg=>/^https?:/.test(arg))??'http://127.0.0.1:5365/Electrical-Game/';
const out='output/mixing-downward-arms';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});const results=[];
try{
 for(const viewport of [{width:1366,height:768},{width:390,height:844},{width:844,height:390}]){
  const context=await browser.newContext({viewport,isMobile:viewport.width<900,hasTouch:viewport.width<900});await blockPointerLock(context);
  const page=await context.newPage();await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse?.mixing);await page.locator('#start-button').click();
  await page.evaluate(()=>{const g=window.__wireTheHouse;g.step=()=>{};g.mixing.setActive(true);});
  for(const angle of [55,75,88])for(const tool of ['trowel','shovel','mixer']){
   const sample=await page.evaluate(({angle,tool})=>{const g=window.__wireTheHouse,m=g.mixing,c=g.renderer.camera;
    c.position.set(-.75,1.65,1.88);c.rotation.set(-angle*Math.PI/180,Math.PI,0,'YXZ');c.updateMatrixWorld(true);m.chooseTool(tool);m.present();
    return m.arms.map(a=>({shoulder:c.worldToLocal(a.shoulder.clone()).toArray(),upper:a.shoulder.distanceTo(a.elbow),forearm:a.elbow.distanceTo(a.wrist)}));
   },{angle,tool});
   for(const arm of sample){assert(arm.shoulder[2]>.07,'Proximal shoulder stays behind the eye while looking down');assert(Math.abs(arm.upper-.31)<.001);assert(Math.abs(arm.forearm-.27)<.001,'Forearm joins the hand at fixed length');}
   await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});
   await page.screenshot({path:`${out}/${viewport.width}-${angle}-${tool}.png`});results.push({viewport,angle,tool,sample});
  }
  await context.close();
 }
 await writeFile(`${out}/report.json`,JSON.stringify({passed:true,mobileIsEmulation:true,results},null,2));console.log(`PASS ${results.length} downward arm cases`);
}finally{await browser.close();}
