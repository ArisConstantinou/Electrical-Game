import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';

const out='output/inspection-input';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={errors:[],checks:[]};
try{
  const context=await browser.newContext({viewport:{width:1366,height:768}});
  await context.addInitScript(()=>{
    window.__pointerLockRequests=0;
    Object.defineProperty(Element.prototype,'requestPointerLock',{configurable:false,writable:false,value:()=>{
      window.__pointerLockRequests++;
      return Promise.reject(new DOMException('Pointer Lock disabled for automated verification','SecurityError'));
    }});
  });
  const page=await context.newPage();
  page.on('pageerror',error=>report.errors.push(error.message));
  await page.goto('http://127.0.0.1:5365/Electrical-Game/');
  await page.waitForFunction(()=>window.__wireTheHouse?.renderer?.renderCamera,undefined,{timeout:120000});
  await page.mouse.click(24,220);
  assert.equal(await page.evaluate(()=>window.__pointerLockRequests),0,'start-screen background must not request Pointer Lock');
  await page.waitForFunction(()=>!document.querySelector('#start-button')?.disabled,undefined,{timeout:120000});
  await page.locator('#start-button').click();
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(()=>window.__pointerLockRequests),1,'START in Worker mode must enable desktop mouse look');
  await page.mouse.click(683,384);
  assert.equal(await page.evaluate(()=>window.__pointerLockRequests),2,'Clicking the room must retry mouse look after a blocked request');
  await page.evaluate(()=>{const g=window.__wireTheHouse;window.__inspectionStep=g.step.bind(g);g.step=()=>{};});
  const step=frames=>page.evaluate(frames=>{for(let i=0;i<frames;i++)window.__inspectionStep(1/60,1/60,false);},frames);
  await page.keyboard.press('Escape');await step(2);
  await page.keyboard.press('Digit4');await step(2);
  assert.equal(await page.evaluate(()=>window.__wireTheHouse.selectedTool),'hammer');
  await page.evaluate(()=>dispatchEvent(new CustomEvent('wirehouse:coordinator-open')));await step(2);
  const coordinator=await page.evaluate(()=>({
    mode:window.__wireTheHouse.apprentice.mode,
    selected:window.__wireTheHouse.selectedTool,
    locked:!!document.pointerLockElement,
    panels:['#top-hud','#tool-status','#site-pro-desktop-tools'].map(selector=>getComputedStyle(document.querySelector(selector)).display),
    keys:[...document.querySelectorAll('#apprentice-controls kbd')].filter(node=>node.checkVisibility()).map(node=>node.textContent),
  }));
  assert.equal(coordinator.mode,'point');assert.equal(coordinator.selected,'hammer');assert.equal(coordinator.locked,false);
  assert.deepEqual(coordinator.panels,['none','none','none']);assert.deepEqual(coordinator.keys,['1','2','3','ESC']);
  await page.screenshot({path:`${out}/coordinator.png`});
  await page.keyboard.press('Digit3');await step(2);
  assert.equal(await page.evaluate(()=>window.__wireTheHouse.apprentice.mode),'plan');
  assert.equal(await page.evaluate(()=>window.__wireTheHouse.selectedTool),'hammer','Digit3 must not select spray while inspection is active');
  await page.keyboard.press('Digit2');
  assert.equal(await page.locator('[data-drawing-tab="ground"]').getAttribute('aria-selected'),'true');
  await page.keyboard.press('Digit3');
  assert.equal(await page.locator('[data-drawing-tab="section"]').getAttribute('aria-selected'),'true');
  await page.keyboard.press('Digit1');
  assert.equal(await page.locator('[data-drawing-tab="electrical"]').getAttribute('aria-selected'),'true');
  await page.screenshot({path:`${out}/plans.png`});
  await page.keyboard.press('Escape');await step(2);
  assert.equal(await page.evaluate(()=>window.__wireTheHouse.apprentice.mode),'off');
  await page.locator('#settings-toggle').click();
  await page.locator('#model-inspector-open').click();
  await page.waitForFunction(()=>window.__wireTheHouse.modelInspector.active);
  await page.keyboard.press('Digit3');
  const modelInspector=await page.evaluate(()=>({
    selected:window.__wireTheHouse.selectedTool,
    toolsVisibility:getComputedStyle(document.querySelector('#site-pro-desktop-tools')).visibility,
    locked:!!document.pointerLockElement,
  }));
  assert.deepEqual(modelInspector,{selected:'hammer',toolsVisibility:'hidden',locked:false},'Model Inspector must isolate gameplay tools and hotkeys');
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!window.__wireTheHouse.modelInspector.active);
  const routing=await page.evaluate(()=>{
    const g=window.__wireTheHouse;let calls=0;g.apprentice.tryOpenDrawingsOnAim=()=>{calls++;return true;};
    g.input.actionRequested=true;window.__inspectionStep(1/60,1/60,false);const afterUse=calls;
    g.input.interactionRequested=true;window.__inspectionStep(1/60,1/60,false);return{afterUse,afterInteract:calls};
  });
  assert.deepEqual(routing,{afterUse:0,afterInteract:1},'Only explicit INTERACT may open Apprentice plans');
  const wristBends=await page.evaluate(()=>{
    const g=window.__wireTheHouse,w=g.workerBody,rows=[];g.apprentice.command('point');
    for(const pitch of [-.75,-.45,0,.45,.75])for(const yaw of [-.65,0,.65]){
      g.player.pitch=pitch;g.player.yaw=yaw;window.__inspectionStep(1/60,1/60,false);
      const wrist=w.point('hand.R'),fore=wrist.clone().sub(w.point('forearm.R')).normalize(),long=w.point('middle.01.R').sub(wrist).normalize();
      rows.push({pitch,yaw,bend:fore.angleTo(long)*180/Math.PI});
    }
    g.player.pitch=-.55;g.player.yaw=-.28;window.__inspectionStep(1/60,1/60,true);return rows;
  });
  assert(Math.max(...wristBends.map(row=>row.bend))<=22.1,JSON.stringify(wristBends));
  await page.waitForTimeout(120);
  await page.screenshot({path:`${out}/wrist-camera-angle.png`});
  const wrist=await page.evaluate(()=>{
    const g=window.__wireTheHouse,joints=g.fpsRig.getObjectsByProperty('name','Rounded wrist transition');
    return{count:joints.length,renderError:g.renderer.renderError,tool:g.selectedTool};
  });
  assert(wrist.count>=1);assert.equal(wrist.renderError,'');assert.equal(wrist.tool,'hammer');
  report.checks.push('menu background stays unlocked; Worker START and room click request mouse look');
  report.checks.push('Coordinator hides gameplay HUD/tools and maps 1/2/3/Esc without tool selection');
  report.checks.push('Model Inspector hides gameplay tools and blocks Digit3 tool selection');
  report.checks.push('plans map 1/2/3/Esc and open only from explicit INTERACT');
  report.checks.push('Coordinator wrist remains connected within 22 degrees across 15 camera poses');
  assert.deepEqual(report.errors,[]);
  await context.close();
}finally{
  await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
  await browser.close();
}
console.log(JSON.stringify(report));
