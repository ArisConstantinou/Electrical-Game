import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { blockPointerLock } from './browser-safety.mjs';

const out='output/site-pro-tool-wheel';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={passed:false,emulatedMobile:true,cases:[],errors:[]};
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
    await page.locator('#apprentice-count').selectOption('0');
    await page.locator('#start-button').tap({timeout:120000});
    await page.waitForTimeout(850);
    assert.equal(await page.locator('#game-shell').getAttribute('data-tool-selector'),'horizontal',`${name}: strip stays default`);
    const tabsFit=await page.evaluate(()=>['#site-pro-tools','#site-pro-coordinator'].every(selector=>{const button=document.querySelector(selector);return button.scrollWidth<=button.clientWidth+1;}));
    assert(tabsFit,`${name}: role labels fit their tabs`);
    await page.locator('#site-pro-tools').tap();
    assert(await page.locator('#mobile-tool-slider [data-tool="hammer"]').isVisible(),`${name}: original tool strip works`);
    assert.equal(await page.locator('#tool-wheel-center').isVisible(),false);
    if(name==='mobile-portrait')await page.screenshot({path:`${out}/${name}-horizontal.png`});
    await page.locator('#site-pro-tools').tap();

    await page.locator('#settings-toggle').tap();
    await page.locator('#tool-selector-layout').tap();
    assert.equal(await page.locator('#tool-selector-layout b').textContent(),'WHEEL');
    assert.equal(await page.locator('#tool-selector-layout').getAttribute('aria-pressed'),'true');
    assert.equal(await page.evaluate(()=>localStorage.getItem('wirehouse:tool-selector')),'wheel');
    await page.locator('#settings-close').tap();
    await page.waitForFunction(()=>!document.querySelector('#game-shell').classList.contains('settings-open'));
    await page.locator('#site-pro-tools').tap();
    assert.equal(await page.locator('#site-pro-tools').getAttribute('aria-expanded'),'true');
    assert(await page.locator('#tool-wheel-center').isVisible(),`${name}: wheel centre visible`);
    assert(await page.locator('#tool-wheel-next').isVisible(),`${name}: second page reachable`);
    assert.equal(await page.locator('#tool-wheel-back').isVisible(),false);
    const geometry=await page.evaluate(()=>{
      const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
      return{wheel:rect('#mobile-tool-slider'),move:rect('#joystick'),aim:rect('#look-joystick'),useVisible:getComputedStyle(document.querySelector('#site-pro-use')).visibility==='visible',scrollWidth:document.documentElement.scrollWidth};
    });
    assert(geometry.wheel.x>=0&&geometry.wheel.y>=0&&geometry.wheel.right<=width+1&&geometry.wheel.bottom<=height+1,`${name}: wheel fits screen`);
    assert(Math.abs(geometry.wheel.width-geometry.wheel.height)<2,`${name}: wheel remains circular`);
    assert(geometry.scrollWidth<=width+1,`${name}: no horizontal overflow`);
    if(width<700&&height>width)assert.equal(geometry.useVisible,false,`${name}: USE does not overlap open wheel`);
    const targetSizes=await page.locator('#mobile-tool-slider [data-wheel-page="work"]:visible').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{width:r.width,height:r.height};}));
    assert.equal(targetSizes.length,7,`${name}: six work tools and more`);
    assert(targetSizes.every(size=>size.width>=44&&size.height>=44),`${name}: wheel tap targets are large enough`);
    await page.screenshot({path:`${out}/${name}-wheel-work.png`});
    await page.locator('#tool-wheel-next').tap();
    assert(await page.locator('#tool-wheel-back').isVisible(),`${name}: back page accessible`);
    assert(await page.locator('#mobile-tool-slider [data-tool="drill"]').isVisible());
    await page.screenshot({path:`${out}/${name}-wheel-utility.png`});
    await page.locator('#mobile-tool-slider [data-tool="drill"]').tap();
    await page.waitForFunction(()=>window.__wireTheHouse.selectedTool==='drill');
    assert.equal(await page.locator('#site-pro-tools').getAttribute('aria-expanded'),'false',`${name}: selection closes wheel`);
    await page.locator('#site-pro-tools').tap();
    assert.equal(await page.locator('#game-shell').getAttribute('data-tool-wheel-page'),'utility',`${name}: reopens on selected tool page`);
    assert.equal(await page.locator('#tool-wheel-center strong').textContent(),'DRILL');
    await page.locator('#tool-wheel-center').tap();
    assert.equal(await page.locator('#site-pro-tools').getAttribute('aria-expanded'),'false',`${name}: centre closes wheel`);
    assert(await page.locator('#site-pro-use').isVisible(),`${name}: USE returns after wheel closes`);
    report.cases.push({name,geometry,selection:'drill'});
    await context.close();
  }
  assert.deepEqual(report.errors,[]);
  report.passed=true;
}finally{
  await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
  await browser.close();
}
console.log(JSON.stringify({passed:report.passed,cases:report.cases.length,errors:report.errors}));
