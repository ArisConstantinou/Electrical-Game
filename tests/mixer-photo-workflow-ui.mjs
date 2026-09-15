import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir, writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';

const url = process.argv.find(arg => /^https?:/.test(arg)) ?? 'http://127.0.0.1:5362/Electrical-Game/';
const repro = process.argv.includes('--repro');
const out = 'output/mixer-photo-workflow';
await mkdir(out, {recursive:true});
const report = {url, repro, mobileIsEmulation:true, cases:[], errors:[], passed:false};
const browser = await chromium.launch({channel:'chrome', headless:true});
try {
  for (const layout of [
    {name:'desktop', width:1366, height:768, mobile:false},
    {name:'portrait', width:390, height:676, mobile:true},
    {name:'landscape', width:844, height:390, mobile:true},
  ]) {
    const context = await browser.newContext({viewport:{width:layout.width,height:layout.height}, isMobile:layout.mobile, hasTouch:layout.mobile});
    await blockPointerLock(context);
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(`${layout.name}: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(`${layout.name}: ${message.text()}`); });
    await page.goto(url);
    await page.waitForFunction(() => window.__wireTheHouse?.mixing, undefined, {timeout:120000});
    await page.locator('#start-button')[layout.mobile?'tap':'click']();
    await page.waitForTimeout(350);
    await page.evaluate(() => {
      const g = window.__wireTheHouse;
      window.__photoStep = g.step.bind(g);
      g.step = () => {};
    });
    const step = (count=1) => page.evaluate(n => { for (let i=0;i<n;i++) window.__photoStep(1/60); }, count);
    const sample = () => page.evaluate(() => {
      const g=window.__wireTheHouse, m=g.mixing;
      return {
        mixing:m.telemetry, input:{actionHeld:g.input.actionHeld,interactionHeld:g.input.interactionHeld},
        camera:g.renderer.camera.position.toArray(), crouched:g.player.crouched,
        hands:m.arms.map(arm => ({reach:arm.shoulder.distanceTo(arm.wrist),forearm:arm.elbow.distanceTo(arm.wrist)})),
        motorSound:Boolean(g.audio.telemetry.activeLoops.mixer),
        prompt:document.querySelector('#mixing-world-prompt').textContent,
        receipt:document.querySelector('#mixing-receipt').innerText,
        receiptStatus:document.querySelector('#mixing-receipt p').innerText,
        paddleAngle:m.models.paddle.rotation.y,
        bucketFillVisible:m.models.fill.visible,
        use:document.querySelector('#mobile-use-status').textContent,
        overflow:document.documentElement.scrollWidth>innerWidth,
        renderError:g.renderer.renderError,
      };
    });
    const standAsPhoto = async () => {
      // Reproduce the supplied photo's ordinary standing approach, deliberately
      // outside arm reach. Only actual USE input may close distance and crouch.
      await page.evaluate(() => {
        const g=window.__wireTheHouse, c=g.renderer.camera;
        const bucket=g.mixing.models.bucket.getWorldPosition(c.position.clone());
        g.player.crouched=false;
        c.position.set(bucket.x,1.65,bucket.z-.98);
        c.lookAt(bucket.x,bucket.y+.3,bucket.z);
        g.player.yaw=c.rotation.y; g.player.pitch=c.rotation.x;
        c.updateMatrixWorld(true);
      });
      await step(2);
    };
    const equip = async tool => { await page.locator(`[data-mix-equip="${tool}"]`)[layout.mobile?'tap':'click'](); await step(2); };
    const cdp = layout.mobile ? await context.newCDPSession(page) : null;
    const useDown = async () => {
      if (layout.mobile) {
        const box=await page.locator('#look-joystick').boundingBox();
        assert(box,'USE touch target is visible');
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:81,x:box.x+box.width/2,y:box.y+box.height/2}]});
      } else { await page.mouse.move(layout.width/2,layout.height*.42); await page.mouse.down(); }
    };
    const useUp = async () => {
      if (layout.mobile) await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      else await page.mouse.up();
      await step(2);
    };
    const shot = async name => {
      await page.evaluate(async () => { const r=window.__wireTheHouse.renderer; await r.waitForFrame(); r.render(); await r.waitForFrame(); });
      await page.screenshot({path:`${out}/${layout.name}-${repro?'repro-':''}${name}.png`});
    };
    await standAsPhoto();
    await equip('mixer');
    const before=await sample();
    assert.equal(before.mixing.aimedTarget,'bucket','Photo-like standing view targets the bucket');
    assert.equal(before.crouched,false);
    assert.equal(before.mixing.inserted,false);
    assert.equal(before.mixing.batch.massKg,0);
    await shot('standing');
    await useDown();
    const input=await sample();
    assert.equal(input.input.actionHeld,true,'Real USE input is held');
    const approach=[];
    for (let frame=0;frame<150;frame++) { await step(); approach.push(await sample()); }
    const emptyHeld=await sample();
    await shot('empty-use-held');
    await useUp();
    const released=await sample();
    if (repro) {
      report.cases.push({layout:layout.name,before,input,emptyHeld,released});
      await context.close();
      continue;
    }
    assert(emptyHeld.mixing.inserted && emptyHeld.mixing.mixing,'Holding USE from the photo position inserts and runs the mixer without manual crouch');
    assert(emptyHeld.crouched,'Work input adopts a reachable crouched stance');
    assert(emptyHeld.motorSound,'The running mixer has its continuous motor sound');
    assert.equal(emptyHeld.mixing.batch.mixProgress,0,'An empty bucket never acquires fake mixing progress');
    assert.equal(emptyHeld.mixing.batch.ready,false);
    assert.equal(emptyHeld.bucketFillVisible,false,'Running an empty mixer does not render imaginary ingredients');
    assert(Math.abs(emptyHeld.paddleAngle-before.paddleAngle)>.1,'Visible mixer paddle rotates while motor is held');
    assert.match(emptyHeld.receiptStatus,/νερό.*τσιμέντο.*άμμο/is,'Visible receipt status explains which ingredients are missing');
    for (let i=0;i<approach.length;i++) {
      const previous=i?approach[i-1]:before;
      assert(Math.hypot(...approach[i].camera.map((v,j)=>v-previous.camera[j]))<.09,'Assisted work stance moves continuously rather than teleporting');
      assert(approach[i].hands.every(hand=>hand.reach<.57 && Math.abs(hand.forearm-.27)<.001),'Arms remain attached throughout approach and insertion');
    }
    assert.equal(released.mixing.mixing,false,'Releasing USE stops the motor');
    assert.equal(released.motorSound,false);
    const resetMixerStanding = async () => {
      if ((await sample()).mixing.tool==='mixer') await equip('mixer');
      await standAsPhoto(); await equip('mixer');
    };
    // A short press explicitly requests insertion. It finishes seating after
    // release, while the motor still requires a held pointer.
    await resetMixerStanding(); await useDown(); await step(3);
    assert.equal((await sample()).mixing.approaching,true);
    await useUp(); await step(90);
    const tapSeated=await sample();
    assert(tapSeated.mixing.inserted,'A short USE tap finishes the requested seating');
    assert.equal(tapSeated.mixing.mixing,false,'A released tap cannot latch the motor on');
    assert.equal(tapSeated.motorSound,false);
    // Manual movement takes priority over the pending seating request.
    await resetMixerStanding(); await useDown(); await step(3); await useUp();
    assert.equal((await sample()).mixing.approaching,true);
    if(layout.mobile) {
      const box=await page.locator('#mobile-move-zone').boundingBox();
      assert(box,'Movement touch zone is visible');
      const point={id:82,x:box.x+box.width*.5,y:box.y+box.height*.5};
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...point,x:point.x+28}]});
    } else await page.keyboard.down('KeyD');
    await step(3);
    const movementCanceled=await sample();
    assert.equal(movementCanceled.mixing.approaching,false,'Manual movement cancels the pending stance');
    if(layout.mobile) await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    else await page.keyboard.up('KeyD');
    await step(90);
    assert.equal((await sample()).mixing.inserted,false,'Canceled movement never inserts later');
    // Toolbar selection must also cancel rather than later reinsert the old tool.
    await resetMixerStanding(); await useDown(); await step(3); await useUp();
    await equip('shovel'); await step(90);
    const toolCanceled=await sample();
    assert.equal(toolCanceled.mixing.tool,'shovel');
    assert.equal(toolCanceled.mixing.approaching,false);
    assert.equal(toolCanceled.mixing.inserted,false);
    assert.equal(toolCanceled.mixing.mixing,false);
    // The complete recipe is an independent fixture; motor control still uses
    // the real touch/mouse path and begins at the same standing photo position.
    await page.evaluate(() => {
      const b=window.__wireTheHouse.mixing.batch;
      b.addWater(20/3); b.openSack(0);
      for(let i=0;i<6;i++){ b.scoopCement(0); b.pour('trowel'); }
      for(let i=0;i<12;i++){ b.scoopSand(); b.pour('shovel'); }
    });
    await resetMixerStanding(); await useDown(); await step(150);
    const filledHeld=await sample();
    assert(filledHeld.mixing.inserted && filledHeld.mixing.mixing);
    assert(filledHeld.mixing.batch.mixProgress>0,'The motor advances a recipe containing all ingredients');
    await shot('filled-use-held'); await useUp();
    const filledReleased=await sample(); await step(90);
    assert.equal((await sample()).mixing.batch.mixProgress,filledReleased.mixing.batch.mixProgress,'Mixing progress stops when the real pointer releases');
    assert.equal(filledReleased.mixing.mixing,false);
    assert.equal(filledReleased.motorSound,false);
    assert.equal(filledReleased.overflow,false);
    assert.equal(filledReleased.renderError,'');
    report.cases.push({layout:layout.name,before,emptyHeld,released,tapSeated,movementCanceled,toolCanceled,filledHeld,filledReleased,approachFrames:approach.length});
    await context.close();
  }
  assert.deepEqual(report.errors,[]);
  report.passed=!repro;
} finally {
  await writeFile(`${out}/${repro?'repro':'report'}.json`,JSON.stringify(report,null,2));
  await browser.close();
}
console.log(JSON.stringify({passed:report.passed,repro,layouts:report.cases.map(c=>c.layout),report:`${out}/${repro?'repro':'report'}.json`}));
