import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
const out=process.argv[2]??'output/box-escape-pointerlock';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),report={cases:[],errors:[],scope:'Pointer-lock state/event emulation; actual OS cursor capture is blocked.'};
try{
 const context=await browser.newContext({viewport:{width:1366,height:768}});await blockPointerLock(context);const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');await page.locator('#start-button').click({timeout:120000});
 await page.evaluate(()=>{window.__qaLock=null;Object.defineProperty(document,'pointerLockElement',{configurable:true,get:()=>window.__qaLock});});
 const lock=active=>page.evaluate(active=>{window.__qaLock=active?document.querySelector('#game-canvas'):null;document.dispatchEvent(new Event('pointerlockchange'));},active);
 const state=()=>page.evaluate(()=>{const g=window.__wireTheHouse;return{tool:g.selectedTool,modules:g.boxAssembly.snapshot.modules,held:g.input.actionHeld,requested:g.input.actionRequested,assembly:g.hud.shell.dataset.boxAssembly};});
 await page.keyboard.press('KeyB');await page.keyboard.press('Digit5');await page.keyboard.press('Digit2');await page.waitForFunction(()=>window.__wireTheHouse.boxAssembly.snapshot.modules.length===2);
 const draft=(await state()).modules;await lock(true);await page.screenshot({path:out+'/before-unlock.png'});
 // Browser handles its Escape unlock gesture without sending a page keydown.
 await lock(false);await page.screenshot({path:out+'/after-unlock.png'});const unlocked=await state();report.cases.push({name:'unlock-without-keydown',state:unlocked});
 assert.equal(unlocked.tool,'driver','Pointer-lock loss must exit box assembly even without Escape keydown');assert.equal(unlocked.assembly,'false');assert.deepEqual(unlocked.modules,draft);assert(!unlocked.held&&!unlocked.requested);
 await page.keyboard.press('Digit5');await lock(true);
 await page.locator('#settings-toggle').click();await lock(false);assert.equal((await state()).tool,'fitting','settings unlock must preserve box editing');await page.keyboard.press('Escape');assert.equal((await state()).tool,'fitting','Escape in settings only closes settings');report.cases.push({name:'settings-unlock-preserves-draft'});
 await lock(true);await page.locator('#model-inspector-open').click();await lock(false);assert.equal((await state()).tool,'fitting','inspector unlock must preserve box editing');await page.keyboard.press('Escape');assert.equal((await state()).tool,'fitting','Escape in inspector only closes inspector');report.cases.push({name:'inspector-unlock-and-Escape-preserve-draft'});
 await page.evaluate(()=>dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));assert.equal((await state()).tool,'driver','key-only Escape must exit assembly');report.cases.push({name:'Escape-without-code'});
 await page.keyboard.press('Digit5');assert.deepEqual((await state()).modules,draft);await page.keyboard.press('Escape');assert.equal((await state()).tool,'driver');report.cases.push({name:'normal-Escape-and-reentry'});
 assert.deepEqual(report.errors,[]);report.passed=true;
}finally{await writeFile(out+'/report.json',JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify(report));
