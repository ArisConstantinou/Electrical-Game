import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { blockPointerLock } from './browser-safety.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5365/Electrical-Game/';
const out = process.argv[3] ?? 'output/mortar-deep-native';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { url, fixture: 'Actual rounded-five masonry excavation. Fixed camera and four repeated aim targets; real keyboard/touch scoop hold-release, finite .65 kg loads, no adaptive deepest-cell targeting or authored mortar. Browser mobile emulation; Pointer Lock blocked before navigation.', cases: [] };
try {
  for (const mobile of [false, true]) {
    const platform = mobile ? 'mobile' : 'desktop';
    if (process.env.QA_PLATFORM && process.env.QA_PLATFORM !== platform) continue;
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 768 }, isMobile: mobile, hasTouch: mobile });
    await blockPointerLock(context);
    await context.addInitScript(() => { const random = crypto.getRandomValues.bind(crypto); crypto.getRandomValues = a => a instanceof Uint32Array && a.length === 1 ? (a[0] = 260913, a) : random(a); });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url); await page.waitForFunction(() => window.__wireTheHouse?.roomWater.waterProActive);
    await page.locator('#start-button')[mobile ? 'tap' : 'click']();
    await page.evaluate(async () => {
      const g = window.__wireTheHouse, v = g.room.brickWall.volume, front = v.frontZ;
      window.__fillStep = g.step.bind(g); g.step = () => {};
      for (let pass = 0; pass < 4; pass++) for (let x = -.105; x <= .10501; x += .035) for (let y = 1.33; y <= 1.47001; y += .035) {
        const hit = v.raycast({ x, y, z: front + .08 }, { x: 0, y: 0, z: -1 }, .24);
        if (hit && front - hit.point.z < .07) v.impact({ point: hit.point, direction: { x: 0, y: 0, z: -1 }, chisel: 'flat', widthM: .05, energyJ: 8 });
      }
      g.room.brickWall.flushGeometry(); await g.room.brickWall.waitForGeometry();
      window.__fillColumns = [];
      for (let x = -.096; x <= .09601; x += .016) for (let y = 1.336; y <= 1.46401; y += .016) {
        const hit = v.raycast({ x, y, z: front + .02 }, { x: 0, y: 0, z: -1 }, .24);
        if (hit && front - hit.point.z > .016) window.__fillColumns.push({ x, y, back: hit.point.z });
      }
      window.__fillContacts = [];
      const deposit = g.mortar.deposit.bind(g.mortar);
      g.mortar.deposit = (point, mass, normal, ...rest) => { const start = performance.now(), held = deposit(point, mass, normal, ...rest); if (mass > 0) window.__fillContacts.push({ requested: mass, held, point: point.toArray(), normal: normal.toArray(), ms: performance.now() - start }); return held; };
    });
    if (mobile) await page.locator('[data-tool="trowel"]').tap(); else await page.keyboard.press('Digit7');
    await page.evaluate(() => { const g = window.__wireTheHouse, c = g.renderer.camera; g.hammerWorkStance.restore(c); c.position.set(0, g.player.eyeHeight, g.room.brickWall.volume.frontZ + .46); c.lookAt(0, 1.4, g.room.brickWall.volume.frontZ - .05); g.player.yaw = c.rotation.y; g.player.pitch = c.rotation.x; });
    const steps = count => page.evaluate(n => { for (let i = 0; i < n; i++) window.__fillStep(1 / 60); }, count);
    const capture = async name => { await page.evaluate(async () => { const r = window.__wireTheHouse.renderer; await r.waitForFrame(); r.render(); await r.waitForFrame(); }); await page.screenshot({ path: `${out}/${platform}-${name}.png` }); };
    await steps(60); await capture('before');
    const cdp = mobile ? await context.newCDPSession(page) : null;
    const loads = [], targets = [[-.05, 1.36], [.05, 1.36], [-.05, 1.44], [.05, 1.44]];
    // Finish the whole visible perimeter. The old finishing path repeatedly
    // aimed below the cavity and never returned to its upper corners. These
    // fixed targets remain independent of measured fill and material queries.
    const finishingTargets = [[-.08,1.34],[.08,1.34],[-.08,1.46],[.08,1.46],[-.10,1.40],[.10,1.40],[0,1.33],[0,1.47]];
    for (let i = 0; i < 28; i++) {
      await page.evaluate(([x, y]) => { const g = window.__wireTheHouse, c = g.renderer.camera; c.lookAt(x, y, g.room.brickWall.volume.frontZ - .05); g.player.yaw = c.rotation.y; g.player.pitch = c.rotation.x; }, i < 16 ? targets[i % 4] : finishingTargets[(i-16) % finishingTargets.length]);
      await steps(12);
      if (cdp) { const b = await page.locator('#look-joystick').boundingBox(); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: 17 }] }); } else await page.keyboard.down('KeyE');
      await steps(28);
      if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); else await page.keyboard.up('KeyE');
      await steps(100);
      const state = await page.evaluate(() => {
        const g = window.__wireTheHouse, m = g.mortar, front = g.room.brickWall.volume.frontZ, V = g.renderer.camera.position.constructor;
        let flush = 0, filled = 0, count = 0; const remaining = [];
        for (const c of window.__fillColumns) {
          const h = m.field.raycast(new V(c.x, c.y, front + .02), new V(0, 0, -1), .24); if (h && front - h.point.z < .012) flush++; else remaining.push({ x: c.x, y: c.y, depth: h ? front - h.point.z : null });
          for (let z = c.back + .004; z < front; z += .008) { count++; filled += Math.min(1, m.field.sample(new V(c.x, c.y, z))); }
        }
        const t = m.telemetry;
        return { launched: t.launchedKg, stuck: t.stuckKg, flush: flush / window.__fillColumns.length, fill: filled / count, remaining, error: t.launchedKg - t.stuckKg - t.floorKg - t.restingKg - t.movingKg, contacts: window.__fillContacts.slice(), renderError: g.renderer.renderError, pointerLocked: Boolean(document.pointerLockElement) };
      });
      assert(Math.abs(state.launched - (i + 1) * .65) < 1e-7); assert(Math.abs(state.error) < 1e-6);
      loads.push(state); if ([3, 7, 11, 15].includes(i)) await capture(`load-${i + 1}`);
      if (i >= 16 && state.flush === 1) break;
    }
    report.cases.push({ platform, loads, errors });
    await page.evaluate(() => window.__wireTheHouse.mortar.waitForGeometry()); await capture('finished');
    assert.equal(loads.at(-1).flush, 1, 'Fixed finishing targets left an inaccessible recess');
    assert(loads[7].fill > .6, 'Eight normal scoops failed to fill most of the deep recess');
    assert.equal(loads.at(-1).renderError, ''); assert.equal(loads.at(-1).pointerLocked, false); assert.deepEqual(errors, []);
    console.log(JSON.stringify({ platform, loads: loads.map((l, i) => ({ load: i + 1, stuck: l.stuck, flush: l.flush, fill: l.fill })) }));
    await context.close();
  }
} finally { await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); await browser.close(); }
