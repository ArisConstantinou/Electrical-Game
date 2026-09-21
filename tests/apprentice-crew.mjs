import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';

const out='output/apprentice/crew';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={errors:[],stages:[],checks:[]};
try{
 const context=await browser.newContext({viewport:{width:1366,height:768}});await blockPointerLock(context);
 const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
 await page.goto('http://127.0.0.1:5365/Electrical-Game/');await page.waitForFunction(()=>window.__wireTheHouse,undefined,{timeout:120000});
 assert.deepEqual(await page.locator('#apprentice-count option').allTextContents(),['0','1','2','3','4','5']);
 await page.locator('#apprentice-count').selectOption('5');await page.waitForFunction(()=>!document.querySelector('#start-button').disabled,undefined,{timeout:120000});
 await page.screenshot({path:`${out}/five-selector.png`});await page.locator('#start-button').click();await page.waitForTimeout(500);
 report.performance=await page.evaluate(async()=>{const g=window.__wireTheHouse,frames=[],submission=[];let last=performance.now();for(let i=0;i<75;i++){await new Promise(requestAnimationFrame);const now=performance.now();await g.renderer.waitForFrame();if(i>10){frames.push(now-last);submission.push(performance.now()-now);}last=now;}const at=(a,q)=>[...a].sort((x,y)=>x-y)[Math.floor((a.length-1)*q)];return{frameMedianMs:at(frames,.5),frameP95Ms:at(frames,.95),frameMaxMs:Math.max(...frames),framesOver50ms:frames.filter(x=>x>50).length,submitP95Ms:at(submission,.95),drawCalls:g.renderer.webgl.info.render.calls,triangles:g.renderer.webgl.info.render.triangles};});
 await page.evaluate(()=>{const g=window.__wireTheHouse;window.crewStep=g.step.bind(g);g.step=()=>{};});
 const step=n=>page.evaluate(n=>{for(let i=0;i<n;i++)window.crewStep(1/60);},n);
 await page.keyboard.press('t');
 await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera,centre=g.pvc.stock.bundleCenter(1);c.position.set(2.45,1.45,centre.z);c.lookAt(centre.x,1.05,centre.z);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;c.updateMatrixWorld(true);});
 await page.mouse.move(680,380);await page.mouse.click(680,380);await step(3);
 assert.equal(await page.evaluate(()=>window.__wireTheHouse.apprentice.mode),'pipe-choice');
 await page.locator('[data-apprentice="pipe-socket"]').click();await step(3);
 await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera;c.position.set(.4,1.65,-.5);c.lookAt(3.46,1.1,1.15);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;});
 let photographed=false,last='';
 for(let i=0;i<120;i++){
   await step(36);const state=await page.evaluate(()=>window.__wireTheHouse.apprentice.telemetry);
   const stage=`${state.phase}:${state.pipeJob?.step??''}:${state.pipeBatch.finishedSocket}`;if(stage!==last){report.stages.push({frame:i*36,stage,crew:state.crew});last=stage;}
   if(!photographed&&state.pipeBatch.finishedSocket>=5){await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/five-cutting.png`});photographed=true;}
   if(state.phase==='done')break;
   if(state.phase==='blocked')throw new Error(JSON.stringify(state));
 }
 report.state=await page.evaluate(()=>window.__wireTheHouse.apprentice.telemetry);
 assert.equal(report.state.phase,'done',JSON.stringify(report.state));assert.equal(report.state.pipeBatch.finishedSocket,20);
 assert.equal(report.state.crew.length,4);assert.ok(report.state.pipeBatch.remnants.filter(items=>items.length).length>=5,JSON.stringify(report.state.pipeBatch));
 assert.ok(Math.abs(report.state.pipeBatch.claimedRaw*3-report.state.pipeBatch.finishedM-report.state.pipeBatch.kerfM-report.state.pipeBatch.remnantM)<1e-7);
 await page.keyboard.press('t');await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera,centre=g.pvc.stock.bundleCenter(2);c.position.set(2.45,1.45,centre.z);c.lookAt(centre.x,1.05,centre.z);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;c.updateMatrixWorld(true);});
 await page.mouse.move(680,380);await page.mouse.click(680,380);await step(3);assert.equal(await page.evaluate(()=>window.__wireTheHouse.apprentice.mode),'pipe-choice');
 await page.locator('[data-apprentice="pipe-switch"]').click();await step(3);
 await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera;c.position.set(.4,1.65,-.5);c.lookAt(3.46,1.1,1.15);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;});
 for(let i=0;i<120;i++){await step(36);const state=await page.evaluate(()=>window.__wireTheHouse.apprentice.telemetry);if(state.phase==='done')break;if(state.phase==='blocked')throw new Error(JSON.stringify(state));}
 report.state=await page.evaluate(()=>window.__wireTheHouse.apprentice.telemetry);assert.equal(report.state.phase,'done',JSON.stringify(report.state));assert.equal(report.state.pipeBatch.finishedSwitch,20);
 assert.ok(Math.abs(report.state.pipeBatch.claimedRaw*3-report.state.pipeBatch.finishedM-report.state.pipeBatch.kerfM-report.state.pipeBatch.remnantM)<1e-7);
 await page.keyboard.press('v');await step(3);assert.equal(await page.evaluate(()=>window.__wireTheHouse.apprentice.paper.visible),true);
 await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/five-plan.png`});
 assert.deepEqual(report.errors,[]);report.checks.push('0–5 selector; five loaded anatomical helpers; five real stock bundles cut 20×50 cm and 20×140 cm concurrently; length conservation');
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({checks:report.checks,errors:report.errors,state:report.state}));
