import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const url=process.argv[2]??'http://127.0.0.1:5365/Electrical-Game/';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  for(const device of [{name:'mobile portrait',width:390,height:844},{name:'mobile landscape',width:844,height:390},{name:'tablet portrait',width:820,height:1180}]){
    const page=await browser.newPage({viewport:{width:device.width,height:device.height},isMobile:true,hasTouch:true});
    await blockPointerLock(page.context());
    await page.goto(url);
    await page.waitForFunction(()=>window.__wireTheHouse?.renderer.renderCamera,{timeout:120000});
    await page.locator('#apprentice-count').selectOption('0');
    await page.locator('#start-button').tap();
    await page.locator('#site-pro-tools').tap();
    await page.locator('#mobile-tool-slider [data-tool="fitting"]').tap();
    assert.equal(await page.evaluate(()=>window.__wireTheHouse.selectedTool),'fitting',device.name);
    await page.locator('#box-assembly-toggle').tap();
    assert.equal(await page.evaluate(()=>window.__wireTheHouse.boxAssemblyActive),true,`${device.name}: tap opens assembly`);
    await page.waitForTimeout(400);
    await page.locator('#box-assembly-toggle').tap();
    assert.equal(await page.evaluate(()=>window.__wireTheHouse.boxAssemblyActive),false,`${device.name}: tap closes assembly`);
    await page.locator('#site-pro-tools').tap();
    await page.locator('#mobile-tool-slider [data-tool="level"]').tap();
    assert.equal(await page.evaluate(()=>window.__wireTheHouse.selectedTool),'level',`${device.name}: tool switch after closing`);
    await page.close();
    console.log(`${device.name}: assembly open/close and tool switching passed`);
  }
}finally{await browser.close();}
