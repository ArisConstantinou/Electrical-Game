import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { blockPointerLock } from './browser-safety.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5362/Electrical-Game/';
const out = process.argv[3] ?? 'output/hammer-free-look-ui';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { url, mobileIsEmulation: true, fixture: 'Pointer Lock blocked before page scripts. Fixed starting camera and simulation clock. Native keyboard held hammer and mobile touch drag. Desktop relative look deltas call the production PlayerController because real OS Pointer Lock is forbidden. Contacts and damage are unmodified.', cases: [], errors: [] };
const step = (page, frames) => page.evaluate(frames => { for (let i = 0; i < frames; i++) window.__freeLookStep(1 / 60); }, frames);
const state = page => page.evaluate(() => {
  const g = window.__wireTheHouse, c = g.renderer.camera, w = g.room.brickWall;
  const ray = c.getWorldDirection(c.position.clone());
  return { yaw: g.player.yaw, pitch: g.player.pitch, quaternion: c.quaternion.toArray(), position: c.position.toArray(), focus: c.position.clone().addScaledVector(ray, (w.volume.frontZ - c.position.z) / ray.z).toArray(), impacts: w.impactCount, removedCm3: w.volume.removedVolume * 1e6, reachable: g.fpsRig.reachable, reason: g.fpsRig.reachReason, tilt: g.fpsRig.actualTiltDegrees, requestedTilt: w.chiselTiltDegrees, held: g.input.actionHeld, locked: g.player.workPosition.locked, pose: g.fpsRig.debugPose(), overflow: document.documentElement.scrollWidth > innerWidth, renderError: g.renderer.renderError, pointerLock: document.pointerLockElement?.id ?? null };
});
const unchanged = (before, after, label) => {
  for (const key of ['yaw', 'pitch']) assert(Math.abs(before[key] - after[key]) < 1e-10, `${label}: ${key} recentered`);
  for (const key of ['position', 'quaternion', 'focus']) assert(before[key].every((value, i) => Math.abs(value - after[key][i]) < 1e-8), `${label}: ${key} drifted while input was stationary`);
};
async function capture(page, name) {
  await page.evaluate(async () => { const g = window.__wireTheHouse; await g.room.brickWall.waitForGeometry(); await g.renderer.waitForFrame(); window.__freeLookStep(0); await g.renderer.waitForFrame(); });
  await page.screenshot({ path: `${out}/${name}.png` });
}

try {
  for (const mobile of [false, true]) {
    const platform = mobile ? 'mobile' : 'desktop';
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 768 }, isMobile: mobile, hasTouch: mobile });
    await blockPointerLock(context);
    const page = await context.newPage(); page.on('pageerror', error => report.errors.push(`${platform}: ${error.message}`));
    await page.goto(url); await page.waitForFunction(() => window.__wireTheHouse?.renderer.renderCamera, { timeout: 120000 });
    const click = id => page.locator(id)[mobile ? 'tap' : 'click']();
    await click('#start-button');
    await page.evaluate(() => { const g = window.__wireTheHouse; window.__freeLookStep = g.step.bind(g); g.step = () => {}; });
    if (mobile) await click('[data-tool="hammer"]'); else await page.keyboard.press('Digit4');
    await page.evaluate(() => {
      const g = window.__wireTheHouse, c = g.renderer.camera;
      c.position.set(.72, 1.65, g.room.brickWall.volume.frontZ + .95); c.lookAt(.72, 1.25, g.room.brickWall.volume.frontZ);
      g.player.yaw = c.rotation.y; g.player.pitch = c.rotation.x;
    });
    await step(page, 180);
    const cdp = mobile ? await context.newCDPSession(page) : null;
    for (const angle of [15, 45, -45]) {
      if (angle !== 15) {
        await click('#settings-toggle');
        while ((await state(page)).requestedTilt !== angle) await click('#chisel-tilt');
        if(angle<0){await click('#mortar-settings summary');await click('#work-height');}
        await click('#settings-close');
      }
      await page.evaluate(angle=>{
        const g=window.__wireTheHouse,c=g.renderer.camera,x=angle===15?.1:angle===45?.72:1.35;
        g.player.workPosition.locked=false;g.player.workPosition.released=false;
        c.position.set(x,g.player.eyeHeight,g.room.brickWall.volume.frontZ+1.05);
        c.lookAt(x,angle===15?1.25:1.02,g.room.brickWall.volume.frontZ);
        g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;
      },angle);
      // Explicit approach takes up the new physical distance. Upward work uses
      // the native crouch setting instead of an automatic downward eye orbit.
      await step(page,90);
      if(mobile){const b=await page.locator('#joystick').boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width*.5,y:b.y+b.height*.15,id:2}]});}
      else await page.keyboard.down('KeyW');
      await step(page,90);
      if(mobile)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else await page.keyboard.up('KeyW');
      await step(page,120);
      const initial = await state(page), entry = { platform, angle, initial, samples: [] }; report.cases.push(entry);
      let touch;
      if (mobile) { const b = await page.locator('#look-joystick').boundingBox(); touch = { x: b.x + b.width * .5, y: b.y + b.height * .5, id: 3 }; await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch] }); }
      else await page.keyboard.down('KeyE');
      for (const [dx, dy] of [[18, -6], [-18, 6]]) {
        const before = await state(page);
        if (mobile) { touch = { ...touch, x: touch.x + dx, y: touch.y + dy }; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch] }); }
        else await page.evaluate(({ dx, dy }) => window.__wireTheHouse.player.look(dx, dy), { dx, dy });
        await step(page, 1);
        const moved = await state(page);
        assert((moved.yaw - before.yaw) * dx < 0, `${platform}/${angle}: look or reversal did not immediately move aim`);
        await step(page, 120);
        const idle = await state(page);
        unchanged(moved, idle, `${platform}/${angle}: held hammer after look`);
        entry.samples.push({ moved, idle });
      }
      if (mobile) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); else await page.keyboard.up('KeyE');
      const released = await state(page); await step(page, 90); const settled = await state(page);
      unchanged(released, settled, `${platform}/${angle}: released hammer`);
      assert.equal(settled.impacts, released.impacts, 'Release must stop strikes');
      assert(settled.impacts >= initial.impacts+3 && settled.removedCm3 > initial.removedCm3, `${platform}/${angle}: ordinary aiming must retain repeated real tool contact`);
      assert.equal(settled.pointerLock, null); assert.equal(settled.renderError, ''); assert.equal(settled.overflow, false);
      entry.final = settled;
      await capture(page, `${platform}-${angle}-free-aim`);
      await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
    }
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify({ passed: true, cases: report.cases.map(item => ({ platform: item.platform, angle: item.angle, addedImpacts: item.final.impacts - item.initial.impacts, removedCm3: item.final.removedCm3 - item.initial.removedCm3 })), errors: report.errors }, null, 2));
} catch (error) { report.failure = String(error.stack ?? error); throw error; }
finally { await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); await browser.close(); }
