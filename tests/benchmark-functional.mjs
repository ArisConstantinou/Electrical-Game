import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {blockPointerLock} from './browser-safety.mjs';
import {routeBuildingDist} from './building-qa-utils.mjs';
const {launchManagedBrowser,runManagedClient}=await import(pathToFileURL(path.join(process.env.CODEX_HOME??path.join(os.homedir(),'.codex'),'skills/develop-web-game/scripts/browser_lifecycle.mjs')));
const out=path.resolve('output/benchmark-functional');await mkdir(out,{recursive:true});
const session=await launchManagedBrowser(chromium,{channel:'chrome',headless:true,screenshotDir:out});
await runManagedClient(session,180000,async()=>{
 const context=await session.browser.newContext({viewport:{width:430,height:745},hasTouch:true,isMobile:true,deviceScaleFactor:3});await blockPointerLock(context);await routeBuildingDist(context);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer='+ (process.env.QA_BACKEND??'webgpu'));await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart,null,{timeout:120000});await page.locator('#start-button').click();
 await page.evaluate(async()=>{
  const {createFunctionalChecks}=await import('./review/performance/functional.js');const g=window.__wireTheHouse;g.player.camera.position.set(0,1.65,2);g.input.resetTransientInput();
  const original=g.step;window.__checks=null;
  const controller=createFunctionalChecks(g,checks=>{window.__checks=checks;g.step=original;g.suspendLifecycle();});
  g.step=function(...args){controller.update(args[0]);try{return original.apply(this,args);}finally{controller.afterStep();}};
 });
 await page.waitForFunction(()=>window.__checks,null,{timeout:45000});const checks=await page.evaluate(()=>window.__checks);await writeFile(path.join(out,'report.json'),JSON.stringify({checks,errors},null,2));await page.screenshot({path:path.join(out,'checks.png')});console.log(JSON.stringify(checks));assert.deepEqual(errors,[]);assert.equal(checks.length,6);assert(checks.every(c=>c.status==='passed'));
});
