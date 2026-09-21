import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
const baseline=process.argv.includes('--baseline');
const fastBatch=process.argv.includes('--fast-batch');
const wallContactOnly=process.argv.includes('--wall-contact-only');
const out=`output/apprentice/${baseline?'before':wallContactOnly?'focused-wall':'after'}`;
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={baseline,fastBatch,wallContactOnly,errors:[],checks:[]};
try {
 const context=await browser.newContext({viewport:{width:1366,height:768}});await blockPointerLock(context);
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://127.0.0.1:5365/Electrical-Game/');
 await page.waitForFunction(()=>window.__wireTheHouse,{},{timeout:120000});
 await page.screenshot({path:`${out}/01-start.png`});
 await page.locator('#start-button').click();await page.waitForTimeout(650);
 await page.evaluate(()=>{const g=window.__wireTheHouse;window.testStep=g.step.bind(g);g.step=()=>{};const r=g.renderer.webgl,renderObject=r.renderObject;r.renderObject=function(...args){try{return renderObject.apply(this,args);}catch(error){throw new Error(`${error.message}; object=${args[0]?.name}; apprentice=${JSON.stringify(g.apprentice?.telemetry)}`);}};});
 const step=async n=>page.evaluate(n=>{for(let i=0;i<n;i++)window.testStep(1/60);},n);
 const aim=async(position,target)=>{await page.evaluate(({position,target})=>{const g=window.__wireTheHouse,c=g.renderer.camera;c.position.fromArray(position);c.lookAt(...target);g.player.pitch=c.rotation.x;g.player.yaw=c.rotation.y;g.player.velocity.set(0,0,0);c.updateMatrixWorld(true);},{position,target});await step(2);};
 const snap=async name=>{await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/${name}.png`});};
 await aim([-.8,1.65,-.75],[-.8,1.2,-2.41]);
 await snap('02-wall');
 report.state=JSON.parse(await page.evaluate(()=>window.render_game_to_text()));
 if(baseline){await aim([.15,1.65,-.65],[-.8,1.1,-2.41]);await snap('02b-work-view');}
 if(!baseline){
   await page.keyboard.press('t');await step(2);
   assert.equal(await page.evaluate(()=>window.__wireTheHouse.apprentice.mode),'point');
   await page.mouse.move(680,380);await page.mouse.down();await step(3);
   for(let i=0;i<8;i++){await aim([-.8,1.65,-.75],[-.8-.012*(i+1),1.2,-2.41]);await step(2);}
   await page.mouse.up();await step(2);
   await snap('03-highlight');
   assert.ok(await page.evaluate(()=>window.__wireTheHouse.apprentice.telemetry.highlightSamples>0));
   await page.keyboard.press('e');await step(3);
   assert.equal(await page.evaluate(()=>window.__wireTheHouse.apprentice.mode),'layout');
   await page.keyboard.press('2');await step(3);await snap('04-layout');
   await page.keyboard.press('Enter');await step(3);await snap('05-confirmed');
   assert.ok(await page.evaluate(()=>window.__wireTheHouse.apprentice.telemetry.job));
   assert.ok(await page.evaluate(()=>window.__wireTheHouse.apprentice.stagedBoxes?.visible),'confirmed boxes should remain physically staged for collection');
   // Move the player aside so the apprentice has a clear, physical work area.
   await aim([.15,1.65,-.65],[-.8,1.1,-2.41]);
   let lastStage='';report.workStages=[];
   for(let i=0;i<1250;i++){
     await step(48);
     const s=await page.evaluate(()=>window.__wireTheHouse.apprentice.telemetry);
     if(wallContactOnly&&s.phase==='construction'&&s.workStep==='return-hammer'&&!report.wallFixture){
       await page.evaluate(()=>{const g=window.__wireTheHouse,a=g.apprentice;g.mixing.claimForApprentice();a.hasHammer=false;a.hammer.visible=false;a.rig.visible=false;g.mixing.wheelbarrow.massKg=114;a.holdWorkTool('trowel');a.prepareMortarTargets();a.wallApproach=.69;a.workStep='wall-mortar';a.workElapsed=0;a.path=[];a.workDestination=null;});report.wallFixture=true;
     }
     if(fastBatch&&s.phase==='construction'&&s.batchCycle===0&&s.workStep==='cement-source'&&s.cementDone>=3&&s.cementDone<17){
       await page.evaluate(()=>{const g=window.__wireTheHouse;while(g.apprentice.cementDone<17){const sack=g.mixing.batch.getState().sacks.findIndex(x=>x.remainingKg>.5);if(!g.mixing.batch.getState().sacks[sack].open)g.mixing.batch.openSack(sack);if(!g.mixing.batch.scoopCement(sack)||!g.mixing.batch.pour('trowel',g.mixing.drum.batch))throw Error('cement fast-forward refused');g.apprentice.cementDone++;}});
     }
     if(fastBatch&&s.phase==='construction'&&s.batchCycle===0&&s.workStep==='sand-source'&&s.sandDone>=3&&s.sandDone<35){
       await page.evaluate(()=>{const g=window.__wireTheHouse;while(g.apprentice.sandDone<35){if(!g.mixing.batch.scoopSand()||!g.mixing.batch.pour('shovel',g.mixing.drum.batch))throw Error('sand fast-forward refused');g.apprentice.sandDone++;}});
     }
     const stage=`${s.phase}:${s.workStep??''}`;
     if(stage!==lastStage){lastStage=stage;report.workStages.push({frame:i*48,stage,cartKg:await page.evaluate(()=>window.__wireTheHouse.mixing.wheelbarrow.massKg)});console.log(stage,i*48);}
     if(i===2){await aim([-.1,1.65,1.65],[.8,.8,.55]);await snap('05b-pickup');}
     if(i===5){await aim([.15,1.65,-.65],[-.8,1.1,-2.41]);await snap('05c-carry');}
     if(i===10){
       await snap('06-working');
       report.workingPerformance=await page.evaluate(async()=>{
         const values=[],cpu=[];let last=performance.now();
         for(let n=0;n<100;n++){await new Promise(requestAnimationFrame);const t=performance.now();window.testStep(1/60);await window.__wireTheHouse.renderer.waitForFrame();if(n>15){values.push(t-last);cpu.push(performance.now()-t);}last=t;}
         const p=(a,q)=>[...a].sort((a,b)=>a-b)[Math.floor((a.length-1)*q)];
         return{frameMedianMs:p(values,.5),frameP95Ms:p(values,.95),frameMaxMs:Math.max(...values),framesOver50ms:values.filter(x=>x>50).length,submitP95Ms:p(cpu,.95),phase:window.__wireTheHouse.apprentice.phase};
       });
       await aim([2.8,1.65,-1.45],[-.8,1.1,-2.41]);
     }
     if(i>0&&i%40===0)console.log('progress',i*48,JSON.stringify({stage,position:s.position,waiting:s.waiting,message:s.message}));
     if(s.phase==='construction'&&s.workStep==='mixing'&&!report.mixingSnapshot){await aim([1.8,1.65,-.9],[-.55,1.1,2.83]);await snap('07-mixing');await aim([2.8,1.65,-1.45],[-.8,1.1,-2.41]);report.mixingSnapshot=true;}
     if(s.phase==='construction'&&s.workStep==='bucket-cart'&&!report.cartSnapshot){await aim([1.9,1.65,-1.2],[-1.15,.8,.25]);await snap('08-cart-fill');await aim([2.8,1.65,-1.45],[-.8,1.1,-2.41]);report.cartSnapshot=true;}
     if(s.phase==='construction'&&s.workStep==='wall-mortar'&&s.workCursor>6&&s.workContactReady&&!report.mortarSnapshot){
       report.contactEvidence=await page.evaluate(()=>{const a=window.__wireTheHouse.apprentice,t=a.workTools.get('trowel'),target=a.workTargets[a.workCursor];return{gripReachM:a.workGripReachM,tipErrorM:t.localToWorld(new t.position.constructor().fromArray(t.userData.tipPoint)).distanceTo(target),targetRangeM:a.workTargetRangeM};});
       assert.ok(report.contactEvidence.tipErrorM<.005,JSON.stringify(report.contactEvidence));
       await aim([.2,1.65,-.7],[-.8,1.2,-2.41]);await snap('09-mortar');await aim([2.8,1.65,-1.45],[-.8,1.1,-2.41]);report.mortarSnapshot=true;
     }
     if(s.phase==='construction'&&s.workStep==='wall-box'&&!report.boxSnapshot){
       assert.ok(await page.evaluate(()=>{const a=window.__wireTheHouse.apprentice;return a.workTool==='box'&&a.stagedBoxes?.visible;}),'worker should carry the confirmed assembly to the wall');
       await aim([.2,1.65,-.7],[-.8,1.2,-2.41]);await snap('10-boxes');await aim([2.8,1.65,-1.45],[-.8,1.1,-2.41]);report.boxSnapshot=true;
     }
     if(s.phase==='done'||s.phase==='blocked')break;
   }
   await aim([.15,1.65,-.65],[-.8,1.1,-2.41]);await snap('07-result');
   report.apprentice=await page.evaluate(()=>window.__wireTheHouse.apprentice.telemetry);
   report.material=await page.evaluate(()=>{const g=window.__wireTheHouse;return{cart:g.mixing.wheelbarrow.telemetry,drum:g.mixing.drum.telemetry,batch:g.mixing.batch.getState(),mortar:g.mortar.telemetry,boxes:g.boxPlacement.telemetry};});
   assert.equal(report.apprentice.phase,'done',JSON.stringify(report.apprentice));
   assert.ok(report.apprentice.removedVolume>0);
   assert.ok(report.material.cart.massKg>0);
   assert.ok(report.material.boxes.some(box=>box.visible&&box.secured));
   if(!wallContactOnly){
     assert.ok(Math.abs(report.material.cart.massKg+report.material.cart.consumedKg+report.material.drum.batch.massKg-115.896)<.02,'mixed, carried and applied mass must be conserved');
     assert.ok(Math.abs(report.material.cart.consumedKg-report.material.mortar.launchedKg)<.001,'wall material must originate from cart');
   }
   assert.ok(report.contactEvidence?.tipErrorM<.005,'worker trowel tip must contact mortar target');
   await page.keyboard.press('v');await step(3);await snap('11-plan');
   assert.equal(await page.evaluate(()=>window.__wireTheHouse.apprentice.mode),'plan');
   report.checks.push(wallContactOnly?'Focused wall contact and bonded boxes after fixture cart fill':`T / highlight / live box layout / confirmation / demolition / finite mixing${fastBatch?' (intermediate doses accelerated)':''} / cart filling / mortar / bonded boxes / V plan`);
 }
 assert.deepEqual(report.errors,[]);
} finally {await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({baseline,errors:report.errors,checks:report.checks}));
