import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir,writeFile } from 'node:fs/promises';
import { blockPointerLock } from './browser-safety.mjs';

const out='output/site-pro-bottom-roles';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={passed:false,cases:[],errors:[]};
try{
  for(const {name,width,height} of [
    {name:'compact-portrait',width:320,height:740},
    {name:'mobile-portrait',width:390,height:844},
    {name:'mobile-landscape',width:667,height:375},
    {name:'tablet-portrait',width:820,height:1180},
    {name:'tablet-landscape',width:1180,height:820},
  ]){
    const context=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true,deviceScaleFactor:1});
    await blockPointerLock(context);
    const page=await context.newPage();
    page.on('pageerror',error=>report.errors.push(`${name}: ${error.message}`));
    await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');
    await page.locator('#start-button').tap({timeout:120000});
    await page.waitForTimeout(850);
    assert.equal(await page.locator('#game-shell').getAttribute('data-bottom-role'),'worker');
    await page.locator('#site-pro-coordinator').tap();
    await page.waitForFunction(()=>window.__wireTheHouse.apprentice.telemetry.mode==='point');
    assert.equal(await page.locator('#game-shell').getAttribute('data-bottom-role'),'coordinator');
    assert.equal(await page.locator('#site-pro-coordinator').getAttribute('aria-pressed'),'true');
    assert(await page.locator('#apprentice-controls [data-apprentice="plan"]').isVisible());
    const geometry=await page.evaluate(()=>{
      const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom};};
      return{worker:rect('#site-pro-tools'),coordinator:rect('#site-pro-coordinator'),actions:rect('#apprentice-controls'),move:rect('#joystick'),aim:rect('#look-joystick')};
    });
    assert(geometry.worker.right<=geometry.coordinator.x+1,`${name}: role tabs do not overlap`);
    assert(geometry.actions.bottom<=geometry.worker.y+1,`${name}: commands clear role tabs`);
    await page.screenshot({path:`${out}/${name}-coordinator.png`});
    await page.locator('#apprentice-controls [data-apprentice="plan"]').tap();
    await page.waitForFunction(()=>window.__wireTheHouse.apprentice.telemetry.mode==='plan');
    await page.locator('#apprentice-mobile-plan').waitFor({state:'visible'});
    assert(await page.locator('#apprentice-mobile-plan').isVisible(),`${name}: plans open`);
    await page.locator('[data-drawing-close]').tap();
    await page.waitForFunction(()=>window.__wireTheHouse.apprentice.telemetry.mode==='off');
    await page.locator('#site-pro-coordinator').tap();
    await page.locator('#site-pro-tools').tap();
    await page.waitForFunction(()=>document.querySelector('#game-shell').dataset.apprenticeMode==='off');
    assert.equal(await page.locator('#game-shell').getAttribute('data-bottom-role'),'worker');
    assert(await page.locator('#mobile-tool-slider [data-tool="hammer"]').isVisible(),`${name}: worker tools return`);
    report.cases.push({name,geometry});
    await context.close();
  }
  assert.deepEqual(report.errors,[]);
  report.passed=true;
}finally{
  await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
  await browser.close();
}
console.log(JSON.stringify({passed:report.passed,cases:report.cases.length,errors:report.errors}));
