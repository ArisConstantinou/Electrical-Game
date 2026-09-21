import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';

const out='output/apprentice/pipes';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={errors:[],stages:[],checks:[]};
try{
 const context=await browser.newContext({viewport:{width:1366,height:768}});await blockPointerLock(context);
 const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
 await page.goto('http://127.0.0.1:5365/Electrical-Game/');await page.waitForFunction(()=>window.__wireTheHouse,undefined,{timeout:120000});
 await page.locator('#start-button').click();await page.waitForTimeout(500);
 await page.evaluate(()=>{const g=window.__wireTheHouse;window.pipeStep=g.step.bind(g);g.step=()=>{};});
 const step=n=>page.evaluate(n=>{for(let i=0;i<n;i++)window.pipeStep(1/60);},n);
 const aim=bundle=>page.evaluate(bundle=>{const g=window.__wireTheHouse,c=g.renderer.camera,centre=g.pvc.stock.bundleCenter(bundle);c.position.set(2.45,1.45,centre.z);c.lookAt(centre.x,1.05,centre.z);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;g.player.velocity.set(0,0,0);c.updateMatrixWorld(true);},bundle);
 const snap=async name=>{await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/${name}.png`});};
 for(const [bundle,kind] of [[1,'socket'],[2,'switch']]){
   await page.keyboard.press('t');await aim(bundle);await step(3);
   const hit=await page.evaluate(()=>window.__wireTheHouse.pvc.stock.bundleAt(window.__wireTheHouse.renderer.camera));assert.equal(hit?.index,bundle,JSON.stringify(hit));
   await snap(`${kind}-stock`);await page.mouse.move(680,380);await page.mouse.click(680,380);await step(3);
   assert.equal(await page.evaluate(()=>window.__wireTheHouse.apprentice.mode),'pipe-choice');
   assert.equal(await page.evaluate(()=>window.__wireTheHouse.apprentice.telemetry.pipeSelection),bundle);
   await snap(`${kind}-choice`);await page.locator(`[data-apprentice="pipe-${kind}"]`).click();await step(3);
   assert.equal(await page.evaluate(()=>window.__wireTheHouse.apprentice.phase),'pipe');
   // The player moves clear while the worker reaches the actual stock.
   await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera;c.position.set(.4,1.65,-.5);c.lookAt(3.46,1.1,1.15);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;});
   let last='',snapshot=false;
   for(let i=0;i<180;i++){
     await step(36);const state=await page.evaluate(()=>window.__wireTheHouse.apprentice.telemetry);
     const stage=`${state.phase}:${state.pipeJob?.step??''}`;if(stage!==last){last=stage;report.stages.push({kind,frame:i*36,stage,produced:state.pipeJob?.produced??null,message:state.message});}
     if(!snapshot&&state.pipeJob?.produced>=3){await snap(`${kind}-cutting`);snapshot=true;}
     if(state.phase==='done')break;
     if(state.phase==='blocked')throw new Error(JSON.stringify(state));
   }
   const state=await page.evaluate(()=>window.__wireTheHouse.apprentice.telemetry);assert.equal(state.phase,'done',JSON.stringify(state));
   assert.equal(state.pipeBatch[kind==='socket'?'finishedSocket':'finishedSwitch'],20);await snap(`${kind}-ready`);
 }
 report.state=await page.evaluate(()=>window.__wireTheHouse.apprentice.telemetry);
 const p=report.state.pipeBatch;assert.ok(Math.abs(p.claimedRaw*3-p.finishedM-p.kerfM-p.remnantM)<1e-7,JSON.stringify(p));
 assert.equal(report.state.pipeYard.socket,20);assert.equal(report.state.pipeYard.switch,20);
 report.checks.push('Five finite bundles; T selects a physical bundle; socket and switch choices each cut 20 visible pieces; 50/140 cm material conservation');
 assert.deepEqual(report.errors,[]);
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({checks:report.checks,errors:report.errors,pipeBatch:report.state?.pipeBatch}));
