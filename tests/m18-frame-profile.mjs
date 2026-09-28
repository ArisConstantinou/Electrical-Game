import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {blockPointerLock} from './browser-safety.mjs';
import {routeBuildingDist} from './building-qa-utils.mjs';

const report={metric:'Wall time from submitting a real rendered frame through the existing GPU completion fence; sequential runs on the same desktop. Simulation is stationary. Touch sizes emulate viewports.',rows:[],errors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const baseline of [true,false])for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1366,height:768},hasTouch:mobile,isMobile:mobile});await blockPointerLock(context);if(!baseline)await routeBuildingDist(context);
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.goto('http://127.0.0.1:5365/Electrical-Game/');await page.locator('#apprentice-count').selectOption('0');await page.locator('#start-button').click({timeout:120000});
  await page.evaluate(()=>{const g=window.__wireTheHouse;window.profileStep=g.step.bind(g);g.step=()=>{};g.mixing.finished=true;g.mixing.setActive(false);});
  for(const kind of ['drill','driver']){
   await page.keyboard.press(kind==='drill'?'Digit0':'KeyB');
   const row=await page.evaluate(async kind=>{
    const g=window.__wireTheHouse,r=g.renderer;for(let i=0;i<15;i++)window.profileStep(1/60,0,false);
    await r.waitForFrame();
    for(let i=0;i<8;i++){r.render();await r.waitForFrame();}
    const samples=[],calls=[],triangles=[];
    for(let attempts=0;samples.length<45&&attempts<150;attempts++){await r.waitForFrame();const started=performance.now(),submitted=r.render();await r.waitForFrame();if(!submitted||r.webgl.info.render.calls===0)continue;samples.push(performance.now()-started);calls.push(r.webgl.info.render.calls);triangles.push(r.webgl.info.render.triangles);}
    if(samples.length!==45)throw new Error('Could not collect 45 completed rendered frames');
    samples.sort((a,b)=>a-b);return{kind,meanMs:samples.reduce((a,b)=>a+b)/samples.length,p95Ms:samples[Math.floor(samples.length*.95)],maxMs:samples.at(-1),over50ms:samples.filter(t=>t>50).length,calls:{min:Math.min(...calls),max:Math.max(...calls)},triangles:{min:Math.min(...triangles),max:Math.max(...triangles)},backend:r.gpu.backend.device?'WebGPU':r.gpu.backend.constructor.name,device:r.gpu.backend.device?.adapterInfo?Object.fromEntries(['vendor','architecture','device','description'].map(k=>[k,r.gpu.backend.device.adapterInfo[k]])):null,lifecycle:r.lifecycleTelemetry};
   },kind);report.rows.push({baseline,mobile,...row});assert.equal(row.over50ms,0,'No >50 ms rendered frame in these short matched scenes');
  }
  await context.close();
 }
 assert.deepEqual(report.errors,[]);
}finally{await browser.close();await writeFile('output/m18-tools/frame-profile.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify(report));
