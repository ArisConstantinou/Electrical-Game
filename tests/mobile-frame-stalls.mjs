import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {routeBuildingDist} from './building-qa-utils.mjs';
import {blockPointerLock} from './browser-safety.mjs';
const {launchManagedBrowser,runManagedClient}=await import(pathToFileURL(path.join(os.homedir(),'.codex/skills/develop-web-game/scripts/browser_lifecycle.mjs')).href);
const backend=process.env.QA_BACKEND??'webgpu';
const out=path.resolve(process.env.QA_STALL_OUTPUT??`output/mobile-frame-stalls-${backend}`);await mkdir(out,{recursive:true});
const report={environment:'Windows Chrome headless, Core Ultra 9 285K / RTX 5080; touch emulation is not physical iPhone proof',backend,errors:[],cases:[]};
const session=await launchManagedBrowser(chromium,{channel:'chrome',headless:true,screenshotDir:out});
await runManagedClient(session,240000,async()=>{
 const context=await session.browser.newContext({viewport:{width:430,height:745},deviceScaleFactor:3,isMobile:true,hasTouch:true});
 await routeBuildingDist(context);await blockPointerLock(context);
 await context.route('**/__wire-house-mansion-level**',route=>route.fulfill({status:404,body:''}));
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 const origin=process.env.QA_STALL_URL??'http://127.0.0.1:5365/Electrical-Game/';
 const began=Date.now();await page.goto(`${origin}${backend==='webgl'?'?renderer=webgl':''}`);
 await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart,null,{timeout:120000});report.readyMs=Date.now()-began;
 report.actualBackend=await page.evaluate(()=>window.__wireTheHouse.renderer.gpu.backend.isWebGLBackend?'webgl':'webgpu');
 assert.equal(report.actualBackend,backend,'Verify the backend actually used by the browser');
 await page.locator('#apprentice-count').selectOption('5');await page.locator('#start-button').click();
 for(const pose of [{name:'landing',x:6.5,y:3.3,z:11.6,yaw:0,pitch:-.6},{name:'courtyard',x:13,y:1.7,z:12,yaw:-1.5,pitch:-.1},{name:'L3-landing',x:6.5,y:9.9,z:11.6,yaw:-4.6,pitch:-.1}]){
  const result=await page.evaluate(async pose=>{
   const g=window.__wireTheHouse,r=g.renderer,scene=r.scene,draw=r.drawScene,step=g.step,results=[];
   const update=scene.updateMatrixWorld;let visits=0;scene.updateMatrixWorld=function(...args){visits++;return update.apply(this,args);};
   g.player.camera.position.set(pose.x,pose.y,pose.z);g.player.yaw=pose.yaw;g.player.pitch=pose.pitch;
   try{
    for(const mode of ['original-traversal','shared-traversal','original-traversal','shared-traversal']){
     r.drawScene=mode==='original-traversal'?r.drawPreparedScene:draw;
     await new Promise(resolve=>setTimeout(resolve,700));
     const times=[],cpu=[],calls=[],triangles=[];const render=r.render,start=performance.now();visits=0;
     r.render=function(...args){const v=render.apply(this,args);if(v){times.push(performance.now());calls.push(this.webgl.info.render.calls);triangles.push(this.webgl.info.render.triangles);}return v;};
     g.step=function(...args){const t=performance.now();g.player.yaw=pose.yaw+Math.sin((t-start)*.0018)*.6;const v=step.apply(this,args);cpu.push(performance.now()-t);return v;};
     try{await new Promise(resolve=>setTimeout(resolve,3200));}finally{g.step=step;r.render=render;}
     const intervals=times.slice(1).map((t,i)=>t-times[i]).sort((a,b)=>a-b),mean=v=>v.reduce((a,b)=>a+b,0)/Math.max(1,v.length);
     results.push({mode,fps:1000/mean(intervals),p95Ms:intervals[Math.floor(intervals.length*.95)],maxMs:intervals.at(-1),over50Ms:intervals.filter(ms=>ms>50).length,cpuMs:mean(cpu),sceneTraversalsPerFrame:visits/times.length,maxCalls:Math.max(...calls),maxTriangles:Math.max(...triangles)});
    }
   }finally{r.drawScene=draw;g.step=step;scene.updateMatrixWorld=update;}
   return {name:pose.name,results,canvas:[r.gpu.domElement.width,r.gpu.domElement.height],lifecycle:r.lifecycleTelemetry};
  },pose);
  report.cases.push(result);console.log(JSON.stringify(result));
 }
 // Same exact posed scene for screenshots; no simulation or animation between
 // the two submissions. Both maps are regenerated from the identical casters.
 await page.evaluate(async()=>{const g=window.__wireTheHouse;cancelAnimationFrame(g.animationFrame);g.animationFrame=null;await g.renderer.waitForFrame();g.player.yaw=-1.5;g.player.pitch=-.1;g.player.camera.position.set(13,1.7,12);g.step(0,0,false);window.__qaSharedDraw=g.renderer.drawScene;g.renderer.drawScene=g.renderer.drawPreparedScene;g.room.invalidateSunShadow();g.renderer.render();await g.renderer.waitForFrame();});
 await page.screenshot({path:path.join(out,'courtyard-before.png')});
 await page.evaluate(async()=>{const g=window.__wireTheHouse;g.renderer.drawScene=window.__qaSharedDraw;g.room.invalidateSunShadow();g.renderer.render();await g.renderer.waitForFrame();});
 await page.screenshot({path:path.join(out,'courtyard-after.png')});
 report.bounds=await page.evaluate(()=>{
  const g=window.__wireTheHouse,b=g.masonryBatch,old=[],cached=[];let instances=0;
  for(const batch of b.batches){
   b.refreshBounds(batch);const box=batch.boundingBox.clone(),sphere=batch.boundingSphere.clone();batch.computeBoundingBox();batch.computeBoundingSphere();
   if(!batch.boundingBox.equals(box)||!batch.boundingSphere.equals(sphere))throw new Error('Real-site cached bounds disagree with original scan');
   instances+=batch.count;
  }
  for(let round=0;round<8;round++){
   let t=performance.now();for(const batch of b.batches){batch.computeBoundingBox();batch.computeBoundingSphere();}old.push(performance.now()-t);
   t=performance.now();for(const batch of b.batches)b.refreshBounds(batch);cached.push(performance.now()-t);
  }
  return {instances,batches:b.batches.length,geometryScanMs:old,cachedBoundsMs:cached,exactlyEqual:true};
 });
 assert(report.bounds.exactlyEqual);assert.deepEqual(report.errors,[]);
 await context.close();
});
await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({report:out,bounds:report.bounds,errors:report.errors}));
