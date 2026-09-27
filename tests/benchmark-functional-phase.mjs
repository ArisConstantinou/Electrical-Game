import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {blockPointerLock} from './browser-safety.mjs';
import {routeBuildingDist} from './building-qa-utils.mjs';
const {launchManagedBrowser,runManagedClient}=await import(pathToFileURL(path.join(process.env.CODEX_HOME??path.join(os.homedir(),'.codex'),'skills/develop-web-game/scripts/browser_lifecycle.mjs')));
const out=path.resolve('output/benchmark-functional-phase');await mkdir(out,{recursive:true});
const session=await launchManagedBrowser(chromium,{channel:'chrome',headless:true,screenshotDir:out});
await runManagedClient(session,180000,async()=>{
 const context=await session.browser.newContext({viewport:{width:430,height:745},isMobile:true,hasTouch:true});await blockPointerLock(context);await routeBuildingDist(context);
 // Test-local short route exercises the real phase transition without a
 // second long tour. It never establishes room coverage or performance gains.
 const source=await readFile('public/performance/tour.js','utf8'),needle='const route=createRoute(options);';assert(source.includes(needle));
 await context.route('**/performance/tour.js*',route=>route.fulfill({contentType:'text/javascript',body:source.replace(needle,"const route=[{x:0,z:2,floor:0,label:'Short test fixture',kind:'walk',phase:'performance',pass:1}];")}));
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:5365/Electrical-Game/?performance=1&renderer=webgl');await page.locator('#begin').click();await page.waitForFunction(()=>window.performanceRecording?.phase==='functional',null,{timeout:120000});
 const framesAtBoundary=await page.evaluate(()=>JSON.parse(window.render_game_to_text()).frames);await page.waitForFunction(()=>!window.performanceRecording?.active,null,{timeout:30000});
 const report=await page.evaluate(()=>window.performanceRecording?.report);await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await page.screenshot({path:path.join(out,'results.png')});
 assert.equal(report.outcome,'completed');assert.equal(report.coverage.complete,false);assert(report.findings.some(f=>f.type==='coverage'));assert(report.functional.complete);assert(report.functional.checks.every(c=>c.status==='passed'));assert.equal(report.samples.length,framesAtBoundary);assert(report.hud.samples.every(s=>s.phase==='performance'));assert(report.samples.every(s=>s.phase==='performance'));assert.deepEqual(errors,[]);assert.deepEqual(report.errors,[]);
 assert(await page.locator('#close').isVisible());await page.locator('#close').click();await page.locator('#start-performance-test').waitFor();
 console.log(JSON.stringify({passed:true,completedReturn:true,coverage:report.coverage.complete,functional:report.functional.checks.map(c=>c.status),performanceFrames:report.samples.length,method:'Short test-only route; no FPS claim'}));
});
