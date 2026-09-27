import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {blockPointerLock} from './browser-safety.mjs';
import {routeBuildingDist} from './building-qa-utils.mjs';
const {launchManagedBrowser,runManagedClient}=await import(pathToFileURL(path.join(process.env.CODEX_HOME??path.join(os.homedir(),'.codex'),'skills/develop-web-game/scripts/browser_lifecycle.mjs')));
const out=path.resolve(process.env.QA_ADDRESS_OUTPUT??'output/benchmark-address');await mkdir(out,{recursive:true});
const session=await launchManagedBrowser(chromium,{channel:'chrome',headless:true,screenshotDir:out});
await runManagedClient(session,180000,async()=>{
 const context=await session.browser.newContext({viewport:{width:430,height:745},isMobile:true,hasTouch:true,deviceScaleFactor:3});await blockPointerLock(context);await routeBuildingDist(context);
 const page=await context.newPage(),errors=[],requests=[],navigations=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));page.on('framenavigated',f=>{if(f===page.mainFrame())navigations.push(f.url());});
 const url=process.env.QA_ADDRESS_URL??'http://127.0.0.1:5365/Electrical-Game/perf/?v=address-test';await page.goto(url);await page.locator('#begin').waitFor();
 await page.screenshot({path:path.join(out,'prompt.png')});await writeFile(path.join(out,'initial.json'),JSON.stringify({url:page.url(),navigations,requests},null,2));
 assert.equal(new URL(page.url()).pathname,'/Electrical-Game/perf/','The benchmark must stay at /perf/, without redirecting to /review/performance/');assert.equal(await page.locator('#game').getAttribute('src'),null);
 await page.evaluate(()=>window.__parentIdentity=Math.random());const identity=await page.evaluate(()=>window.__parentIdentity),reports=[];
 for(let i=0;i<2;i++){
  await page.locator('#begin').tap();await page.waitForFunction(()=>window.performanceRecording.tour,null,{timeout:120000});await page.waitForTimeout(1200);await page.screenshot({path:path.join(out,`tour-${i+1}.png`)});await page.locator('#stop').tap();
  const report=await page.evaluate(()=>window.performanceRecording.report);reports.push(report);
  assert.equal(await page.evaluate(()=>window.__parentIdentity),identity,'New benchmark must not reload the parent page');assert.equal(new URL(page.url()).pathname,'/Electrical-Game/perf/');assert.equal(new URL(report.gameURL).pathname,'/Electrical-Game/');assert.equal(new URL(report.gameURL).searchParams.get('v'),'address-test');assert(report.samples.length>0);assert.equal(report.tour.total,414);assert.deepEqual(report.errors,[]);
 }
 await page.screenshot({path:path.join(out,'results.png')});assert.notEqual(reports[0].createdAt,reports[1].createdAt);assert.equal(navigations.length,1);assert(!requests.some(url=>url.includes('/review/performance')));assert.deepEqual(errors,[]);
 const restored=await context.newPage();await restored.goto(url);await restored.waitForFunction(createdAt=>window.performanceRecording.report?.createdAt===createdAt,reports[1].createdAt);assert.equal(await restored.locator('#game').getAttribute('src'),null,'Saved results must restore without starting another scene');
 // Use the same browser routing as the candidate; APIRequestContext bypasses
 // Playwright interception and would inspect the protected old listener.
 const legacy=await restored.goto(new URL('../review/performance/',page.url()).href);assert.equal(legacy.status(),404,'The removed route must not serve another benchmark');await restored.close();
 await writeFile(path.join(out,'report.json'),JSON.stringify({passed:true,url:page.url(),navigations,requests,errors,reports},null,2));console.log(JSON.stringify({passed:true,url:page.url(),navigations,runs:reports.map(r=>({version:r.recorderVersion,backend:r.device.backend,frames:r.samples.length,errors:r.errors}))}));
});
