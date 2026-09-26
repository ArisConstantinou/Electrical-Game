import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,writeFile,readFile,stat,readdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {blockPointerLock} from './browser-safety.mjs';
import {routeBuildingDist} from './building-qa-utils.mjs';
const out='output/building-performance';await mkdir(out,{recursive:true});
const builtAt=(await stat('dist/index.html')).mtimeMs;
for(const file of await readdir('src',{recursive:true})){
 if(file.endsWith('.ts')&&(await stat(path.join('src',file))).mtimeMs>builtAt)
  throw new Error(`Benchmark deferred: source ${file} changed after the candidate build. Rebuild before measuring.`);
}
const baseline=process.env.QA_PERFORMANCE_BASELINE??'output/performance-pre-cache-dist';
const result={environment:'Windows Chrome headless; Intel Core Ultra 9 285K, RTX 5080 available; browser backend reported per case. Mobile/tablet are emulation, not physical devices.',baseline,method:'Same local-origin production builds, five apprentices, warmup then live simulation and turning. One sample per presented game step; physics substeps do not count as images. Baseline contains the same approved building and SDS changes before performance repairs. No visual quality reduction.',runs:[],errors:[]};
const afterOnly=process.argv.includes('--after-only');
if(afterOnly){const previous=JSON.parse(await readFile(`${out}/report.json`,'utf8'));result.runs=previous.runs.filter(r=>r.version==='before');result.method+=' Baseline retained from the earlier run against the same unmodified baseline build.';}
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const profile of ['desktop-webgl','desktop-webgpu','portrait-webgl','tablet-webgl'])for(const version of ['before','after']){
  if(afterOnly&&version==='before')continue;
  const mobile=profile.startsWith('portrait')||profile.startsWith('tablet'),viewport=profile.startsWith('tablet')?{width:1180,height:820}:mobile?{width:390,height:844}:{width:1366,height:768};
  const context=await browser.newContext({viewport,deviceScaleFactor:mobile?2:1,isMobile:mobile,hasTouch:mobile});await blockPointerLock(context);
  await routeBuildingDist(context,path.resolve(version==='before'?baseline:'dist'));
  const page=await context.newPage();page.on('pageerror',e=>result.errors.push(`${profile} ${version}: ${e.message}`));
  await page.addInitScript(()=>{window.__longTasks=[];new PerformanceObserver(list=>window.__longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});});
  const began=Date.now();await page.goto(`http://127.0.0.1:5365/Electrical-Game/${profile.endsWith('webgl')?'?renderer=webgl':''}`);
  await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart&&!document.querySelector('#start-button')?.disabled,null,{timeout:120000});
  const readyMs=Date.now()-began;await page.locator('#apprentice-count').selectOption('5');await page.locator('#start-button').click();
  const run={profile,version,readyMs,viewport,cases:[],loadLongTasks:await page.evaluate(()=>({count:window.__longTasks.length,maxMs:Math.max(0,...window.__longTasks.map(e=>e.duration))}))};result.runs.push(run);
  for(const pose of [
   {name:'original-workroom',x:0,z:2,y:1.65,yaw:0},
   {name:'foyer-stairs',x:3.8,z:8.5,y:1.65,yaw:-1.5},
   {name:'courtyard',x:12,z:14.4,y:1.65,yaw:1.8},
   {name:'L2-main-room',x:7.5,z:2.75,y:8.25,yaw:-1.0},
   {name:'L4-room',x:7.5,z:2.75,y:14.85,yaw:-1.0},
   {name:'B1-workshop',x:11,z:2.2,y:-1.75,yaw:-1.0},
   {name:'B2-store',x:11,z:2.2,y:-5.15,yaw:-1.0},
   {name:'exterior',x:23,z:-14,y:1.65,yaw:2.54},
   {name:'wet-workroom',x:0,z:2,y:1.65,yaw:0,wet:true},
  ]){
   await page.evaluate(p=>{const g=window.__wireTheHouse;g.player.camera.position.set(p.x,p.y,p.z);g.player.yaw=p.yaw;g.player.pitch=.15;g.selectedTool='spray';g.fpsRig.show('spray');},pose);
   if(pose.wet){
    const activate=Date.now();await page.evaluate(async()=>{const g=window.__wireTheHouse;g.roomWater.addFloorWater(0,0,12);await g.activateWaterPro();});
    run.waterActivationMs=Date.now()-activate;
   }
   await page.waitForTimeout(pose.wet?3000:1200);
   const sample=await page.evaluate(async p=>{
    const g=window.__wireTheHouse,r=g.renderer,times=[],cpu=[],calls=[],triangles=[];let previous=0,pendingCpu=0;
    const old=g.step,start=performance.now();
    g.step=function(...args){const now=performance.now();g.player.yaw=p.yaw+Math.sin((now-start)*.0018)*.6;const v=old.apply(this,args);pendingCpu+=performance.now()-now;if(args[2]!==false){if(previous)times.push(now-previous);previous=now;cpu.push(pendingCpu);pendingCpu=0;calls.push(r.webgl.info.render.calls);triangles.push(r.webgl.info.render.triangles);}return v;};
    await new Promise(resolve=>setTimeout(resolve,p.wet?6000:3200));g.step=old;
    const stats=values=>{values.sort((a,b)=>a-b);return {mean:values.reduce((a,b)=>a+b,0)/Math.max(1,values.length),p95:values[Math.floor(values.length*.95)]??0,max:values.at(-1)??0};};
    const frame=stats(times),long=window.__longTasks.filter(e=>e.start>=start);
    const backend=r.webgl.backend;const gl=backend.gl;let gpu='WebGPU';if(gl){const ext=gl.getExtension('WEBGL_debug_renderer_info');gpu=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);}
    return {name:p.name,frames:times.length,fps:1000/frame.mean,frameMs:frame,simulationCpuMs:stats(cpu),longTasks:long.length,longTaskMaxMs:Math.max(0,...long.map(e=>e.duration)),drawCalls:Math.max(...calls),triangles:Math.max(...triangles),heapMB:performance.memory?.usedJSHeapSize/1048576,geometries:r.webgl.info.memory.geometries,textures:r.webgl.info.memory.textures,canvas:[r.webgl.domElement.width,r.webgl.domElement.height],gpu,error:r.renderError};
   },pose);
   run.cases.push(sample);assert.equal(sample.error,'');
   if(['exterior','foyer-stairs','original-workroom'].includes(pose.name)){
    await page.evaluate(p=>{const g=window.__wireTheHouse;g.player.yaw=p.yaw;g.player.pitch=.15;},pose);await page.waitForTimeout(250);
    await page.screenshot({path:`${out}/${profile}-${version}-${pose.name}.png`});
   }
   if(pose.name==='original-workroom')for(const detail of [{name:'ceiling',pitch:.8},{name:'floor',pitch:-.9}]){
    await page.evaluate(p=>{const g=window.__wireTheHouse;g.player.camera.position.set(2.8,1.65,10);g.player.yaw=-1.1;g.player.pitch=p.pitch;},detail);await page.waitForTimeout(250);
    await page.screenshot({path:`${out}/${profile}-${version}-${detail.name}.png`});
   }
  }
  await writeFile(`${out}/report.json`,JSON.stringify(result,null,2));await context.close();
 }
 assert.deepEqual(result.errors,[]);result.passed=true;
}finally{await writeFile(`${out}/report.json`,JSON.stringify(result,null,2));await browser.close();}
console.log(JSON.stringify(result.runs.map(r=>({profile:r.profile,version:r.version,readyMs:r.readyMs,worstP95:Math.max(...r.cases.map(c=>c.frameMs.p95)),minFps:Math.min(...r.cases.map(c=>c.fps))}))));
