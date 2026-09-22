import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { blockPointerLock } from './browser-safety.mjs';
const url=process.argv[2]??'http://127.0.0.1:5365/Electrical-Game/';
const out=process.argv[3]??'output/hammer-strafe-continuity';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const step=(page,frames)=>page.evaluate(async frames=>{for(let i=0;i<frames;i++){window.__strafeStep(1/60);if((i+1)%12===0)await window.__wireTheHouse.chasing.waitForDebrisSplits();}await window.__wireTheHouse.chasing.waitForDebrisSplits();},frames);
const report={url,mobileIsEmulation:true,fixture:'Real keyboard A/D plus E or simultaneous floating move-stick and USE touch. Fixed initial camera and deterministic simulation clock; all impacts, cavity contacts and tool poses use production code. OS Pointer Lock is blocked before navigation.',cases:[],errors:[]};
try {
for(const mobile of [false,true])for(const sign of [-1,1]){
 const name=`${mobile?'mobile':'desktop'}-${sign<0?'left':'right'}`;
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1366,height:768},isMobile:mobile,hasTouch:mobile});
 await blockPointerLock(context);const page=await context.newPage();page.on('pageerror',error=>report.errors.push(`${name}: ${error.message}`));
 await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse?.renderer.renderCamera,{timeout:120000});
 const click=id=>page.locator(id)[mobile?'tap':'click']();await click('#start-button');
 if(mobile){await click('#site-pro-tools');await click('#mobile-tool-slider [data-tool="hammer"]');}
 else await page.keyboard.press('Digit4');
 await page.evaluate(sign=>{const g=window.__wireTheHouse,c=g.renderer.camera;window.__strafeStep=g.step.bind(g);g.step=()=>{};
 c.position.set(-sign*.9,1.65,g.room.brickWall.volume.frontZ+.9);c.lookAt(-sign*.5,1.35,g.room.brickWall.volume.frontZ);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;},sign);
 // Approach uses normal player input and establishes the real physical standoff.
 await page.keyboard.down('KeyW');await step(page,120);await page.keyboard.up('KeyW');
 await step(page,120);
 let cdp;
 if(mobile){cdp=await context.newCDPSession(page);const m=await page.locator('#mobile-move-zone').boundingBox(),u=await page.locator('#site-pro-use').boundingBox();const anchor={x:m.x+m.width*.5,y:m.y+m.height*.5},use={x:u.x+u.width*.5,y:u.y+u.height*.5};await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,...anchor}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:anchor.x+sign*55,y:anchor.y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:anchor.x+sign*55,y:anchor.y},{id:2,...use}]});await page.evaluate(sign=>{const g=window.__wireTheHouse;assertMobile(g.input.mobileMove.x*sign>.05&&g.input.actionHeld);function assertMobile(ok){if(!ok)throw new Error(`Touch owners failed: ${JSON.stringify({move:g.input.mobileMove,held:g.input.actionHeld,owners:{move:g.mobileControls.joystickPointer,use:g.mobileControls.usePointer}})}`);}},sign);await step(page,90);}
 else {await page.keyboard.down(sign<0?'KeyA':'KeyD');await page.keyboard.down('KeyE');}
 const samples=await page.evaluate(async()=>{const g=window.__wireTheHouse,result=[];
  for(let i=0;i<600;i++){window.__strafeStep(1/60);const c=g.renderer.camera,t=g.fpsRig.chiselTipWorld;
   result.push({frame:i,camera:c.position.toArray(),tip:t.toArray(),yaw:g.player.yaw,pitch:g.player.pitch,locked:g.player.workPosition.locked,held:g.input.actionHeld,impacts:g.room.brickWall.impactCount,removed:g.room.brickWall.volume.removedVolume,reachable:g.fpsRig.reachable,inAir:g.fpsRig.chiselInAir,debrisStrikes:g.chasing.debrisStrikeCount,debrisSplits:g.chasing.debrisSplitCount});
   // Worker completion is awaited only by this deterministic test clock.
   if((i+1)%12===0)await g.chasing.waitForDebrisSplits();
  }
  await g.chasing.waitForDebrisSplits();
  return result;
 });
 if(mobile)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else {await page.keyboard.up('KeyE');await page.keyboard.up(sign<0?'KeyA':'KeyD');}
 let maximumBackwardTipM=0,maximumCameraDepthChangeM=0,maximumTipStepM=0;
 for(let i=1;i<samples.length;i++){const a=samples[i-1],b=samples[i];
  assert((b.camera[0]-a.camera[0])*sign>0,`${name}: player stopped or moved backwards at frame ${i}`);
  assert.equal(b.yaw,a.yaw,`${name}: camera yaw recentered`);assert.equal(b.pitch,a.pitch,`${name}: camera pitch recentered`);
  maximumCameraDepthChangeM=Math.max(maximumCameraDepthChangeM,Math.abs(b.camera[2]-a.camera[2]));
  maximumBackwardTipM=Math.max(maximumBackwardTipM,-(b.tip[0]-a.tip[0])*sign);
  maximumTipStepM=Math.max(maximumTipStepM,Math.hypot(...b.tip.map((v,j)=>v-a.tip[j])));
  assert(b.locked&&b.held,`${name}: held work unexpectedly released`);
 }
 const first=samples[0],last=samples.at(-1);
 assert(maximumCameraDepthChangeM<1e-9,`${name}: wall distance reset`);
 assert(maximumBackwardTipM<.0002,`${name}: bit reset opposite held strafe by ${maximumBackwardTipM} m`);
 assert(last.impacts-first.impacts>20,`${name}: continuous cutting stopped`);
 assert(last.removed>first.removed,`${name}: no actual masonry removed`);
 assert(Math.abs(last.camera[0]-first.camera[0])>1,`${name}: test did not cross several brick/cavity boundaries (${Math.abs(last.camera[0]-first.camera[0])} m)`);
 await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.chasing.waitForDebrisSplits();await g.room.brickWall.waitForGeometry();await g.renderer.waitForFrame();window.__strafeStep(0);await g.renderer.waitForFrame();});
 await page.screenshot({path:`${out}/${name}.png`});
 const ui=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,pointerLock:document.pointerLockElement?.id??null,error:window.__wireTheHouse.renderer.renderError}));
 assert.equal(ui.overflow,false);assert.equal(ui.pointerLock,null);assert.equal(ui.error,'');
 const item={name,frames:samples.length,travelM:Math.abs(last.camera[0]-first.camera[0]),impacts:last.impacts-first.impacts,debrisStrikes:last.debrisStrikes-first.debrisStrikes,debrisSplits:last.debrisSplits-first.debrisSplits,maximumBackwardTipM,maximumCameraDepthChangeM,maximumTipStepM};report.cases.push(item);
 await writeFile(`${out}/${name}-trace.json`,JSON.stringify(samples));console.log(JSON.stringify(item));await context.close();
}
assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure=String(error.stack??error);throw error;}
finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
