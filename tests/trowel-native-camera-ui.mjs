import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
const out=process.argv[2]??'output/trowel-native-camera';await mkdir(out,{recursive:true});
const url=process.env.QA_BASE??'http://127.0.0.1:5362/Electrical-Game/';
const report={url,clock:'Unmodified live requestAnimationFrame and physics; only initial camera pose is authored.',mobileIsEmulation:true,cases:[],errors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const viewport of [{width:390,height:844},{width:844,height:390}]){
  const context=await browser.newContext({viewport,isMobile:true,hasTouch:true});await blockPointerLock(context);const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse);await page.locator('#start-button').tap();await page.locator('[data-tool="trowel"]').tap();
  await page.evaluate(()=>{const g=window.__wireTheHouse,look=g.player.look.bind(g.player),step=g.step.bind(g);window.__cameraTrace=[];window.__manualPitch=g.player.pitch;g.player.look=(...args)=>{look(...args);window.__manualPitch=g.player.pitch;};g.step=(...args)=>{step(...args);window.__cameraTrace.push({pitch:g.player.pitch,expected:window.__manualPitch,yaw:g.player.yaw,held:g.input.actionHeld,mobileLook:{...g.input.mobileLook},stage:g.mortar.throwFeedback.stage,mass:g.mortar.launchedMass});};});
  const cdp=await context.newCDPSession(page),touches=new Map();
  const start=async(id,x,y)=>{touches.set(id,{id,x,y});await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[...touches.values()]});};
  const move=async(id,x,y)=>{touches.set(id,{id,x,y});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[...touches.values()]});};
  const end=async id=>{const ending=touches.get(id);touches.delete(id);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:touches.size?[ending]:[]});};
  const state=()=>page.evaluate(()=>{const g=window.__wireTheHouse;return{pitch:g.player.pitch,yaw:g.player.yaw,held:g.input.actionHeld,look:{...g.input.mobileLook},move:{...g.input.mobileMove},mass:g.mortar.launchedMass,trace:window.__cameraTrace.slice(),pointerLock:!!document.pointerLockElement};});
  for(const mode of ['drag','stick']){
   if(await page.evaluate(mode=>window.__wireTheHouse.aimInputMode!==mode,mode)){
    await page.locator('#quick-aim-input').tap();await page.waitForFunction(mode=>window.__wireTheHouse.aimInputMode===mode,mode);
   }
   for(let i=0;i<3;i++){
    const profile=await page.evaluate(()=>window.__wireTheHouse.aimProfile);if(profile==='fast')break;
    await page.locator('#quick-aim-speed').tap();await page.waitForFunction(previous=>window.__wireTheHouse.aimProfile!==previous,profile);
   }
   await page.waitForFunction(mode=>document.querySelector('#quick-aim-input b').textContent.toLowerCase()===mode&&document.querySelector('#quick-aim-speed b').textContent==='FAST',mode);
   assert.deepEqual(await page.evaluate(()=>({mode:window.__wireTheHouse.mobileControls.aimInputMode,profile:window.__wireTheHouse.aimProfile})),{mode,profile:'fast'});
   await page.evaluate(()=>{const g=window.__wireTheHouse;g.renderer.camera.position.set(0,1.65,g.room.brickWall.volume.frontZ+.62);g.player.yaw=0;g.player.pitch=-.2;g.renderer.camera.rotation.set(-.2,0,0);window.__manualPitch=-.2;window.__cameraTrace=[];});
   const pad=await page.locator('#look-joystick').boundingBox(),x=pad.x+pad.width/2,y=pad.y+pad.height/2;
   const before=await state();await start(1,x,y);await page.waitForTimeout(470);await end(1);const released=await state();await page.waitForTimeout(1100);const recovered=await state();
   assert.equal(recovered.pitch,before.pitch,`${mode}: stationary hold/release forced the camera downward`);assert.equal(recovered.yaw,before.yaw);
   assert(Math.abs(recovered.mass-before.mass-.65)<1e-8);assert.deepEqual(recovered.look,{x:0,y:0});
   // Landing low/right on USE must not create aim input by itself. A new
   // gesture establishes its neutral position beneath the actual finger.
   await start(1,x+pad.width*.15,y+pad.height*.24);await page.waitForTimeout(470);const offCenterHeld=await state();
   assert.equal(offCenterHeld.pitch,recovered.pitch,`${mode}: an off-centre stationary press rotated the camera`);assert.equal(offCenterHeld.yaw,recovered.yaw);assert(offCenterHeld.held);
   await end(1);await page.waitForTimeout(1100);const offCenterRecovery=await state();assert.equal(offCenterRecovery.pitch,recovered.pitch);assert(Math.abs(offCenterRecovery.mass-recovered.mass-.65)<1e-8);
   // Explicit use-and-aim motion, then finger lifted at its off-centre endpoint.
   await start(1,x,y);await move(1,x+18,y-15);await page.waitForTimeout(430);await end(1);const aimedRelease=await state();await page.waitForTimeout(1000);const aimedRecovery=await state();
   assert.equal(aimedRecovery.pitch,aimedRelease.pitch,`${mode}: stale aim continued after off-centre release`);assert.equal(aimedRecovery.yaw,aimedRelease.yaw);assert(!aimedRecovery.held);assert.deepEqual(aimedRecovery.look,{x:0,y:0});
   // Three fingers: movement, USE+aim and separate free look. Releasing USE
   // must preserve the two remaining inputs, without inventing a pitch delta.
   const zone=await page.locator('#mobile-move-zone').boundingBox(),mx=zone.x+zone.width*.45,my=zone.y+zone.height*.45,fx=viewport.width*.68,fy=viewport.height*.40;
   await start(2,mx,my);await move(2,mx+10,my-8);await start(1,x,y);await start(3,fx,fy);await move(3,fx+7,fy-6);await page.waitForTimeout(460);await end(1);
   const simultaneousRelease=await state();assert(!simultaneousRelease.held);assert(Math.hypot(simultaneousRelease.move.x,simultaneousRelease.move.y)>0);
   await move(3,fx+14,fy-12);await page.waitForTimeout(80);const continuedLook=await state();assert(continuedLook.pitch>simultaneousRelease.pitch,'Free-look finger must keep control after USE release');
   await end(3);await end(2);const allReleased=await state();await page.waitForTimeout(1000);const final=await state();
   assert.equal(final.pitch,allReleased.pitch,`${mode}: camera drifted after every finger lifted`);assert.deepEqual(final.move,{x:0,y:0});assert.deepEqual(final.look,{x:0,y:0});
   assert(final.trace.every(sample=>Math.abs(sample.pitch-sample.expected)<1e-10),'A camera update changed pitch outside explicit player look');
   assert(!final.pointerLock);await page.screenshot({path:`${out}/${viewport.width}-${mode}.png`});
   assert.deepEqual(await page.evaluate(()=>({mode:window.__wireTheHouse.mobileControls.aimInputMode,profile:window.__wireTheHouse.aimProfile})),{mode,profile:'fast'});
   report.cases.push({viewport,mode,profile:'fast',beforePitch:before.pitch,stationaryReleasePitch:released.pitch,recoveredPitch:recovered.pitch,offCenterHeldPitch:offCenterHeld.pitch,offCenterRecoveryPitch:offCenterRecovery.pitch,aimedReleasePitch:aimedRelease.pitch,aimedRecoveryPitch:aimedRecovery.pitch,simultaneousReleasePitch:simultaneousRelease.pitch,continuedLookPitch:continuedLook.pitch,finalPitch:final.pitch,frames:final.trace.length});
  }
  await context.close();
 }
 assert.deepEqual(report.errors,[]);report.passed=true;console.log(JSON.stringify(report,null,2));
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
