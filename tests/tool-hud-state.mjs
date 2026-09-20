import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
const out='output/tool-hud-state';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={method:'Native keyboard/touch with normal simulation. Pointer Lock prohibited before navigation. Mobile is Chrome emulation.',cases:[],errors:[]};
const tools=[['spring','Digit1'],['cutter','Digit2'],['spray','Digit3'],['hammer','Digit4'],['fitting','Digit5'],['level','Digit6'],['trowel','Digit7'],['hose','Digit8']];
try{for(const mobile of [false,true]){
 const platform=mobile?'mobile':'desktop',context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1366,height:768},isMobile:mobile,hasTouch:mobile});await blockPointerLock(context);
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(`${platform}: ${e.message}`));
 await page.goto('http://127.0.0.1:5365/Electrical-Game/');await page.waitForFunction(()=>window.__wireTheHouse?.roomWater.waterProActive,undefined,{timeout:120000});
 const click=selector=>page.locator(selector)[mobile?'tap':'click']();await click('#start-button');
 const select=async(tool)=>{if(mobile)await click(`[data-tool="${tool}"]`);else await page.keyboard.press(tools.find(t=>t[0]===tool)[1]);await page.waitForFunction(tool=>document.querySelector('#game-shell').dataset.activeTool===tool,tool);};
 const cases=[];
 for(const [tool] of tools){
  await select(tool);
  const state=await page.evaluate(()=>({tool:document.querySelector('#tool-status .selected').textContent,selected:document.querySelector('[data-tool].selected')?.dataset.tool,context:document.querySelector('#tool-mode-toggle').dataset.modeKind,hint:document.querySelector('#aim-control-label').textContent,chiselHidden:document.querySelector('#chisel-orientation').hidden,mortarHidden:document.querySelector('#mortar-panel').hidden}));
  assert.equal(state.tool,tool.toUpperCase());assert.equal(state.selected,tool);assert.equal(state.context,['spray','hammer','hose'].includes(tool)?tool:'');assert.equal(state.chiselHidden,tool!=='hammer');assert.equal(state.mortarHidden,!['hose','trowel'].includes(tool));
  assert.equal(state.hint,'HOLD + STICK',`${platform}/${tool}: explicit hold hint missing`);cases.push(state);
 }
 await click('#settings-toggle');await page.locator('#water-gun-mode').selectOption('mist');await page.waitForFunction(()=>document.querySelector('#mortar-readout').textContent.includes('MIST'));
 if(mobile){
  for(const [id,stateKey,label] of [['#aim-input-mode','aimInputMode','DRAG'],['#aim-speed','aimProfile','FAST'],['#wall-assist','wallAssistEnabled','OFF']]){
   await click(id);await page.waitForFunction(({id,label})=>document.querySelector(`${id} b`).textContent===label,{id,label});
   cases.push({setting:id,value:await page.evaluate(key=>window.__wireTheHouse[key],stateKey)});
  }
  assert.equal(await page.locator('#aim-control-mode').count(),0,'Automatic use must not be available');
  assert.equal(await page.locator('#aim-control-label').textContent(),'HOLD + DRAG');
  await click('#aim-input-mode');await page.waitForFunction(()=>document.querySelector('#aim-control-label').textContent==='HOLD + STICK');
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('wirehouse:cycle-aim-control')));
  assert.equal(await page.evaluate(()=>window.__wireTheHouse.aimControlMode),'manual');
 }
 await page.screenshot({path:`${out}/${platform}-settings.png`,animations:'disabled'});await click('#settings-close');
 await select('hammer');
 for(let i=0;i<4;i++)await page.keyboard.press('BracketLeft');
 await page.waitForFunction(()=>document.querySelector('#tool-status em').textContent==='UP · EDGE CLEANUP');
 for(let i=0;i<4;i++)await page.keyboard.press('BracketRight');
 await page.waitForFunction(()=>document.querySelector('#tool-status em').textContent==='LEFT CLICK TO USE');
 await select('spray');assert.ok(!(await page.locator('#tool-status').textContent()).includes('UP · EDGE'));
 await page.evaluate(()=>window.__wireTheHouse.hud.notify('QA temporary notification',false,120));
 await page.waitForFunction(()=>!document.querySelector('#interaction-prompt').classList.contains('visible'));
 assert.equal(await page.locator('#interaction-prompt').textContent(),'');
 await select('trowel');
 const cdp=mobile?await context.newCDPSession(page):null;
 if(mobile){const box=await page.locator('#look-joystick').boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width*.5,y:box.y+box.height*.5,id:7}]});}else await page.keyboard.down('KeyE');
 await page.waitForFunction(()=>document.querySelector('#mortar-flow').dataset.holding==='true');
 const samples=[];
 for(let i=0;i<4;i++){await page.waitForTimeout(70);samples.push(await page.locator('#throw-timing-track').getAttribute('aria-valuenow'));}
 assert.ok(new Set(samples).size>=3,`${platform}: live swing gauge must keep updating`);
 await page.screenshot({path:`${out}/${platform}-swing.png`});
 if(mobile)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else await page.keyboard.up('KeyE');
 await page.waitForFunction(()=>document.querySelector('#mortar-flow').dataset.holding==='false');
 const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,pointerLock:!!document.pointerLockElement,renderError:window.__wireTheHouse.renderer.renderError,smallLabels:[...document.querySelectorAll('#game-shell span,#game-shell small,#game-shell b,#game-shell output,#game-shell em,#game-shell kbd')].filter(e=>e.children.length===0&&e.textContent.trim()&&e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&parseFloat(getComputedStyle(e).fontSize)<12).map(e=>({id:e.id,text:e.textContent,size:getComputedStyle(e).fontSize}))}));
 assert.equal(layout.overflow,false);assert.equal(layout.pointerLock,false);assert.equal(layout.renderError,'');assert.deepEqual(layout.smallLabels,[]);
 report.cases.push({platform,tools:cases,swingSamples:samples,layout});await context.close();
}assert.deepEqual(report.errors,[]);console.log(JSON.stringify(report,null,2));}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
