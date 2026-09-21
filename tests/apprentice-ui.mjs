import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
const baseline=process.argv.includes('--baseline');
const out=`output/apprentice/${baseline?'before':'after'}`;
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={baseline,errors:[],checks:[]};
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
   // Move the player aside so the apprentice has a clear, physical work area.
   await aim([.15,1.65,-.65],[-.8,1.1,-2.41]);
   for(let i=0;i<500;i++){
     await step(12);
     const s=await page.evaluate(()=>window.__wireTheHouse.apprentice.telemetry);
     if(i===7){await aim([-.1,1.65,1.65],[.8,.8,.55]);await snap('05b-pickup');}
     if(i===18){await aim([.15,1.65,-.65],[-.8,1.1,-2.41]);await snap('05c-carry');}
     if(i===40){
       await snap('06-working');
       report.workingPerformance=await page.evaluate(async()=>{
         const values=[],cpu=[];let last=performance.now();
         for(let n=0;n<100;n++){await new Promise(requestAnimationFrame);const t=performance.now();window.testStep(1/60);await window.__wireTheHouse.renderer.waitForFrame();if(n>15){values.push(t-last);cpu.push(performance.now()-t);}last=t;}
         const p=(a,q)=>[...a].sort((a,b)=>a-b)[Math.floor((a.length-1)*q)];
         return{frameMedianMs:p(values,.5),frameP95Ms:p(values,.95),frameMaxMs:Math.max(...values),framesOver50ms:values.filter(x=>x>50).length,submitP95Ms:p(cpu,.95),phase:window.__wireTheHouse.apprentice.phase};
       });
     }
     if(s.phase==='done'||s.phase==='blocked')break;
   }
   await snap('07-result');
   report.apprentice=await page.evaluate(()=>window.__wireTheHouse.apprentice.telemetry);
   assert.equal(report.apprentice.phase,'done',JSON.stringify(report.apprentice));
   assert.ok(report.apprentice.removedVolume>0);
   await page.keyboard.press('v');await step(3);await snap('08-plan');
   assert.equal(await page.evaluate(()=>window.__wireTheHouse.apprentice.mode),'plan');
   report.checks.push('T / highlight / live box layout / confirmation / real demolition / V plan');
 }
 assert.deepEqual(report.errors,[]);
} finally {await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({baseline,errors:report.errors,checks:report.checks}));
