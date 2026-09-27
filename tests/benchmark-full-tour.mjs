import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {blockPointerLock} from './browser-safety.mjs';
import {routeBuildingDist} from './building-qa-utils.mjs';
const {launchManagedBrowser,runManagedClient}=await import(pathToFileURL(path.join(process.env.CODEX_HOME??path.join(os.homedir(),'.codex'),'skills/develop-web-game/scripts/browser_lifecycle.mjs')));
const out=path.resolve(process.env.QA_BENCH_OUTPUT??'output/benchmark-full-tour');await mkdir(out,{recursive:true});
const session=await launchManagedBrowser(chromium,{channel:'chrome',headless:true,screenshotDir:out});
await runManagedClient(session,1200000,async()=>{
 const context=await session.browser.newContext({viewport:{width:430,height:745},isMobile:true,hasTouch:true,deviceScaleFactor:3});await blockPointerLock(context);await routeBuildingDist(context);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(process.env.QA_BENCH_URL??'http://127.0.0.1:5365/Electrical-Game/perf/');await page.locator('#begin').click();await page.waitForFunction(()=>window.performanceRecording.tour,null,{timeout:120000});
 const waiting=page.waitForFunction(()=>!window.performanceRecording.active,null,{timeout:1100000});
 let complete=false;waiting.then(()=>complete=true,()=>complete=true);let lastIndex=-1;
 while(!complete){await page.waitForTimeout(30000);const state=await page.evaluate(()=>({phase:window.performanceRecording.phase,...window.performanceRecording.tour}));console.log(JSON.stringify({phase:state.phase,index:state.index,total:state.total,checkpoint:state.current?.label}));if(state.index>lastIndex){lastIndex=state.index;await page.screenshot({path:path.join(out,'tour-latest.png')});}}
 await waiting;const report=await page.evaluate(()=>window.performanceRecording.report);await writeFile(path.join(out,'report.json'),JSON.stringify({...report,testErrors:errors},null,2));await page.screenshot({path:path.join(out,'results.png')});
 console.log(JSON.stringify({outcome:report.outcome,rooms:report.coverage.verifiedRooms,spaces:report.coverage.expectedSpaces,checkpoints:report.tour.reached,fps:report.effectiveFPS,overhead:report.overhead,functional:report.functional.checks,support:report.support,errors}));
 assert.equal(report.recorderVersion,'4.0.2');assert.equal(report.outcome,'completed');assert.equal(report.tour.reached,report.tour.total);assert(report.coverage.complete);assert.equal(report.coverage.verifiedRooms,24);assert.equal(report.coverage.expectedSpaces,30);assert(report.visitComparison.every(v=>v.passes.every(p=>p.frames?.count>0)));assert(report.samples.every(s=>s.phase==='performance'));assert(report.functional.complete);assert.equal(report.functional.checks.length,6);assert(report.functional.checks.every(c=>c.status==='passed'));assert.deepEqual(errors,[]);assert.deepEqual(report.errors,[]);
});
