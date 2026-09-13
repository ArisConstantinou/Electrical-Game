import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { blockPointerLock } from './browser-safety.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5362/Electrical-Game/';
const out = process.argv[3] ?? 'output/angled-fracture-ui';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { url, mobileIsEmulation: true, fixture: 'Fixed masonry seed, initial camera and deterministic simulation clock. Pointer Lock disabled to avoid capturing the physical cursor. Native tilt settings, approach, held demolition and release. Actual wall contact, volume removal and debris geometry.', cases: [], errors: [] };
const step = (page, frames) => page.evaluate(frames => { for (let i = 0; i < frames; i++) window.__angleStep(1 / 60); }, frames);
const state = page => page.evaluate(() => {
  const g = window.__wireTheHouse, w = g.room.brickWall;
  return { tilt: w.chiselTiltDegrees, impacts: w.impactCount, removedCm3: w.volume.removedVolume * 1e6, locked: g.player.workPosition.locked, camera: g.renderer.camera.position.toArray(), contact: window.__angleContacts.at(-1) ?? null,
    impactsObserved: window.__angleImpacts.length,
    fragments: g.chasing.particles.map(p => ({ actual: p.mesh.userData.actualFractureGeometry, spanCm: Math.max(p.halfWidth, p.halfHeight, p.halfDepth) * 200, volumeCm3: p.mesh.userData.volume * 1e6 })),
    renderError: g.renderer.renderError, overflow: document.documentElement.scrollWidth > innerWidth };
});
async function capture(page, path) {
  await page.evaluate(async () => { const g = window.__wireTheHouse; await g.room.brickWall.waitForGeometry(); await g.renderer.waitForFrame(); window.__angleStep(0); await g.renderer.waitForFrame(); });
  await page.screenshot({ path });
}
async function captureFractureDetail(page, path, point, mobile) {
  const data = await page.evaluate(async ({ point, mobile }) => {
    const g = window.__wireTheHouse, r = g.renderer;
    await g.room.brickWall.waitForGeometry(); await r.waitForFrame();
    const camera = r.camera.clone(false), visible = g.fpsRig.visible;
    camera.fov = 40; camera.near = .008;
    camera.position.set(point.x + .035, point.y + .055, g.room.brickWall.volume.frontZ + (mobile ? .60 : .35));
    camera.lookAt(point.x, point.y, point.z); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    try {
      g.fpsRig.visible = false;
      await r.webgl.renderAsync(r.scene, camera);
      return r.webgl.domElement.toDataURL('image/png');
    } finally { g.fpsRig.visible = visible; }
  }, { point, mobile });
  await writeFile(path, Buffer.from(data.split(',')[1], 'base64'));
}

