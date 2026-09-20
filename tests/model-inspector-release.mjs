import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
const out='output/motion-grip-rework/orbit';await mkdir(out,{recursive:true});
const b=await chromium.launch({channel:'chrome',headless:true}),report={cases:[],errors:[]};
try{const c=await b.newContext({viewport:{width:1440,height:1000}});await blockPointerLock(c);const p=await c.newPage();p.on('pageerror',e=>report.errors.push(e.message));await p.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');await p.waitForFunction(()=>window.__wireTheHouse?.workerBody.loaded,null,{timeout:90000});await p.locator('#start-button').click();await p.locator('#model-inspector-open').click();await p.waitForFunction(()=>window.__wireTheHouse.modelInspector.telemetry.loaded);
for(const mode of ['character','asset','live']){
 if(mode==='asset'){await p.locator('#model-assets').click();await p.fill('#model-search','drill');await p.locator('#model-list button').first().click();}
 if(mode==='live'){await p.locator('#model-character').click();await p.locator('#model-live').click();}
 const box=await p.locator('#model-orbit').boundingBox();
 for(const button of ['left','right']){
  await p.mouse.move(box.x+box.width*.6,box.y+box.height*.5);await p.mouse.down({button});await p.mouse.move(box.x+box.width*.8,box.y+box.height*.55,{steps:8});await p.mouse.up({button});
  const before=await p.evaluate(()=>{const m=window.__wireTheHouse.modelInspector;return {p:m.camera.position.toArray(),q:m.camera.quaternion.toArray(),state:m.controls.state};});
  await p.mouse.move(box.x+box.width*.4,box.y+box.height*.3,{steps:8});await p.waitForTimeout(650);
  const after=await p.evaluate(()=>{const m=window.__wireTheHouse.modelInspector;return {p:m.camera.position.toArray(),q:m.camera.quaternion.toArray(),state:m.controls.state};});
  assert.equal(after.state,-1,mode+': drag must be released');const drift=Math.max(...after.p.map((x,i)=>Math.abs(x-before.p[i])),...after.q.map((x,i)=>Math.abs(x-before.q[i])));assert(drift<1e-6,mode+': camera moves after release');report.cases.push({mode,button,drift});
 }
 await p.screenshot({path:`${out}/${mode}.png`});
}
await p.locator('#model-close').click();assert(!await p.evaluate(()=>window.__wireTheHouse.modelInspector.active));assert.deepEqual(report.errors,[]);report.passed=true;
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await b.close();}
console.log(report);
