import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {blockPointerLock} from './browser-safety.mjs';
const {launchManagedBrowser,runManagedClient}=await import(pathToFileURL(path.join(process.env.CODEX_HOME??path.join(os.homedir(),'.codex'),'skills/develop-web-game/scripts/browser_lifecycle.mjs')));
const out=path.resolve(process.env.QA_PUBLIC_OUTPUT??'output/benchmark-public-v4');await mkdir(out,{recursive:true});
const session=await launchManagedBrowser(chromium,{channel:'chrome',headless:true,screenshotDir:out});
await runManagedClient(session,180000,async()=>{
 const context=await session.browser.newContext({viewport:{width:430,height:745},isMobile:true,hasTouch:true,deviceScaleFactor:3});await blockPointerLock(context);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(process.env.QA_PUBLIC_URL??'https://arisconstantinou.github.io/Electrical-Game/perf/');assert.equal(await page.locator('#game').getAttribute('src'),null,'No game load before benchmark starts');await page.screenshot({path:path.join(out,'prompt.png')});await page.locator('#begin').tap();await page.waitForFunction(()=>window.performanceRecording.tour,null,{timeout:120000});await page.waitForTimeout(5000);
 const child=page.frames().find(f=>f.parentFrame());const hud=await child.evaluate(()=>['fps-counter','mobile-top-rail'].map(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect();return {id,visible:r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden',rect:r.toJSON()};}));const panel=await page.locator('#panel').boundingBox();assert(hud.every(h=>h.visible));assert(hud.every(h=>!(panel.x<h.rect.right&&panel.x+panel.width>h.rect.left&&panel.y<h.rect.bottom&&panel.y+panel.height>h.rect.top)));
 await page.screenshot({path:path.join(out,'tour.png')});await page.locator('#stop').tap();const report=await page.evaluate(()=>window.performanceRecording.report);await writeFile(path.join(out,'report.json'),JSON.stringify({...report,testErrors:errors},null,2));assert.equal(new URL(page.url()).pathname,'/Electrical-Game/perf/');assert.equal(report.schema,4);assert.equal(report.recorderVersion,'4.0.1');assert.equal(report.coverage.expectedRooms,24);assert.equal(report.coverage.expectedSpaces,30);assert.equal(report.tour.total,414);assert(report.samples.length>0);assert(report.hud.samples.every(s=>s.phase==='performance'));assert.equal(report.functional.expectedChecks,6);assert.equal(report.functional.complete,false);assert(report.findings.some(f=>f.type==='coverage'));assert.deepEqual(errors,[]);assert.deepEqual(report.errors,[]);assert(await child.evaluate(()=>window.__wireTheHouse.lifecyclePaused));
 console.log(JSON.stringify({passed:true,url:report.gameURL,recorderVersion:report.recorderVersion,backend:report.device.backend,gameScripts:report.buildScripts,rooms:report.coverage.expectedRooms,waypoints:report.tour.total,frames:report.samples.length,errors}));
});
