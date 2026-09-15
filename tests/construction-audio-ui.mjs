import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {blockPointerLock} from './browser-safety.mjs';

const url=process.argv[2]??'http://127.0.0.1:5362/Electrical-Game/';
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await blockPointerLock(context);
const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
try{
  await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse?.audio,undefined,{timeout:120000});await page.locator('#start-button').tap();
  await page.evaluate(()=>{const g=window.__wireTheHouse;window.__audioStep=g.step.bind(g);g.step=()=>{};const oneShots=['hammer','box','level','spring','cutter','mark','laser','trowel-whoosh','mortar-splat','water-pour','sack-tear','cement-scrape','sand-scoop','mixer-insert','mixer-rinse'];for(const sound of oneShots)g.audio.play(sound);for(const sound of ['spray','hose','drill','driver','trowel','mixer'])g.audio.setContinuous(sound,true);});
  await page.waitForTimeout(120);
  const active=await page.evaluate(()=>window.__wireTheHouse.audio.telemetry);assert.equal(active.contextState,'running','Real pointer gesture must unlock Web Audio');assert.equal(Object.keys(active.events).length,15);assert(Object.values(active.events).every(count=>count===1));assert(Object.values(active.activeLoops).every(Boolean),'Every continuous construction tool loop must run');
  await page.evaluate(()=>{const a=window.__wireTheHouse.audio;for(const sound of ['spray','hose','drill','driver','trowel','mixer'])a.setContinuous(sound,false);});await page.waitForTimeout(100);
  const stopped=await page.evaluate(()=>window.__wireTheHouse.audio.telemetry);assert(Object.values(stopped.activeLoops).every(active=>!active),'All loops must stop on tool release');assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,context:active.contextState,oneShots:active.events,loops:Object.keys(active.activeLoops),loopTransitions:stopped.loopTransitions}));
}finally{await context.close();await browser.close();}
