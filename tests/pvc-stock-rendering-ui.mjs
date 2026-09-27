import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { blockPointerLock } from './browser-safety.mjs';
import { serveTaskBuild } from './serve-task-build.mjs';
const {launchManagedBrowser,runManagedClient}=await import(pathToFileURL(path.join(process.env.CODEX_HOME??path.join(os.homedir(),'.codex'),'skills/develop-web-game/scripts/browser_lifecycle.mjs')));

const baseline=process.argv.includes('--baseline');
const url=process.env.GAME_URL??'http://127.0.0.1:5365/Electrical-Game/'+(process.argv.includes('--webgl')?'?renderer=webgl':'');
const out=process.env.PVC_RENDER_OUT??`output/pvc-stock-rendering/${baseline?'before':'after'}`;
await mkdir(out,{recursive:true});
const report={baseline,errors:[],failures:[],cases:[],physicalPhone:false};
const session=await launchManagedBrowser(chromium,{channel:'chrome',headless:true,screenshotDir:out});
const check=(condition,label)=>{if(!condition)report.failures.push(label);};
await runManagedClient(session,180000,async()=>{
 try{
  for(const viewport of [{width:904,height:1222},{width:390,height:844}]){
   const name=viewport.width===390?'touch':'desktop';
   const context=await session.browser.newContext({viewport,isMobile:name==='touch',hasTouch:name==='touch'});
   await blockPointerLock(context);await serveTaskBuild(context,'http://127.0.0.1:5365/Electrical-Game/');
   const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
   await page.goto(url);
   await page.locator('#apprentice-count').selectOption('0');
   await page.locator('#start-button').click({timeout:60000});
   await page.waitForFunction(()=>window.__wireTheHouse.started);
   await page.locator('#start-screen').waitFor({state:'hidden'});
   await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.workerBody.ready;window.pvcRenderStep=g.step.bind(g);g.step=()=>{};g.player.update=()=>{};});
   const step=count=>page.evaluate(count=>{for(let i=0;i<count;i++)window.pvcRenderStep(1/60);},count);
   const key=async key=>{await page.keyboard.down(key);await step(2);await page.keyboard.up(key);await step(2);};
   const front=async(index=0)=>{await page.evaluate(index=>{const g=window.__wireTheHouse,c=g.renderer.camera,z=g.pvc.stock.bundleCenter(index).z;c.position.set(2.3,1.55,z);c.lookAt(3.6,1.55,z);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;c.updateMatrixWorld(true);g.workerBody.visible=false;g.fpsRig.visible=false;g.pvc.renderUI();},index);};
   const snapshot=async label=>{
    await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});
    const png=await page.screenshot({path:`${out}/${name}-${label}.png`});
    return page.evaluate(async src=>{const img=new Image();img.src=src;await img.decode();const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);const {data}=ctx.getImageData(0,0,canvas.width,canvas.height);let colorPixels=0;for(let y=Math.floor(canvas.height*.16);y<canvas.height*.80;y++)for(let x=Math.floor(canvas.width*.43);x<canvas.width*.57;x++){const i=(y*canvas.width+x)*4,r=data[i],g=data[i+1],b=data[i+2];if((r>150&&g>140&&b<140)||(r<130&&g>100&&b>130))colorPixels++;}return colorPixels;},'data:image/png;base64,'+png.toString('base64'));
   };
   await front();await snapshot('sealed'); // Compile the real standing outline before moving it.
   await key('KeyE');await step(130);
   check(await page.evaluate(()=>window.__wireTheHouse.pvc.phase==='loose'),`${name}: cut-ties completes`);
   await front();await key('KeyE');await step(110);
   check(await page.evaluate(()=>window.__wireTheHouse.pvc.phase==='marking'),`${name}: lay-down reaches marking`);
   if(name==='touch'){await page.locator('[data-pvc="transparent"]').evaluate(e=>e.click());await step(2);}else await key('KeyR');
   const materials=await page.evaluate(()=>{const p=window.__wireTheHouse.pvc;return{working:p.pipe.material.opacity,stock:p.stock.stockBarrels.material.opacity,depthWrite:p.stock.stockBarrels.material.depthWrite,prepared:p.prepared.map(item=>item.mesh.material.opacity)};});
   check(materials.working===.4,`${name}: working pipe retains transparency`);
   check(materials.stock===1&&materials.depthWrite,`${name}: transparency cannot leak into stock`);
   await page.evaluate(()=>window.__wireTheHouse.pvc.pause());await step(2);await front();
   const ghostPixels=await snapshot('laid-transparent');
   check(ghostPixels<150,`${name}: upright outline remains after lay-down (${ghostPixels} pixels)`);
   // Put a real bent batch back into stock while the working transparency is on.
   await page.evaluate(()=>{const g=window.__wireTheHouse,p=g.pvc,c=g.renderer.camera,s=p.stock,V=c.position.constructor;for(let cell=0;cell<8;cell++){if(cell)p.bend.move(1);p.bend.press(1);}p.quantity=3;p.phase='extracting';p.elapsed=2;p.animate(0);c.position.copy(s.sitePoint(2.2,.025,1.75)).add(new V(0,.9,.6));c.lookAt(s.sitePoint(2.2,.025,1.75));c.updateMatrixWorld(true);p.interact();});
   const batch=await page.evaluate(()=>{const p=window.__wireTheHouse.pvc;return{raw:p.rawCount,prepared:p.prepared.length,carrying:Boolean(p.carried),total:p.telemetry.totalAll,opacities:p.prepared.map(item=>item.mesh.material.opacity)};});
   check(batch.total===100&&batch.raw===17&&batch.prepared===3&&!batch.carrying,`${name}: produced/returned batch conserves all 100 pipes`);
   check(batch.opacities.every(value=>value===1),`${name}: returned prepared pipes retain opaque inventory material`);
   await front(4);await snapshot('reserve-sealed');await key('KeyE');await step(130);await front(4);await key('KeyE');await step(110);
   check(await page.evaluate(()=>window.__wireTheHouse.pvc.activeBundle===4&&window.__wireTheHouse.pvc.phase==='marking'),`${name}: reserve bundle follows its own lay-down workflow`);
   await page.evaluate(()=>window.__wireTheHouse.pvc.pause());await step(2);await front(4);
   const reserveGhostPixels=await snapshot('reserve-laid');
   check(reserveGhostPixels<150,`${name}: reserve outline remains after lay-down (${reserveGhostPixels} pixels)`);
   await page.evaluate(()=>{const g=window.__wireTheHouse,p=g.pvc;p.focused=false;p.phase='batch';const stock=p.stock,c=g.renderer.camera,V=c.position.constructor;c.position.copy(stock.sitePoint(2.2,.025,1.75)).add(new V(0,.9,.6));c.lookAt(stock.sitePoint(2.2,.025,1.75));g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;});await step(3);await snapshot('floor-stock');
   const performance=await page.evaluate(async()=>{
    const g=window.__wireTheHouse,r=g.renderer,samples=[],intervals=[],draw=r.drawScene.bind(r);let frameCount=0,last,resources;
    r.drawScene=function(scene){draw(scene);resources={calls:r.webgl.info.render.calls,triangles:r.webgl.info.render.triangles,textures:r.webgl.info.memory.textures};};
    g.step=function(...args){const start=performance.now();window.pvcRenderStep(...args);if(frameCount>45)samples.push(performance.now()-start);};
    try{await new Promise(resolve=>{const frame=now=>{if(frameCount>45&&last)intervals.push(now-last);last=now;if(++frameCount<150)requestAnimationFrame(frame);else resolve();};requestAnimationFrame(frame);});await r.waitForFrame();}
    finally{g.step=()=>{};r.drawScene=draw;}
    samples.sort((a,b)=>a-b);intervals.sort((a,b)=>a-b);
    return{environment:'Windows Chrome, real rendering, 45 warmup + 105 sampled animation frames; touch is PC emulation',simulationMeanMs:samples.reduce((a,b)=>a+b,0)/samples.length,simulationP95Ms:samples[Math.floor(samples.length*.95)],frameP95Ms:intervals[Math.floor(intervals.length*.95)],frameMaxMs:intervals.at(-1),over50ms:intervals.filter(ms=>ms>50).length,...resources};
   });
   const telemetry=JSON.parse(await page.evaluate(()=>window.render_game_to_text()));
   report.cases.push({name,viewport,materials,ghostPixels,reserveGhostPixels,batch,performance,telemetry});
   await context.close();
  }
  assert.equal(report.errors.length,0,report.errors.join('\n'));
  assert.equal(report.failures.length,0,report.failures.join('\n'));
 }finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
});
console.log(JSON.stringify({out,cases:report.cases.map(({name,ghostPixels,performance})=>({name,ghostPixels,performance})),errors:report.errors,failures:report.failures}));
