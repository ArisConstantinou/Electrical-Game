import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';

const url=process.argv[2]??'http://127.0.0.1:5362/Electrical-Game/';
const out=process.argv[3]??'output/default-flood-ui';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={url,mobileIsEmulation:true,fixture:'Camera orientation only. Default water-gun selection and continuous held input use native keyboard/touch. All flooding uses the real animation clock; no injected water, Game.step calls, advanceTime, renderer stubs or settings changes.',scenarios:[]};
const snapshot=page=>page.evaluate(()=>{
  const g=window.__wireTheHouse,w=g.roomWater,p=w.surfaceGeometry.getAttribute('position');
  let minY=Infinity,maxY=-Infinity;for(let i=0;i<p.count;i++){minY=Math.min(minY,p.getY(i));maxY=Math.max(maxY,p.getY(i));}
  return {wallClockMs:performance.now(),...JSON.parse(g.renderState()).water,minSurfaceY:minY,maxSurfaceY:maxY,surfaceVertices:p.count,surfaceIndexCount:w.surfaceGeometry.drawRange.count,renderError:g.renderer.renderError,actionHeld:g.input.actionHeld,readout:document.querySelector('#water-gun-readout')?.textContent,selectedMode:document.querySelector('#water-gun-mode')?.value,nozzleError:w.jetState.origin.distanceTo(g.fpsRig.toolTipWorld(g.renderer.camera,'hose')),nozzleAlignment:w.jetState.direction.dot(g.fpsRig.waterGunDirectionWorld()),overflow:document.documentElement.scrollWidth>innerWidth};
});
try {
  for(const spec of [{name:'desktop'},{name:'mobile',mobile:true},{name:'throttled-desktop',throttle:true}].filter(s=>!process.env.QA_SCENARIO||s.name===process.env.QA_SCENARIO)) {
    const mobile=!!spec.mobile,name=spec.name;
    const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1366,height:768},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1});
    const page=await context.newPage(),errors=[];
    if(spec.throttle)await page.addInitScript(()=>{const raf=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=callback=>raf(()=>setTimeout(()=>callback(performance.now()),100));});
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto(url,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__wireTheHouse?.roomWater.waterProActive,{timeout:120000});
    await page.locator('#start-button')[mobile?'tap':'click']();await page.evaluate(()=>document.exitPointerLock());
    if(mobile)await page.locator('[data-tool="hose"]').tap();else await page.keyboard.press('Digit8');
    await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera;c.position.set(0,g.player.eyeHeight,1.2);c.lookAt(-.25,0,-.5);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;});
    await page.waitForTimeout(400);
    const cdp=mobile?await context.newCDPSession(page):null;
    async function hold(){if(cdp){const b=await page.locator('#look-joystick').boundingBox(),t={x:b.x+b.width/2,y:b.y+b.height/2,id:1};await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[t]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...t,x:t.x+5}]});}else await page.keyboard.down('KeyE');}
    async function release(){if(cdp)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else await page.keyboard.up('KeyE');}
    async function shot(label){await page.screenshot({path:`${out}/${name}-${label}.png`});if(['35s','after-release-2s'].includes(label)){const {width,height}=page.viewportSize();await page.screenshot({path:`${out}/${name}-${label}-water-detail.png`,clip:{x:width*.06,y:height*.48,width:width*.3,height:height*.16}});}}
    const before=await snapshot(page);assert.equal(before.gunMode,'flood',`${name}: ordinary selection defaults to flood`);assert.equal(before.selectedMode,'flood');assert(before.active);assert.equal(before.floorLitres,0);assert.equal(before.overflow,false);await shot('before');
    // First release check is deliberately early; the subsequent 35-second
    // uninterrupted hold is measured separately from this small source test.
    await hold();await page.waitForTimeout(350);await release();await page.waitForTimeout(150);const earlyStop=await snapshot(page);await page.waitForTimeout(400);const stillStopped=await snapshot(page);assert.equal(stillStopped.gunLitres,earlyStop.gunLitres);assert.equal(stillStopped.jetActive,false);assert.equal(stillStopped.actionHeld,false);
    if(spec.throttle){
      const throttleStart=await snapshot(page);await hold();await page.waitForTimeout(5150);const throttleEnd=await snapshot(page);await shot('5s');await release();
      const elapsed=(throttleEnd.wallClockMs-throttleStart.wallClockMs)/1000,emitted=throttleEnd.gunLitres-throttleStart.gunLitres;
      assert(emitted>=160*elapsed*.9,'10 fps still emits at least 90% of the real-time selected flow');assert(emitted<=160*elapsed*1.1,'10 fps does not duplicate source volume');assert(Math.abs(throttleEnd.conservationErrorLitres)<1e-5);assert.equal(throttleEnd.renderError,'');assert.deepEqual(errors,[]);
      report.scenarios.push({name,before,earlyStop,stillStopped,throttleStart,throttleEnd,elapsed,emitted,errors});console.log(JSON.stringify({name,wallSeconds:elapsed,emittedLitres:emitted,litresPerSecond:emitted/elapsed,errors}));await context.close();continue;
    }
    await hold();const start=await snapshot(page);await page.waitForTimeout(10000);const ten=await snapshot(page);await shot('10s');
    const remaining=Math.max(0,35050-(ten.wallClockMs-start.wallClockMs));await page.waitForTimeout(remaining);const end=await snapshot(page);await shot('35s');await release();
    assert(end.wallClockMs-start.wallClockMs>=35000,`${name}: at least 35 seconds of real elapsed holding`);assert.equal(end.actionHeld,true);assert.equal(end.jetActive,true);assert(ten.floorLitres>start.floorLitres+300,`${name}: visibly growing water within ten seconds`);assert(end.meanDepthMm-start.meanDepthMm>=100,`${name}: default input raises room mean level by at least ten centimetres`);assert(end.floorLitres>ten.floorLitres);assert(end.minSurfaceY>.07,`${name}: whole rendered room water surface is raised`);assert(end.minSurfaceY>ten.minSurfaceY+.03);assert(end.wetAreaM2>28);assert(Math.abs(end.conservationErrorLitres)<1e-5);assert(end.nozzleError<.0005);assert(end.nozzleAlignment>.99999);assert.match(end.readout,/cm/);assert.equal(end.renderError,'');assert.equal(end.overflow,false);
    await page.waitForTimeout(200);const released=await snapshot(page);await page.waitForTimeout(2000);const after=await snapshot(page);await shot('after-release-2s');assert.equal(after.gunLitres,released.gunLitres,`${name}: release stops the source`);assert.equal(after.jetActive,false);assert(after.floorLitres>=end.floorLitres,'remaining airborne water may settle after release');assert.deepEqual(errors,[]);
    report.scenarios.push({name,before,earlyStop,stillStopped,start,ten,end,released,after,errors});console.log(JSON.stringify({name,wallSeconds:(end.wallClockMs-start.wallClockMs)/1000,litres:end.floorLitres,meanDepthCm:end.meanDepthMm/10,minSurfaceY:end.minSurfaceY,errors}));await context.close();
  }
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
