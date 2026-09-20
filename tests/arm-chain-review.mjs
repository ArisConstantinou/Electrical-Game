import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
const out=`output/arm-chain/${process.argv[2]||'before'}`;await mkdir(out,{recursive:true});
const b=await chromium.launch({channel:'chrome',headless:true}),ctx=await b.newContext({viewport:{width:1280,height:1000}});await blockPointerLock(ctx);
const p=await ctx.newPage();await p.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');await p.waitForFunction(()=>window.__wireTheHouse?.workerBody.loaded);await p.locator('#start-button').click();await p.locator('#model-inspector-open').click();await p.waitForFunction(()=>window.__wireTheHouse.modelInspector.worker?.loaded);const rows=[];
for(const tool of (process.env.REVIEW_TOOLS||'drill,hose,measure,laser').split(',')){
 await p.selectOption('#model-tool',tool);await p.locator('#model-side').click();await p.waitForTimeout(350);
 rows.push(await p.evaluate(tool=>{const m=window.__wireTheHouse.modelInspector,w=m.worker;const pts=Object.fromEntries(['clavicle.R','upper_arm.R','forearm.R','hand.R','middle.01.R'].map(n=>[n,w.point(n).toArray()]));return {tool,pts,bend:w.point('middle.01.R').sub(w.point('hand.R')).angleTo(w.point('hand.R').sub(w.point('forearm.R')))*180/Math.PI,twist:w.telemetry.armTwist,solve:w.userData.graspSolve};},tool));
 await p.screenshot({path:`${out}/${tool}-side.png`});await p.locator('#model-front').click();await p.screenshot({path:`${out}/${tool}-front.png`});
}
await writeFile(`${out}/report.json`,JSON.stringify(rows,null,2));console.log(JSON.stringify(rows));await b.close();
