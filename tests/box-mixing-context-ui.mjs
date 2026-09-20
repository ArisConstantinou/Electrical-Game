import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { blockPointerLock } from './browser-safety.mjs';

const url=process.env.QA_BASE??'http://127.0.0.1:5365/Electrical-Game/';
const out='output/box-mixing-context-ui';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={url,errors:[],states:{},passed:false};
try{
  const context=await browser.newContext({viewport:{width:1366,height:768}});await blockPointerLock(context);
  const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
  await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse?.mixing,undefined,{timeout:120000});await page.locator('#start-button').click();
  await page.evaluate(()=>{const g=window.__wireTheHouse;window.__boxMixStep=g.step.bind(g);g.step=()=>{};});
  const step=(count=2)=>page.evaluate(n=>{for(let i=0;i<n;i++)window.__boxMixStep(1/60);},count);
  const state=()=>page.evaluate(()=>{const g=window.__wireTheHouse,shell=document.querySelector('#game-shell');return{
    selected:g.selectedTool,assemblyActive:g.boxAssemblyActive,moduleCount:g.boxAssembly.snapshot.modules.length,
    boxPanel:document.querySelector('#box-supply').checkVisibility(),receipt:document.querySelector('#mixing-receipt').checkVisibility(),
    toolbelt:document.querySelector('#mixing-toolbelt').checkVisibility(),prompt:document.querySelector('#mixing-world-prompt').textContent,boxPrompt:document.querySelector('#interaction-prompt').checkVisibility(),
    mixingTarget:shell.dataset.mixingInteract,mixingActive:g.mixing.telemetry.active,rigVisible:g.fpsRig.visible,
    assemblyVisible:g.fpsRig.fittingAssemblyRoot.visible,candidateVisible:g.fpsRig.fittingCandidateRoot.visible,
    previewVisible:g.boxFitPreview.root.visible,renderError:g.renderer.renderError,overflow:document.documentElement.scrollWidth>innerWidth
  };});
  await page.evaluate(()=>{const g=window.__wireTheHouse;g.selectTool('fitting');dispatchEvent(new CustomEvent('wirehouse:box-enter-assembly'));dispatchEvent(new CustomEvent('wirehouse:box-attach',{detail:2}));});await step(35);
  await page.evaluate(()=>{const g=window.__wireTheHouse,m=g.mixing,c=g.renderer.camera,p=m.models.group.getWorldPosition(c.position.clone());c.position.set(p.x,g.player.eyeHeight,p.z-.9);c.lookAt(p.x,3.3,p.z);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;});await step();
  const passing=await state();report.states.passing=passing;
  assert.equal(passing.assemblyActive,true);assert.equal(passing.moduleCount,2);assert.equal(passing.boxPanel,true,'BOX panel remains available while merely passing through the mixing bay');
  assert.equal(passing.receipt,false,'Passive mixing receipt must not cover live BOX assembly');assert.equal(passing.toolbelt,false,'Passive mixing controls must not cover live BOX assembly');
  await page.evaluate(()=>{const g=window.__wireTheHouse,m=g.mixing,c=g.renderer.camera,o=m.models.water,p=o.getWorldPosition(c.position.clone()),station=m.models.group.getWorldPosition(c.position.clone());c.position.set(station.x,g.player.eyeHeight,station.z-.92);c.lookAt(p.x,p.y+.08,p.z);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;});await step();
  const targeted=await state();report.states.targeted=targeted;
  assert.equal(targeted.mixingTarget,'true','A real mixing object under the crosshair owns E');assert.equal(targeted.boxPanel,false,'BOX panel yields while a mixing object is targeted');
  assert.equal(targeted.receipt,true);assert.equal(targeted.toolbelt,true);assert.equal(targeted.boxPrompt,false,'BOX assembly prompt cannot remain over the mixing prompt');assert.equal(targeted.rigVisible,false,'Held gang boxes yield with the BOX panel');assert.equal(targeted.previewVisible,false,'BOX placement preview cannot compete with mixing interaction');
  await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/mixing-target-priority.png`});
  await page.keyboard.press('KeyE');await step(3);
  const active=await state();report.states.active=active;
  assert.equal(active.mixingActive,true,'E opens the targeted mixing station instead of resetting the BOX draft');assert.equal(active.assemblyActive,false,'Entering mixing closes live BOX assembly');assert.equal(active.moduleCount,2,'Closing BOX for mixing preserves the draft');
  assert.equal(active.boxPanel,false);assert.equal(active.receipt,true);assert.equal(active.rigVisible,false);assert.equal(active.renderError,'');assert.equal(active.overflow,false);assert.deepEqual(report.errors,[]);
  report.passed=true;console.log(JSON.stringify({passed:true,states:report.states}));await context.close();
}finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
