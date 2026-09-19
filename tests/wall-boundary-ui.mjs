import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {blockPointerLock} from './browser-safety.mjs';

const before=process.argv.includes('--before'),out=`output/wall-boundary-${before?'before':'after'}`;
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={url:'http://127.0.0.1:5364/Electrical-Game/',trials:[],errors:[]};
try{
 const page=await browser.newPage({viewport:{width:1366,height:768}});
 await blockPointerLock(page.context());await page.routeWebSocket('**',()=>{});
 page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(report.url+'?renderer=webgl');await page.waitForFunction(()=>window.__wireTheHouse);
 await page.locator('#start-button').click();await page.waitForTimeout(500);
 await page.evaluate(()=>{const g=window.__wireTheHouse;window.step=g.step.bind(g);g.step=()=>{};});
 for(const side of ['left','right'])for(const crouch of [false,true])for(const sprint of [false,true]){
  await page.keyboard.press('Digit4');await page.evaluate(()=>window.step(1/60));await page.locator(`#hammer-view-${side}`).click();
  await page.evaluate(({side,crouch})=>{const g=window.__wireTheHouse,p=g.player;p.crouched=crouch;p.yaw=side==='left'?1.5:-1.5;p.pitch=0;p.workPosition.locked=false;p.workPosition.released=false;g.renderer.camera.position.set(0,crouch?.95:1.65,-2);window.step(0);},{side,crouch});
  const key=side==='left'?'KeyD':'KeyA';if(sprint)await page.keyboard.down('ShiftLeft');await page.keyboard.down(key);
  const trial=await page.evaluate(()=>{const g=window.__wireTheHouse,samples=[],times=[];for(let i=0;i<100;i++){const t=performance.now();window.step(1/60);times.push(performance.now()-t);samples.push(g.renderer.camera.position.z);}times.sort((a,b)=>a-b);return{position:g.renderer.camera.position.toArray(),minZ:Math.min(...samples),stepP95:times[95],stepMax:times.at(-1)};});
  await page.keyboard.up(key);if(sprint)await page.keyboard.up('ShiftLeft');
  report.trials.push({side,crouch,sprint,...trial});
  if(!crouch&&!sprint){await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/${side}.png`});}
 }
 // Free movement away from the facade must still work; collision cannot freeze the player.
 await page.keyboard.press('Digit1');await page.evaluate(()=>{const g=window.__wireTheHouse;g.player.yaw=0;g.player.pitch=0;g.player.crouched=false;g.renderer.camera.position.set(0,1.65,-2.13);});
 await page.keyboard.down('KeyS');await page.evaluate(()=>{for(let i=0;i<30;i++)window.step(1/60);});await page.keyboard.up('KeyS');
 report.retreatZ=await page.evaluate(()=>window.__wireTheHouse.renderer.camera.position.z);
 report.passed=report.trials.every(t=>t.minZ>=-2.13-1e-6)&&report.retreatZ> -1.2;
 assert.deepEqual(report.errors,[]);assert(report.passed,'Player crossed the masonry facade');
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report));}
