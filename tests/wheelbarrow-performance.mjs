import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {blockPointerLock} from './browser-safety.mjs';
const out='output/wheelbarrow-performance';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),report={errors:[],profiles:[]};
try{
 const context=await browser.newContext({viewport:{width:1366,height:768}});await blockPointerLock(context);const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');await page.locator('#start-button').click({timeout:120000});await page.waitForFunction(()=>window.__wireTheHouse.workerBody.loaded);
 report.profiles=await page.evaluate(async()=>{
  const g=window.__wireTheHouse,cart=g.mixing.wheelbarrow,step=g.step.bind(g),update=cart.update.bind(cart);g.step=()=>{};
  const stats=values=>{values.sort((a,b)=>a-b);return{mean:values.reduce((a,b)=>a+b)/values.length,p95:values[Math.floor(values.length*.95)],max:values.at(-1)};};
  const results=[],timings={};for(const name of ['poseCartHandles','fitThumb','setHandOrientation','limb']){const original=g.workerBody[name].bind(g.workerBody);g.workerBody[name]=(...args)=>{const t=performance.now();const result=original(...args);(timings[name]??=[]).push(performance.now()-t);return result;};}
  for(const phase of ['idle-controller-disabled','idle','driving','settled-spill']){
   for(const key of Object.keys(timings))timings[key]=[];cart.update=phase==='idle-controller-disabled'?()=>{}:update;
   if(phase==='driving')cart.enter();
   if(phase==='settled-spill'){cart.release();cart.state='flipped';cart.pitch=2.45;cart.roll=0;for(let i=0;i<300;i++)update(1/120);}
   for(let i=0;i<40;i++)step(1/60,0,false);
   const move=i=>{if(phase==='driving'){g.input.keys.delete('KeyW');g.input.keys.delete('KeyS');g.input.keys.add(i%40<20?'KeyW':'KeyS');}};
   const sim=[],controller=[];for(let i=0;i<180;i++){move(i);let t=performance.now();step(1/60,0,false);sim.push(performance.now()-t);t=performance.now();update(0);controller.push(performance.now()-t);}
   const frames=[],submit=[];let last=performance.now();for(let i=0;i<90;i++){move(i);await new Promise(requestAnimationFrame);let t=performance.now();frames.push(t-last);last=t;step(1/60,0,false);t=performance.now();g.renderer.render();submit.push(performance.now()-t);}
   g.input.keys.delete('KeyW');g.input.keys.delete('KeyS');const r=g.renderer.webgl;results.push({phase,methods:Object.fromEntries(Object.entries(timings).filter(([,v])=>v.length).map(([k,v])=>[k,{calls:v.length,...stats(v)}])),simulationMs:stats(sim),controllerPresentMs:stats(controller),rafFrameMs:stats(frames.slice(5)),renderSubmitMs:stats(submit),calls:r.info.render.calls,triangles:r.info.render.triangles,geometries:r.info.memory.geometries,textures:r.info.memory.textures,heapBytes:performance.memory?.usedJSHeapSize??null,parcels:cart.telemetry.parcels});
  }
  cart.state='parked';cart.pitch=cart.roll=0;cart.massKg=114;cart.parcels.length=0;update(0);cart.enter();g.player.pitch=-1.2;step(1/60,0,false);
  return results;
 });
 for(const p of report.profiles)assert(p.controllerPresentMs.p95<5,`${p.phase}: cart presentation exceeds 5ms CPU budget`);
 assert(report.profiles.find(p=>p.phase==='driving').simulationMs.p95<16.7,'Active cart simulation exceeds 60 Hz CPU frame budget');
 assert(report.profiles.at(-1).parcels<=240);
 await page.setViewportSize({width:390,height:844});await page.evaluate(async()=>{const g=window.__wireTheHouse;g.renderer.render();await g.renderer.waitForFrame();});await page.screenshot({path:`${out}/portrait.png`});
 report.portrait=await page.locator('#wheelbarrow-guide').evaluate(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,fontSize:getComputedStyle(e).fontSize};});assert(report.portrait.x>=0&&report.portrait.right<=390&&report.portrait.bottom<650);
 report.environment='Chrome headless, WebGL, this Windows PC. RAF pacing and CPU simulation/submission; not isolated GPU time or physical phone FPS. Disabled-controller baseline retains the same scene/assets.';
 assert.deepEqual(report.errors,[]);console.log(JSON.stringify(report,null,2));
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
