import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {routeBuildingDist} from './building-qa-utils.mjs';
import {blockPointerLock} from './browser-safety.mjs';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
const {launchManagedBrowser}=await import(pathToFileURL(path.join(os.homedir(),'.codex/skills/develop-web-game/scripts/browser_lifecycle.mjs')).href);
const out='output/directional-jump/performance';await mkdir(out,{recursive:true});
const session=await launchManagedBrowser(chromium,{channel:'chrome',headless:true,screenshotDir:out}),report=[];
try{
 for(const stage of ['before','after'])for(const [name,width,height,mobile] of [['desktop',1366,768,false],['phone',390,844,true]]){
  const context=await session.browser.newContext({viewport:{width,height},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1});await blockPointerLock(context);
  if(stage==='after')await routeBuildingDist(context);
  else await context.route('http://127.0.0.1:5365/Electrical-Game/**',async route=>{
   const file=decodeURIComponent(new URL(route.request().url()).pathname).slice('/Electrical-Game/'.length)||'index.html';
   const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.svg':'image/svg+xml','.glb':'model/gltf-binary','.wasm':'application/wasm'};
   let body;try{body=await readFile(path.resolve('output/directional-jump/before-dist',file));}catch{try{body=await readFile(path.resolve('dist',file));}catch{return route.fulfill({status:404,body:'Missing '+file});}}
   await route.fulfill({body,contentType:mime[path.extname(file)]??'application/octet-stream'});
  });
  const page=await context.newPage();await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart&&!document.querySelector('#start-button')?.disabled,null,{timeout:120000});await page.locator('#apprentice-count').selectOption('0');await page.locator('#start-button').click();
  await page.evaluate(()=>{const g=window.__wireTheHouse,p=g.player;g.selectTool('spray');p.camera.position.set(23,1.65,-14);p.yaw=-.65;p.pitch=-.22;});await page.waitForTimeout(600);
  const sample=await page.evaluate(async()=>{
   const g=window.__wireTheHouse,r=g.renderer,draw=r.drawScene,step=g.step,frames=[],cpu=[];let previous=null;
   const gl=r.gpu.backend?.gl,ext=gl?.getExtension('WEBGL_debug_renderer_info');
   const gpu=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unavailable';
   let finish,timer;
   try{
    await new Promise((resolve,reject)=>{finish=resolve;timer=setTimeout(()=>reject(new Error('Rendered frame sample timed out')),20000);
     g.step=function(...args){const t=performance.now(),value=step.apply(this,args);cpu.push(performance.now()-t);return value;};
     r.drawScene=function(...args){const value=draw.apply(this,args),t=performance.now();if(previous!==null)frames.push(t-previous);previous=t;if(frames.length>=120)finish();return value;};
    });
   }finally{clearTimeout(timer);r.drawScene=draw;g.step=step;}
   const summary=a=>{const s=a.slice(10).sort((a,b)=>a-b);return{medianMs:s[Math.floor(s.length*.5)],p95Ms:s[Math.floor(s.length*.95)],maxMs:Math.max(...s),over50Ms:s.filter(x=>x>50).length};};
   return{measurement:'drawScene completion intervals, not physical display presentation',rendered:summary(frames),simulation:summary(cpu),fps:1000/(frames.slice(10).reduce((a,b)=>a+b,0)/frames.slice(10).length),gpu,cpuThreads:navigator.hardwareConcurrency,width:innerWidth,height:innerHeight,pixelRatio:devicePixelRatio,drawCalls:r.gpu.info.render.calls,triangles:r.gpu.info.render.triangles,geometries:r.gpu.info.memory.geometries,textures:r.gpu.info.memory.textures,renderError:r.renderError,waterVisible:r.waterWasVisible};
  });assert.equal(sample.renderError,'');report.push({stage,name,sample});await page.screenshot({path:`${out}/${stage}-${name}.png`});await context.close();
 }
}finally{await session.cleanup();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));
