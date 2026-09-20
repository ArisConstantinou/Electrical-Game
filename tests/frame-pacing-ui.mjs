import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';

const base=process.argv[2]??'http://127.0.0.1:5366/Electrical-Game/';
const baseline=process.argv[3];
const out=process.env.QA_OUTPUT??'output/frame-pacing';await mkdir(out,{recursive:true});
const report={base,baseline,viewport:{width:2560,height:1215},cases:[],errors:[]};
const browser=await chromium.launch({channel:'chrome',headless:false});
try{
 const context=await browser.newContext({viewport:report.viewport,deviceScaleFactor:1});
 await blockPointerLock(context);
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)));
 const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
 const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
 async function ready(url){await page.goto(url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__wireTheHouse&&!document.querySelector('#start-button').disabled,{timeout:90000});await page.bringToFront();await page.waitForTimeout(1000);}
 async function measure(name){
  const before=await metrics();
  const data=await page.evaluate(async()=>{
   const g=window.__wireTheHouse,original=g.renderer.render,times=[],start=performance.now();
   g.renderer.render=function(...args){const accepted=original.apply(this,args);if(accepted)times.push(performance.now());return accepted;};
   try{await new Promise(r=>setTimeout(r,4000));}finally{g.renderer.render=original;}
   const duration=performance.now()-start,gaps=times.slice(1).map((t,i)=>t-times[i]).sort((a,b)=>a-b);
   return{duration,fps:times.length*1000/duration,p95:gaps[Math.floor(gaps.length*.95)],max:gaps.at(-1),over50:gaps.filter(x=>x>50).length,started:g.started,hidden:document.hidden,backend:g.renderer.gpu.backend.constructor.name,drawCalls:g.renderer.gpu.info.render.drawCalls,triangles:g.renderer.gpu.info.render.triangles,allocations:g.renderer.gpu.info.memory.total,error:g.renderer.renderError};
  });
  const after=await metrics(),seconds=after.Timestamp-before.Timestamp;
  const result={name,...data,mainThreadBusyPercent:100*(after.TaskDuration-before.TaskDuration)/seconds,processCPUPercent24:100*(after.ProcessTime-before.ProcessTime)/seconds/24};
  report.cases.push(result);console.log(JSON.stringify(result));return result;
 }
 if(baseline){
  await ready(baseline);await page.screenshot({path:out+'/before-menu.png'});await measure('before-menu');
  await page.locator('#start-button').click();await page.waitForTimeout(1000);await measure('before-playing');await page.screenshot({path:out+'/before-playing.png'});
 }
 await ready(base);assert.equal(await page.locator('#frame-rate-limit').inputValue(),'60');
 await page.screenshot({path:out+'/after-menu.png'});const menu=await measure('after-menu');assert(menu.fps<=16&&menu.fps>=12,'Menu must run near 15 FPS');
 await page.locator('#start-button').click();await page.waitForTimeout(1000);
 for(const limit of ['60','120','0']){
  await page.locator('#settings-toggle').click();await page.locator('#frame-rate-limit').selectOption(limit);await page.locator('#settings-close').click();
  await page.waitForTimeout(300);const result=await measure('after-playing-'+limit);
  if(limit!=='0')assert(result.fps<=Number(limit)+2,`Exceeded ${limit} FPS cap`);
  assert(result.fps>20&&!result.error,'Game remains responsive without renderer errors');
  const before=await page.evaluate(()=>window.__wireTheHouse.renderer.camera.position.toArray());
  await page.keyboard.down('s');await page.waitForTimeout(650);await page.keyboard.up('s');
  const after=await page.evaluate(()=>window.__wireTheHouse.renderer.camera.position.toArray());
  result.movementM=Math.hypot(...after.map((v,i)=>v-before[i]));assert(result.movementM>.2,'Native held movement progresses');
 }
 // Explicit lifecycle-event coverage is separate from native tab switching.
 // This host's inspected Chrome pages keep document.hidden=false even when
 // another real tab is selected. Do not report this as a hidden-tab pass.
 report.nativeVisibility={verified:false,reason:'Inspected Chrome pages remained visible during real tab-switch and minimize probes, including a native-profile CDP connection.'};
 await page.evaluate(()=>document.dispatchEvent(new Event('freeze')));
 const frozen=await measure('after-freeze-event');assert.equal(frozen.fps,0,'Lifecycle suspension stops rendering');
 await page.evaluate(()=>document.dispatchEvent(new Event('resume')));
 await page.waitForFunction(()=>!window.__wireTheHouse.lifecyclePaused);
 await page.locator('#settings-toggle').click();await page.locator('#frame-rate-limit').selectOption('60');await page.locator('#settings-close').click();
 const resumed=await measure('after-resume');assert(resumed.fps>40&&resumed.fps<=62);
 // Held water action progresses through the ordinary real-time loop.
 const water=await page.evaluate(async()=>{const g=window.__wireTheHouse;g.selectTool('hose');const before=g.mortar.waterGunLitres;g.input.actionHeld=true;try{await new Promise(r=>setTimeout(r,1000));}finally{g.input.actionHeld=false;}return{before,after:g.mortar.waterGunLitres,error:g.renderer.renderError};});
 report.water=water;assert(water.after>water.before&&!water.error,'Held water action emits at the capped rate');
 await ready(base);assert.equal(await page.locator('#frame-rate-limit').inputValue(),'60','Saved setting survives reload');
 await page.locator('#start-button').click();await page.waitForTimeout(350);await page.screenshot({path:out+'/after-playing.png'});
 await page.locator('#settings-toggle').click();await page.screenshot({path:out+'/settings-desktop.png'});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'/settings-mobile.png'});
 report.mobile=await page.evaluate(()=>{const s=document.querySelector('#frame-rate-limit'),r=s.getBoundingClientRect();return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,control:{left:r.left,right:r.right,width:r.width},fontSize:getComputedStyle(s).fontSize};});
 assert(report.mobile.scrollWidth<=390&&report.mobile.control.left>=0&&report.mobile.control.right<=390,'Settings fit mobile viewport');
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure=String(error.stack??error);throw error;}
finally{await writeFile(out+'/report.json',JSON.stringify(report,null,2));await browser.close();}