try {
  for (const mobile of [false, true]) for (const angle of [0, 45, -45]) {
    const platform = mobile ? 'mobile' : 'desktop';
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 768 }, isMobile: mobile, hasTouch: mobile });
    await blockPointerLock(context);
    await context.addInitScript(() => {
      const original = crypto.getRandomValues.bind(crypto);
      crypto.getRandomValues = array => array instanceof Uint32Array && array.length === 1 ? (array[0] = 193187, array) : original(array);
    });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(`${platform}/${angle}: ${error.message}`));
    await page.goto(url);
    await page.waitForFunction(() => window.__wireTheHouse?.renderer.renderCamera, { timeout: 120000 });
    const click = id => page.locator(id)[mobile ? 'tap' : 'click']();
    await click('#start-button');
    assert.equal(await page.evaluate(() => document.pointerLockElement), null, 'Automation must never capture the physical cursor');
    await page.evaluate(() => {
      document.exitPointerLock();
      const g = window.__wireTheHouse, w = g.room.brickWall;
      window.__angleStep = g.step.bind(g); g.step = () => {};
      window.__angleContacts = []; window.__angleImpacts = [];
      const originalContact = w.contactProvider;
      w.contactProvider = camera => {
        const contact = originalContact(camera);
        if (contact) window.__angleContacts.push({ direction: { ...contact.direction }, point: { ...contact.point }, edge: { ...contact.edge } });
        return contact;
      };
      const originalImpact = w.volume.impact.bind(w.volume);
      w.volume.impact = input => {
        const result = originalImpact(input);
        window.__angleImpacts.push({ removedCm3: result.removedVolume * 1e6, cracks: result.cracks.length, trim: Boolean(input.trim), direction: { ...input.direction }, fragments: result.fragments.map(f => ({ volumeCm3: f.volume * 1e6, spanCm: Math.max(f.size.x, f.size.y, f.size.z) * 100, actual: Boolean(f.positions?.length) })) });
        return result;
      };
    });
    if (mobile) { await click('[data-tool="hammer"]'); await click('#settings-toggle'); await click('#aim-control-mode'); await click('#settings-close'); }
    else await page.keyboard.press('Digit4');
    await click('#settings-toggle');
    for (let attempt = 0; attempt < 12 && (await state(page)).tilt !== angle; attempt++) await click('#chisel-tilt');
    assert.equal((await state(page)).tilt, angle, 'Native settings did not select the requested tilt');
    await click('#settings-close');
    await page.evaluate(() => {
      const g = window.__wireTheHouse, c = g.renderer.camera;
      // Waist-height work permits both tilt signs within the existing finite
      // worker reach. High targets intentionally clamp downward hammer pitch.
      g.hammerWorkStance.restore(c); c.position.set(.72, 1.65, -1.4); c.lookAt(.72, 1.02, g.room.brickWall.volume.frontZ);
      g.player.yaw = c.rotation.y; g.player.pitch = c.rotation.x;
    });
    await step(page, 90);
    const cdp = mobile ? await context.newCDPSession(page) : null;
    async function move(on, backwards = false) {
      if (!mobile) return page.keyboard[on ? 'down' : 'up'](backwards ? 'KeyS' : 'KeyW');
      const b = await page.locator('#joystick').boundingBox();
      await cdp.send('Input.dispatchTouchEvent', { type: on ? 'touchStart' : 'touchEnd', touchPoints: on ? [{ x: b.x + b.width * .5, y: b.y + b.height * (backwards ? .85 : .15), id: 2 }] : [] });
    }
    async function hold(on) {
      if (!mobile) return page.keyboard[on ? 'down' : 'up']('KeyE');
      const b = await page.locator('#look-joystick').boundingBox(), touch = { x: b.x + b.width / 2, y: b.y + b.height / 2, id: 3 };
      if (on) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      }
      await cdp.send('Input.dispatchTouchEvent', { type: on ? 'touchStart' : 'touchEnd', touchPoints: on ? [touch] : [] });
    }
    await move(true);
    for (let i = 0; i < 40; i++) { await step(page, 4); if ((await state(page)).locked) break; }
    await move(false); await step(page, 90);
    const before = await state(page);
    assert(before.locked, `${platform}/${angle}: native approach must establish actual tool contact`);
    await capture(page, `${out}/${platform}-${angle}-intact.png`);
    await hold(true);
    for (let frames = 0; frames < 300; frames++) { await step(page, 1); if ((await state(page)).impacts >= before.impacts + 12) break; }
    await hold(false); await step(page, 1);
    const after = await state(page), impacts = await page.evaluate(() => window.__angleImpacts);
    const scenario = { platform, angle, before, after, impacts };
    report.cases.push(scenario);
    assert(after.impacts >= before.impacts + 8, `${platform}/${angle}: held input did not deliver repeated impacts`);
    assert(after.removedCm3 > before.removedCm3, `${platform}/${angle}: no actual solid removed`);
    assert(impacts.some(impact => impact.fragments.some(fragment => fragment.actual)), 'No actual removed geometry reached debris');
    const active = impacts.filter(impact => impact.removedCm3 > 0);
    assert(active.length >= 3, `${platform}/${angle}: multiple impacts must progressively fracture material`);
    assert(impacts.every(impact => Math.abs(impact.direction.y + Math.sin(angle * Math.PI / 180)) < .001), 'Physical attack axis differs from requested hammer tilt');
    await capture(page, `${out}/${platform}-${angle}-demolished.png`);
    if (angle === 45 && after.contact) await captureFractureDetail(page, `${out}/${platform}-${angle}-fracture-detail.png`, after.contact.point, mobile);
    await step(page, 60);
    const released = await state(page);
    assert.equal(released.impacts, after.impacts, 'Released held input continued striking');
    await move(true, true); await step(page, 30); await move(false, true); await step(page, 30);
    await capture(page, `${out}/${platform}-${angle}-inspection.png`);
    assert.equal(after.renderError, ''); assert.equal(after.overflow, false);
    assert.equal(await page.evaluate(() => document.pointerLockElement), null, 'Automation captured Pointer Lock');
    scenario.released = released;
    await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify({ cases: report.cases.map(item => ({ platform: item.platform, angle: item.angle, impacts: item.after.impacts - item.before.impacts, removedCm3: item.after.removedCm3 - item.before.removedCm3, largestFragmentCm: Math.max(...item.impacts.flatMap(impact => impact.fragments.map(fragment => fragment.spanCm))) })), errors: report.errors }, null, 2));
} catch (error) { report.failure = String(error.stack ?? error); throw error; }
finally { await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); await browser.close(); }
