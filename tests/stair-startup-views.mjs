import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {routeBuildingDist} from './building-qa-utils.mjs';
import {blockPointerLock} from './browser-safety.mjs';
const {launchManagedBrowser,runManagedClient}=await import(pathToFileURL(path.join(os.homedir(),'.codex/skills/develop-web-game/scripts/browser_lifecycle.mjs')).href);
const out=path.resolve(process.env.QA_STARTUP_OUTPUT??'output/stair-startup-views');await mkdir(out,{recursive:true});
const report={environment:'Windows Chrome WebGPU; 430x745 DPR3, actual 752x1303 framebuffer; not a physical iPhone',cases:[],errors:[]};
const session=await launchManagedBrowser(chromium,{channel:'chrome',headless:true,screenshotDir:out});
await runManagedClient(session,240000,async()=>{
 for(const version of (process.env.QA_STARTUP_ORDER??'before,after').split(',')){
  const context=await session.browser.newContext({viewport:{width:430,height:745},deviceScaleFactor:3,isMobile:true,hasTouch:true});
  await routeBuildingDist(context,path.resolve(version==='before'?(process.env.QA_STARTUP_BASE??'output/mobile-stalls-baseline-dist'):'dist'));await blockPointerLock(context);
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push({version,message:e.message}));
  const began=Date.now();await page.goto('http://127.0.0.1:5365/Electrical-Game/');
  await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart,null,{timeout:120000});const readyMs=Date.now()-began;
  const initial=await page.evaluate(()=>{const g=window.__wireTheHouse;return {position:g.player.camera.position.toArray(),yaw:g.player.yaw,pitch:g.player.pitch,tool:g.selectedTool,waterLitres:g.roomWater.telemetry.floorLitres,progress:document.querySelector('#start-load-percent')?.value,backend:g.renderer.gpu.backend.isWebGLBackend?'webgl':'webgpu'};});
  assert.equal(initial.backend,'webgpu');assert.equal(initial.progress,'READY');assert.equal(initial.waterLitres,0);
  await page.locator('#apprentice-count').selectOption('5');await page.locator('#start-button').click();
  const cases=await page.evaluate(async()=>{
   const g=window.__wireTheHouse,r=g.renderer,poses=[{name:'ground-landing',x:6.5,y:3.3,z:11.6,yaw:0,pitch:-.6},{name:'L3-landing',x:6.5,y:9.9,z:11.6,yaw:-4.6,pitch:-.1}],results=[];
   for(const pose of poses){
    const original=r.render,step=g.step,times=[performance.now()],cpu=[],renders=[];
    g.player.camera.position.set(pose.x,pose.y,pose.z);g.player.yaw=pose.yaw;g.player.pitch=pose.pitch;
    r.render=function(...args){const t=performance.now(),v=original.apply(this,args);if(v){times.push(performance.now());renders.push(performance.now()-t);}return v;};
    g.step=function(...args){const t=performance.now(),v=step.apply(this,args);cpu.push(performance.now()-t);return v;};
    try{await new Promise(resolve=>setTimeout(resolve,2000));}finally{r.render=original;g.step=step;}
    const intervals=times.slice(1).map((t,i)=>t-times[i]).sort((a,b)=>a-b);
    results.push({name:pose.name,frames:intervals.length,maxMs:intervals.at(-1),p95Ms:intervals[Math.floor(intervals.length*.95)],over50Ms:intervals.filter(ms=>ms>50).length,maxCpuMs:Math.max(...cpu),maxRenderMs:Math.max(...renders),geometries:r.webgl.info.memory.geometries,actualCamera:g.player.camera.position.toArray()});
   }return results;
  });
  report.cases.push({version,readyMs,initial,scenes:cases});console.log(JSON.stringify(report.cases.at(-1)));await page.screenshot({path:path.join(out,version+'-L3.png')});await context.close();
 }
 assert.deepEqual(report.cases[0].initial,report.cases[1].initial,'Preparation must restore spawn, orientation, tool, water and loading completion exactly');assert.deepEqual(report.errors,[]);
});
await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
