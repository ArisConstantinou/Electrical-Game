import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {blockPointerLock} from './browser-safety.mjs';
import {routeBuildingDist} from './building-qa-utils.mjs';
const {launchManagedBrowser,runManagedClient}=await import(pathToFileURL(path.join(process.env.CODEX_HOME??path.join(os.homedir(),'.codex'),'skills/develop-web-game/scripts/browser_lifecycle.mjs')));
const out=path.resolve(process.env.QA_LAYOUT_OUTPUT??'output/benchmark-hud-layout');await mkdir(out,{recursive:true});
const session=await launchManagedBrowser(chromium,{channel:'chrome',headless:true,screenshotDir:out});
const results=[];
await runManagedClient(session,180000,async()=>{
 for(const viewport of [{width:430,height:745},{width:320,height:740},{width:844,height:390},{width:1366,height:768}]){
  const context=await session.browser.newContext({viewport,isMobile:viewport.width<1000,hasTouch:viewport.width<1000,deviceScaleFactor:1});await blockPointerLock(context);await routeBuildingDist(context);
  const page=await context.newPage();await page.goto('http://127.0.0.1:5365/Electrical-Game/perf/');await page.locator('#begin').click();await page.waitForFunction(()=>window.performanceRecording.tour,null,{timeout:120000});await page.waitForTimeout(1200);
  const child=page.frames().find(f=>f.parentFrame());
  const hud=await child.evaluate(()=>['fps-counter','mobile-top-rail','mobile-tool-slider'].map(id=>{const e=document.getElementById(id),r=e?.getBoundingClientRect();return {id,visible:!!r&&r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden',rect:r?.toJSON()};}));
  const panel=await page.locator('#panel').boundingBox();
  const overlaps=hud.filter(h=>h.visible&&panel.x<h.rect.right&&panel.x+panel.width>h.rect.left&&panel.y<h.rect.bottom&&panel.y+panel.height>h.rect.top).map(h=>h.id);
  const state={viewport,panel,hud,overlaps,overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)};results.push(state);
  await page.screenshot({path:path.join(out,`${viewport.width}-tour.png`)});await page.locator('#stop').click();await context.close();
  await writeFile(path.join(out,'report.json'),JSON.stringify(results,null,2));
  assert(hud.find(h=>h.id==='fps-counter').visible,'The actual game FPS counter must remain visible');
  if(viewport.width<1000)assert(hud.find(h=>h.id==='mobile-top-rail').visible,'Mobile navigation must remain visible');
  assert.deepEqual(overlaps,[],'Benchmark panel must not cover FPS or top navigation');assert(!state.overflow);
 }
});
console.log(JSON.stringify({passed:true,viewports:results.map(r=>r.viewport)}));
