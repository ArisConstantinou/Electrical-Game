import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {blockPointerLock} from './browser-safety.mjs';
import {routeBuildingDist} from './building-qa-utils.mjs';
const {launchManagedBrowser,runManagedClient}=await import(pathToFileURL(path.join(process.env.CODEX_HOME??path.join(os.homedir(),'.codex'),'skills/develop-web-game/scripts/browser_lifecycle.mjs')));
const out=path.resolve('output/benchmark-faults');await mkdir(out,{recursive:true});
const session=await launchManagedBrowser(chromium,{channel:'chrome',headless:true,screenshotDir:out});
await runManagedClient(session,180000,async()=>{
 for(const unavailable of [false,true]){
  const context=await session.browser.newContext({viewport:{width:430,height:745},isMobile:true,hasTouch:true});await blockPointerLock(context);await routeBuildingDist(context);
  if(unavailable)await context.addInitScript(()=>{Object.defineProperty(PerformanceObserver,'supportedEntryTypes',{configurable:true,value:[]});Object.defineProperty(performance,'memory',{configurable:true,value:undefined});});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:5365/Electrical-Game/perf/?renderer=webgl');await page.locator('#begin').click();await page.waitForFunction(()=>window.performanceRecording.tour,null,{timeout:120000});await page.waitForTimeout(1500);
  const child=page.frames().find(f=>f.parentFrame());await child.evaluate(()=>{
   const g=window.__wireTheHouse,original=g.player.update;let fired=false;
   g.player.update=function(...args){if(!fired){fired=true;const until=performance.now()+180;while(performance.now()<until){}}return original.apply(this,args);};
   setTimeout(()=>{throw new Error('BENCHMARK_EXPECTED_ERROR');},200);
   const broken=new Image();broken.src='./missing-benchmark-evidence.jpg';document.body.append(broken);
  });await page.waitForTimeout(2500);await page.locator('#stop').click();
  const report=await page.evaluate(()=>window.performanceRecording.report);await writeFile(path.join(out,unavailable?'unavailable.json':'faults.json'),JSON.stringify(report,null,2));await page.screenshot({path:path.join(out,unavailable?'unavailable-results.png':'fault-results.png')});
  assert(report.errors.some(e=>e.includes('BENCHMARK_EXPECTED_ERROR')));assert(report.errors.some(e=>e.includes('missing-benchmark-evidence.jpg')));assert(report.findings.some(f=>f.type==='cpu-heavy'&&f.evidence.cpuMs>=180));assert(report.findings.some(f=>f.type==='coverage'));assert(!report.coverage.complete);assert(!report.functional.complete);assert.equal(report.functional.checks.length,0);assert.equal(report.tour.completed,false);assert(report.overhead.recorderCpuMs>0);
  if(unavailable){assert.equal(report.support.longTasks,'unavailable');assert.equal(report.support.jsHeap,'unavailable');assert.equal(report.mainThread.tasks.length,0);}else assert(report.mainThread.tasks.some(t=>t.durationMs>=180));
  assert.deepEqual(errors.filter(e=>!e.includes('BENCHMARK_EXPECTED_ERROR')),[]);await context.close();
 }
});
console.log('Actual CPU blocking, runtime exception, failed image load, incomplete coverage, supported/unsupported observers and measured recorder overhead passed');
