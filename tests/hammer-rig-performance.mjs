import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
import {routeBuildingDist} from './building-qa-utils.mjs';
const out=process.env.QA_RIG_PERF_OUT??'output/new-rig/performance';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),report=[];
try{
 for(const candidate of [false,true]){
  const context=await browser.newContext({viewport:{width:1600,height:900}});await blockPointerLock(context);
  if(candidate)await routeBuildingDist(context);
  const page=await context.newPage();await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');
  await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart&&!document.querySelector('#start-button')?.disabled,null,{timeout:120000});
  await page.locator('#apprentice-count').selectOption('0');await page.locator('#start-button').click();await page.keyboard.press('Digit4');
  const sample=await page.evaluate(async()=>{
   const g=window.__wireTheHouse,c=g.player.camera,step=g.step.bind(g);g.step=()=>{};
   g.player.crouched=false;g.player.velocity.set(0,0,0);g.player.pitch=-.55;g.player.yaw=0;c.position.set(0,1.65,g.room.brickWall.volume.frontZ+1.08);
   g.hammerAutoSide=false;g.fpsRig.hammerHandedness='right';g.room.brickWall.chiselTiltDegrees=15;g.room.brickWall.chiselSideDegrees=-15;
   g.player.workPosition.locked=true;g.player.workPosition.released=false;g.player.workPosition.targetDistanceM=1.08;
   for(let i=0;i<90;i++)step(1/60,1/60,false);
   const body=g.workerBody,original=body.update.bind(body),bodyMs=[],frameMs=[];
   body.update=(...args)=>{const start=performance.now();original(...args);bodyMs.push(performance.now()-start);};g.step=step;
   await new Promise(resolve=>{let last=0,n=0;const tick=t=>{if(last&&n>30)frameMs.push(t-last);last=t;if(++n<271)requestAnimationFrame(tick);else resolve();};requestAnimationFrame(tick);});
   g.step=()=>{};body.update=original;await g.renderer.waitForFrame();g.renderer.render();await g.renderer.waitForFrame();
   const stats=a=>{a.sort((a,b)=>a-b);return {median:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],max:a.at(-1),count:a.length};};
   return {framesMs:stats(frameMs),bodyMs:stats(bodyMs),drawCalls:g.renderer.webgl.info.render.calls,triangles:g.renderer.webgl.info.render.triangles,rendererMemory:g.renderer.webgl.info.memory,heapBytes:performance.memory?.usedJSHeapSize,userAgent:navigator.userAgent,backend:g.renderer.webgl.backend.isWebGPUBackend?'WebGPU':'WebGL'};
  });
  report.push({candidate,...sample});console.log(JSON.stringify(report.at(-1)));await page.screenshot({path:`${out}/${candidate?'candidate':'baseline'}.png`});await context.close();
 }
}finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
