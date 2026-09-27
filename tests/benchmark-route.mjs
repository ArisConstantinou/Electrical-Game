import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {blockPointerLock} from './browser-safety.mjs';
import {routeBuildingDist} from './building-qa-utils.mjs';
const {launchManagedBrowser,runManagedClient}=await import(pathToFileURL(path.join(process.env.CODEX_HOME??path.join(os.homedir(),'.codex'),'skills/develop-web-game/scripts/browser_lifecycle.mjs')));
const out=path.resolve(process.env.QA_ROUTE_OUTPUT??'output/benchmark-route');await mkdir(out,{recursive:true});
const session=await launchManagedBrowser(chromium,{channel:'chrome',headless:true,screenshotDir:out});
await runManagedClient(session,180000,async()=>{
 const context=await session.browser.newContext();await blockPointerLock(context);await routeBuildingDist(context);
 const page=await context.newPage();await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');
 await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart,null,{timeout:120000});
 await page.locator('#start-button').click();
 const result=await page.evaluate(async()=>{
  const {createTour}=await import('./review/performance/tour.js');const {coverage}=await import('./review/performance/diagnostics.js');const g=window.__wireTheHouse;
  cancelAnimationFrame(g.animationFrame);g.animationFrame=null;g.input.resetTransientInput();
  const checkpoints=[];let completed=false,failure=null;
  const tour=createTour(g,c=>checkpoints.push(c),()=>completed=true,f=>failure=f);
  // Accelerated route feasibility only, separate from real-time FPS measurements.
  let steps=0;for(;steps<120000&&!completed&&!failure;steps++){tour.update(1/60);g.player.update(1/60);}
  tour.stop();return {completed,failure,index:tour.index,total:tour.total,current:tour.current,position:g.player.camera.position.toArray(),checkpoints,coverage:coverage(checkpoints),simulatedSeconds:steps/60};
 });
 await writeFile(path.join(out,'report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,checkpoints:result.checkpoints.length,coverage:{complete:result.coverage.complete,verifiedRooms:result.coverage.verifiedRooms,missing:result.coverage.missing.length}}));
 assert(result.completed,`Route failed: ${JSON.stringify(result.failure??result.current)}`);
 assert(result.coverage.complete);assert.equal(result.coverage.verifiedRooms,24);
});
