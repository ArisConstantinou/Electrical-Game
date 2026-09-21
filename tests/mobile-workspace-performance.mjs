import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {blockPointerLock} from './browser-safety.mjs';
const report={environment:'Chrome on Windows host. Mobile is viewport/touch emulation, not phone hardware. Warm frame intervals and CPU submission, not GPU timestamps.',cases:[],errors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{for(const [version,url] of [['published-before','https://arisconstantinou.github.io/Electrical-Game/'],['local-after','http://127.0.0.1:5365/Electrical-Game/']])for(const mobile of [false,true]){
 const context=await browser.newContext({viewport:mobile?{width:390,height:680}:{width:1366,height:900},isMobile:mobile,hasTouch:mobile});await blockPointerLock(context);
 const page=await context.newPage();await page.routeWebSocket('**',()=>{});page.on('pageerror',e=>report.errors.push(e.message));await page.goto(url+'?renderer=webgl');await page.locator('#start-button').click({timeout:120000});
 const sample=await page.evaluate(async()=>{
  const g=window.__wireTheHouse;await g.workerBody.ready;const step=g.step.bind(g);g.step=()=>{};g.mixing.setActive(false);g.pvc.transition('bending');g.pvc.setFocus();for(let i=0;i<90;i++)step(1/60,0,false);
  const cpu=[],frames=[],profile={};let last=performance.now();
  for(const [object,name]of [[g.workerBody,'posePipeGrip'],[g.workerBody,'fitThumb'],[g.workerBody,'update'],[g.pvc,'pose']])if(object[name]){const original=object[name].bind(object);profile[name]=[];object[name]=(...args)=>{const t=performance.now();const result=original(...args);profile[name].push(performance.now()-t);return result;};}
  for(let i=0;i<150;i++){await new Promise(requestAnimationFrame);const start=performance.now();g.pvc.bend.grip=Math.min(9,Math.floor(i/15));g.pvc.bend.press(1/60);step(1/60,0,false);g.renderer.render();await g.renderer.waitForFrame();if(i>=45){cpu.push(performance.now()-start);frames.push(start-last);}last=start;}
  const p95=a=>a.sort((a,b)=>a-b)[Math.floor(a.length*.95)],gl=g.renderer.webgl.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
  return{profileP95Ms:Object.fromEntries(Object.entries(profile).map(([key,times])=>[key,p95(times)])),cpuP95Ms:p95(cpu),frameP95Ms:p95(frames),frameMaxMs:Math.max(...frames),framesOver50ms:frames.filter(x=>x>50).length,calls:g.renderer.webgl.info.render.calls,triangles:g.renderer.webgl.info.render.triangles,geometries:g.renderer.webgl.info.memory.geometries,heap:performance.memory?.usedJSHeapSize,gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null,bodyVisible:g.workerBody.visible,script:document.querySelector('script[type=module]').src};
 });report.cases.push({version,mobile,...sample});assert(sample.frameP95Ms<50,version+' sustained frame delay');await context.close();
}assert.deepEqual(report.errors,[]);}finally{await mkdir('output/mobile-workspace',{recursive:true});await writeFile('output/mobile-workspace/performance.json',JSON.stringify(report,null,2));await browser.close();}console.log(JSON.stringify(report));
