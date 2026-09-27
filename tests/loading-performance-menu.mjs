import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { routeBuildingDist } from './building-qa-utils.mjs';
import { blockPointerLock } from './browser-safety.mjs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
const { launchManagedBrowser, runManagedClient } = await import(pathToFileURL(path.join(process.env.CODEX_HOME??path.join(os.homedir(),'.codex'),'skills/develop-web-game/scripts/browser_lifecycle.mjs')));

const baseline=process.argv.includes('--baseline'),live=process.argv.includes('--live');
if(baseline||live)process.env.QA_LIVE='1';
const out=process.env.QA_MENU_OUTPUT??`output/loading-performance-menu/${baseline?'before':live?'live':'after'}`;
const base='http://127.0.0.1:5365/Electrical-Game/';
await mkdir(out,{recursive:true});
const report={baseline,live,cases:[],errors:[]};
const session=await launchManagedBrowser(chromium,{channel:'chrome',headless:true,screenshotDir:out});
async function context(viewport={width:390,height:844}){
  const ctx=await session.browser.newContext({viewport,isMobile:viewport.width<1000,hasTouch:viewport.width<1000,deviceScaleFactor:1});
  await blockPointerLock(ctx);await routeBuildingDist(ctx);return ctx;
}
async function pageFor(ctx){const page=await ctx.newPage();page.on('pageerror',e=>report.errors.push(e.message));return page;}
async function ready(page){await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart,null,{timeout:120000});}
async function overlap(page){return page.evaluate(()=>{
  const rect=id=>document.querySelector(id).getBoundingClientRect();
  const a=rect('#start-button-label'),b=rect('#start-load-percent');
  const visible=getComputedStyle(document.querySelector('.start-loading-indicator')).display!=='none';
  return visible&&a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
});}
await runManagedClient(session,360000,async()=>{
  if(!process.argv.includes('--performance-only')){
    // The same physical request and viewport show the old one-shot image failure.
    const targets=baseline?['assets/site-materials/concrete-wall-009-albedo-1k.jpg','assets/worker/worker-apprentice-lod.glb']:
      ['assets/site-materials/concrete-wall-009-albedo-1k.jpg','assets/worker/worker.glb','assets/worker/skeleton.json'];
    for(const asset of targets){
      const ctx=await context(),page=await pageFor(ctx);let attempts=0;const timings=[];
      const failures=2;
      await ctx.route(`${base}${asset}*`,route=>{attempts++;const attempt=Number(new URL(route.request().url()).searchParams.get('retry')?.split('-')[0]??0);timings[attempt]??=Date.now();return baseline||attempt<failures?route.abort('failed'):route.fallback();});
      await page.goto(base+'?renderer=webgl',{waitUntil:'domcontentloaded'});
      if(baseline){
        await page.waitForFunction(()=>document.querySelector('#start-button-label')?.textContent==='RETRY LOADING');
        const state={asset,attempts,label:await page.locator('#start-button-label').textContent(),overlap:await overlap(page)};
        report.cases.push(state);await page.screenshot({path:`${out}/${asset.endsWith('.glb')?'failure-mobile':'material-failure'}.png`,fullPage:true});
      }else{
        await ready(page);assert.equal(attempts,asset.endsWith('skeleton.json')?6:3,asset);assert(timings[1]-timings[0]>=350);assert(timings[2]-timings[1]>=1100);
        if(asset.includes('site-materials')){
          const textures=await page.evaluate(()=>{const materials=new Set(),images=[];window.__wireTheHouse.room.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[])if(m.map?.name?.includes('cast-009'))materials.add(m.map);});for(const t of materials)images.push({width:t.image?.width,height:t.image?.height});return images;});
          assert(textures.length>0,'Real concrete texture clones must exist');assert(textures.every(t=>t.width>0&&t.height>0),'Every shared clone must receive the recovered image');
        }
        report.cases.push({asset,attempts,recovered:true});
      }
      await ctx.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
    }
    if(!baseline){
      const ctx=await context(),page=await pageFor(ctx);let attempts=0;
      await ctx.route(`${base}assets/worker/worker-apprentice-lod.glb*`,route=>++attempts<=3?route.abort('failed'):route.fallback());
      await page.goto(base+'?renderer=webgl',{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>document.querySelector('#start-button-label')?.textContent==='RETRY LOADING');
      assert.equal(attempts,3);assert.equal(await overlap(page),false);assert(await page.locator('#start-load-error').isVisible());
      assert.equal(await page.evaluate(()=>!!window.__wireTheHouse?.started),false);
      await page.screenshot({path:`${out}/failure-mobile.png`,fullPage:true});
      await Promise.all([page.waitForEvent('domcontentloaded'),page.locator('#start-button').click()]);await ready(page);
      assert.equal(await page.evaluate(()=>window.__wireTheHouse.started),false,'Reload must return to menu, not start incomplete work');
      await page.screenshot({path:`${out}/menu-mobile.png`,fullPage:true});
      const layout=await page.evaluate(()=>{const a=document.querySelector('#start-level-editor').getBoundingClientRect(),b=document.querySelector('#start-performance-test').getBoundingClientRect();return{sameRow:Math.abs(a.top-b.top)<1,buttonHeight:b.height,overflow:document.documentElement.scrollWidth>innerWidth};});
      assert(layout.sameRow&&layout.buttonHeight>=48&&!layout.overflow);
      await page.locator('#start-button').click();await page.waitForFunction(()=>window.__wireTheHouse.started);
      report.cases.push({persistentFailure:true,manualRetryRecovered:true,layout});await ctx.close();
      await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
    }
  }
  if(!baseline){
    for(const viewport of [{width:390,height:844},{width:844,height:390},{width:1366,height:768}]){
      const ctx=await context(viewport),page=await pageFor(ctx);
      await page.goto(base+'?renderer=webgl',{waitUntil:'domcontentloaded'});
      await page.locator('#start-performance-test').click();await page.locator('#begin').waitFor();
      assert.equal(new URL(page.url()).pathname,'/Electrical-Game/');assert.equal(new URL(page.url()).searchParams.get('performance'),'1');
      assert.equal(await page.locator('#game').getAttribute('src'),null,'No hidden renderer until Start benchmark');
      await page.locator('#close').click();await page.locator('#start-performance-test').waitFor();
      await page.locator('#start-performance-test').click();await page.locator('#begin').click();
      assert(await page.locator('#close').isVisible(),'MAIN MENU must remain available during loading');
      await page.locator('#close').click();await page.locator('#start-performance-test').waitFor();
      await page.locator('#start-performance-test').click();await page.locator('#begin').click();
      await page.waitForFunction(()=>window.performanceRecording?.phase==='performance',null,{timeout:120000});
      await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).frames>=20);
      assert(await page.locator('#close').isVisible(),'MAIN MENU must remain available while measuring');
      const child=page.frames().find(f=>f.parentFrame()),hud=await child.evaluate(()=>['fps-counter','mobile-top-rail','mobile-tool-slider'].map(id=>{const e=document.getElementById(id),r=e?.getBoundingClientRect();return{id,visible:!!r&&r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden',rect:r?.toJSON()};}));
      const panel=await page.locator('#panel').boundingBox();assert(hud.every(h=>!h.visible||!(panel.x<h.rect.right&&panel.x+panel.width>h.rect.left&&panel.y<h.rect.bottom&&panel.y+panel.height>h.rect.top)),'Test controls must not cover game navigation/FPS');
      const exit=await page.locator('#close').boundingBox();assert(exit.height>=48&&exit.x>=0&&exit.x+exit.width<=viewport.width);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.screenshot({path:`${out}/test-${viewport.width}.png`});
      await page.locator('#close').click();await page.locator('#start-performance-test').waitFor();
      await page.locator('#start-performance-test').click();await page.waitForFunction(()=>window.performanceRecording?.report);
      assert.equal(await page.locator('#game').getAttribute('src'),null,'Restored results must not start another renderer');
      assert.equal(await page.evaluate(()=>window.performanceRecording?.report.outcome),'stopped');
      assert(await page.locator('#close').isVisible());
      const saved=await page.evaluate(()=>({frames:window.performanceRecording?.report.samples.length,errors:window.performanceRecording?.report.errors,gameURL:window.performanceRecording?.report.gameURL}));assert(saved.frames>=20);assert.deepEqual(saved.errors,[]);assert(!new URL(saved.gameURL).searchParams.has('performance'));
      report.cases.push({viewport,loadingExit:true,runningExit:true,restoredExit:true,saved});
      await ctx.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
    }
    if(!live){const ctx=await context(),page=await pageFor(ctx);const response=await page.goto(base+'perf/');assert.equal(response.status(),404);await ctx.close();report.cases.push({retiredPerf404:true});}
  }
  assert.deepEqual(report.errors,[]);report.passed=true;
});
await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
