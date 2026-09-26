import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {blockPointerLock} from './browser-safety.mjs';
import {serveTaskBuild} from './serve-task-build.mjs';
const base='http://127.0.0.1:5365/Electrical-Game/',out='output/sun-shadow-stability';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),report={cases:[],errors:[]};
try{for(const version of process.env.QA_SHADOW_BEFORE_ONLY?['before']:['before','after'])for(const backend of ['webgpu','webgl']){
 const context=await browser.newContext({viewport:{width:1280,height:720}});await blockPointerLock(context);await serveTaskBuild(context,base);
 if(version==='before')await context.route(base+'**',async route=>{
  const relative=decodeURIComponent(new URL(route.request().url()).pathname.slice(new URL(base).pathname.length))||'index.html';
  if(relative!=='index.html'&&!/\.(?:js|css)$/.test(relative))return route.fallback();
  const directory=resolve('output/performance-stable-1140/core'),path=resolve(directory,relative);assert(path.startsWith(directory+sep));
  let body;try{body=await readFile(path);}catch(e){if(e.code==='ENOENT')return route.fallback();throw e;}
  await route.fulfill({body,contentType:relative.endsWith('.js')?'text/javascript':relative.endsWith('.css')?'text/css':'text/html'});
 });
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push({version,backend,message:e.message}));await page.goto(base+'?renderer='+backend);
 await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart,undefined,{timeout:120000});await page.locator('#apprentice-count').selectOption('0');await page.locator('#start-button').click();
 await page.evaluate(async()=>{const g=window.__wireTheHouse;cancelAnimationFrame(g.animationFrame);g.animationFrame=null;await g.renderer.waitForFrame();});
 const samples=[];
 for(const x of [10.25,10.75,10.49,10.51,10.49,10.51,11.75]){
  samples.push(await page.evaluate(async x=>{
   const g=window.__wireTheHouse,c=g.player.camera,s=g.room.sun; c.position.set(x,1.65,12.25);g.player.yaw=1.8;g.player.pitch=.15;
   g.step(0);await g.renderer.waitForFrame();s.shadow.updateMatrices(s);
   const p=c.position.clone().set(13,0,11).project(s.shadow.camera);
   return {x,pixels:[(p.x+1)*s.shadow.mapSize.x/2,(p.y+1)*s.shadow.mapSize.y/2],target:s.target.position.toArray(),offset:s.position.clone().sub(s.target.position).toArray(),size:s.shadow.mapSize.toArray(),frustum:[s.shadow.camera.left,s.shadow.camera.right,s.shadow.camera.bottom,s.shadow.camera.top],error:g.renderer.renderError};
  },x));
  if(x===10.25||x===10.75)await page.screenshot({path:`${out}/${version}-${backend}-${x}.png`});
 }
 const residuals=samples.slice(1).flatMap((s,i)=>s.pixels.map((p,axis)=>{const delta=p-samples[i].pixels[axis];return Math.abs(delta-Math.round(delta));}));
 const result={version,backend,samples,maxFractionalTexel:Math.max(...residuals)};report.cases.push(result);
 if(version==='before')assert(result.maxFractionalTexel>.1,'Baseline must reproduce a sub-texel shadow-grid shift');
 else{
  assert(result.maxFractionalTexel<1e-7,'Moving the sun map must retain the same texel phase on stationary receivers');
  assert(samples.slice(2,6).every(s=>s.target.every((n,i)=>Math.abs(n-samples[1].target[i])<1e-8)),'Small movements around a bay boundary must not repeatedly rebuild the map');
 }
 for(const s of samples){assert.deepEqual(s.size,[1024,1024]);assert.deepEqual(s.frustum,[-8,8,-8,8]);assert.equal(s.error,'');s.offset.forEach((n,i)=>assert(Math.abs(n-samples[0].offset[i])<1e-8,'Sun direction must be preserved'));}
 await context.close();
}assert.deepEqual(report.errors,[]);report.passed=true;}finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify({passed:report.passed,cases:report.cases.map(c=>({version:c.version,backend:c.backend,maxFractionalTexel:c.maxFractionalTexel}))}));
