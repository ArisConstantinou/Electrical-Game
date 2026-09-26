import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {blockPointerLock} from './browser-safety.mjs';
import {serveTaskBuild} from './serve-task-build.mjs';
const base='http://127.0.0.1:5365/Electrical-Game/',out='output/renderer-queue-profile';await mkdir(out,{recursive:true});
const report={method:'Same real Chrome WebGPU runtime, 430x745 portrait, DPR3; native RAF and 8-second camera sweeps in foyer/courtyard. Desktop RTX5080, not physical iPhone performance.',versions:[],errors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const version of ['before','after']){
  const context=await browser.newContext({viewport:{width:430,height:745},deviceScaleFactor:3,isMobile:true,hasTouch:true});await blockPointerLock(context);await serveTaskBuild(context,base);
  if(version==='before')await context.route(base+'**',async route=>{
   const relative=decodeURIComponent(new URL(route.request().url()).pathname.slice(new URL(base).pathname.length))||'index.html';
   if(relative!=='index.html'&&!/\.(?:js|css)$/.test(relative))return route.fallback();
   const directory=resolve(process.env.QA_BASELINE_CORE??'output/encoder-previous/core'),path=resolve(directory,relative);assert(path.startsWith(directory+sep));
   let body;try{body=await readFile(path);}catch(error){if(error.code==='ENOENT')return route.fallback();throw error;}
   await route.fulfill({body,contentType:relative.endsWith('.js')?'text/javascript':relative.endsWith('.css')?'text/css':'text/html'});
  });
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push({version,message:e.message}));await page.goto(base);
  await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart,undefined,{timeout:120000});await page.locator('#start-button').tap();
  const result={version,scenes:[]};report.versions.push(result);
  await page.evaluate(()=>{
   const g=window.__wireTheHouse;window.__queueAudit={frames:[],cpu:[],calls:[],triangles:[],queued:[],long:[],spin:false};
   const a=window.__queueAudit,draw=g.renderer.drawScene;
   g.renderer.drawScene=function(...args){const start=performance.now(),v=draw.apply(this,args);a.frames.push(start);a.calls.push(this.webgl.info.render.calls);a.triangles.push(this.webgl.info.render.triangles);a.queued.push(this.lifecycleTelemetry.queuedFrames??0);return v;};
   const step=g.step;g.step=function(...args){const start=performance.now();if(a.spin)g.player.yaw+=args[0]*Math.PI/4;const v=step.apply(this,args);a.cpu.push(performance.now()-start);return v;};
   new PerformanceObserver(list=>a.long.push(...list.getEntries().map(e=>e.duration))).observe({entryTypes:['longtask']});
  });
  for(const pose of [{name:'foyer',x:3.8,z:8.5,yaw:-1.5},{name:'courtyard',x:12,z:14.4,yaw:1.8}]){
   await page.evaluate(p=>{const g=window.__wireTheHouse;g.player.camera.position.set(p.x,1.65,p.z);g.player.yaw=p.yaw;g.player.pitch=.15;},pose);await page.waitForTimeout(500);
   await page.evaluate(()=>{const a=window.__queueAudit;for(const key of ['frames','cpu','calls','triangles','queued','long'])a[key]=[];a.spin=true;a.start=performance.now();});await page.waitForTimeout(8000);
   const scene=await page.evaluate(name=>{
    const a=window.__queueAudit,r=window.__wireTheHouse.renderer;a.spin=false;const elapsed=performance.now()-a.start;
    const stats=values=>{const s=[...values].sort((a,b)=>a-b);return {p95:s[Math.floor(s.length*.95)]??0,max:s.at(-1)??0};};
    return {name,fps:a.frames.length/elapsed*1000,frames:a.frames.length,intervals:stats(a.frames.slice(1).map((t,i)=>t-a.frames[i])),cpu:stats(a.cpu),longTasks:stats(a.long),drawCalls:Math.max(...a.calls),triangles:Math.max(...a.triangles),maxQueued:Math.max(...a.queued),graphics:r.lifecycleTelemetry,canvas:[r.webgl.domElement.width,r.webgl.domElement.height],raf:window.__wireTheHouse.animationFrame,error:r.renderError};
   },pose.name);result.scenes.push(scene);assert(scene.frames>100&&scene.raf!==null&&scene.error==='','Motion must continue through the full scene sweep');if(version==='after')assert(scene.maxQueued<=2);
   await page.screenshot({path:`${out}/${version}-${pose.name}.png`});
  }
  await context.close();
 }
 assert.deepEqual(report.errors,[]);report.passed=true;
}finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify(report));
