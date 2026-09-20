import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
const url=process.argv[2]??'http://127.0.0.1:5365/Electrical-Game/',out=process.argv[3]??'output/debris-restrike-ui';
await mkdir(out,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true});
const report={url,fixture:'Real moving 35-degree masonry cuts create lodged fragments. Starting cut and camera are fixtures; rebreaking uses native held keyboard/touch with production tool contact. No particle scaling/relocation. Pointer Lock prohibited. Mobile is browser emulation.',cases:[],errors:[]};
const step=(page,n)=>page.evaluate(async n=>{for(let i=0;i<n;i++){window.__debrisStep(1/60);if(i%12===11)await window.__wireTheHouse.chasing.waitForDebrisSplits()}},n);
async function shot(page,name){await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.room.brickWall.waitForGeometry();g.renderer.render();await g.renderer.waitForFrame()});await page.screenshot({path:`${out}/${name}.png`})}
try{for(const mobile of [false,true]){
 const platform=mobile?'mobile':'desktop',context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1366,height:768},isMobile:mobile,hasTouch:mobile});await blockPointerLock(context);
 await context.addInitScript(()=>{const random=crypto.getRandomValues.bind(crypto);crypto.getRandomValues=a=>a instanceof Uint32Array&&a.length===1?(a[0]=193187,a):random(a)});
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(`${platform}: ${e.message}`));await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse?.roomWater.waterProActive);
 await page.locator('#start-button')[mobile?'tap':'click']();await page.keyboard.press('Digit4');
 const initial=await page.evaluate(async()=>{
  const g=window.__wireTheHouse,w=g.room.brickWall,v=w.volume,s=g.chasing;window.__debrisStep=g.step.bind(g);g.step=()=>{};
  const a=35*Math.PI/180,d={x:0,y:-Math.sin(a),z:-Math.cos(a)};
  for(let i=0;i<20;i++){const e={x:.58+i*.01,y:1.48,z:v.frontZ},o={x:e.x,y:e.y-d.y*.3,z:e.z-d.z*.3},h=v.raycast(o,d,.65);if(h)s.spawnDebris(v.impact({point:h.point,direction:d,edge:{x:1,y:0,z:0},energyJ:4,widthM:.05,chisel:'flat'}));for(let f=0;f<6;f++)s.update(1/60)}
  for(let f=0;f<180;f++)s.update(1/60);w.flushGeometry();await w.waitForGeometry();
  window.__lodged=s.particles.filter(p=>p.mesh.position.y>.3&&p.mesh.userData.volume>.000008);
  const c=g.renderer.camera;c.position.set(.68,1.65,v.frontZ+.9);c.lookAt(.68,1.48,v.frontZ);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;
  return{lodged:window.__lodged.length,volume:v.removedVolume};
 });
 assert(initial.lodged>0,'Fixture must start with real lodged debris');
 await page.keyboard.down('KeyW');await step(page,120);await page.keyboard.up('KeyW');await step(page,90);await shot(page,`${platform}-before`);
 let cdp,touch;
 if(mobile){cdp=await context.newCDPSession(page);const b=await page.locator('#look-joystick').boundingBox();touch={id:5,x:b.x+b.width*.5,y:b.y+b.height*.5};await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch]});touch.x+=4;await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[touch]});}else await page.keyboard.down('KeyE');
 await step(page,600);
 if(mobile)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else await page.keyboard.up('KeyE');
 await step(page,240);await shot(page,`${platform}-after`);
 const state=await page.evaluate(()=>{const g=window.__wireTheHouse,s=g.chasing;return{workerFailed:s.splitWorkerFailed,pending:s.pendingDebrisSplits,repeatedLargeHits:Math.max(0,...s.particles.filter(p=>p.mesh.position.y>.2&&p.mesh.userData.volume>.000008).map(p=>p.mesh.userData.debrisHits??0)),strikes:s.debrisStrikeCount,splits:s.debrisSplitCount,crushes:s.debrisCrushCount,originalsCleared:window.__lodged.filter(p=>!s.particles.includes(p)||p.mesh.position.y<.2).length,largeFloor:s.particles.filter(p=>p.settled&&!p.wallSupported&&p.mesh.position.y<.2&&p.mesh.userData.volume>.000008).length,ledger:s.totalEmittedVolume-s.activeFragmentVolume-s.totalRetiredVolume,wallLedger:s.totalEmittedVolume-g.room.brickWall.volume.removedVolume,pointerLock:!!document.pointerLockElement,renderError:g.renderer.renderError}});
 report.cases.push({platform,initial,state});
 assert.equal(state.workerFailed,false);assert.equal(state.pending,0);assert(state.repeatedLargeHits<20,'Repeated native blows must not leave one large piece unbreakable');assert(state.strikes>0,'Native hammer did not contact loose fragments');assert(state.splits>0,'Native hammer did not rebreak a lodged fragment');assert(state.originalsCleared>0);assert(state.largeFloor>0);assert(Math.abs(state.ledger)<1e-9);assert(Math.abs(state.wallLedger)<1e-9);assert.equal(state.pointerLock,false);assert.equal(state.renderError,'');
 await page.evaluate(()=>{const g=window.__wireTheHouse;g.renderer.camera.position.set(.68,.65,-1.2);g.renderer.camera.lookAt(.68,.03,-2.1)});await shot(page,`${platform}-floor`);
 console.log(JSON.stringify(report.cases.at(-1)));await context.close();
}assert.deepEqual(report.errors,[])}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close()}
