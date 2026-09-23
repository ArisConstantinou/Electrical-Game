import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const variant = process.argv[2] || 'before';
const root = path.resolve('dist');
const output = path.resolve('artifacts/visual-overhaul');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = [];
try {
  for (const [name, viewport, touch] of [['desktop', { width: 1365, height: 768 }, false], ['portrait', { width: 390, height: 844 }, true]]) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://127.0.0.1:5365/Electrical-Game/**', async route => {
      const relative = decodeURIComponent(new URL(route.request().url()).pathname).slice('/Electrical-Game/'.length) || 'index.html';
      const file = path.resolve(root, relative);
      if (!file.startsWith(root + path.sep)) return route.abort();
      try {
        const extension = path.extname(file).toLowerCase();
        await route.fulfill({ status: 200, body: await fs.readFile(file), contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.svg': 'image/svg+xml' })[extension] || 'application/octet-stream' });
      } catch { await route.fulfill({ status: 404, body: `Missing isolated asset: ${relative}` }); }
    });
    await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=basic&renderer=webgl');
    await page.locator('#start-button').click({ timeout: 120000 });
    await page.waitForFunction(() => window.__wireTheHouse?.started, null, { timeout: 120000 });
    await page.waitForTimeout(650);
    await page.evaluate(() => {
      const game = window.__wireTheHouse;
      game.input.locked = false;
      game.player.velocity.set(0, 0, 0);
      const camera = game.player.camera;
      camera.position.set(0, 1.65, 1.35);
      game.player.yaw = 0;
      game.player.pitch = -.04;
      camera.rotation.set(-.04, 0, 0, 'YXZ');
      camera.updateMatrixWorld(true);
      game.step(0);
      game.step = () => {};
    });
    await page.waitForTimeout(900);
    await page.evaluate(async () => { const renderer = window.__wireTheHouse.renderer; renderer.render(); await renderer.waitForFrame(); });
    await page.screenshot({ path: path.join(output, `spray-wrap-${variant}-${name}.png`) });
    const state = await page.evaluate(async () => {
      const game = window.__wireTheHouse;
      const can = game.fpsRig.getObjectByName('FPS spray tool');
      let parts = 0, triangles = 0;
      can.traverse(object => {
        if (!object.isMesh) return;
        parts++;
        triangles += object.geometry.index ? object.geometry.index.count / 3 : object.geometry.getAttribute('position').count / 3;
      });
      const wrap = can.getObjectByName('Printed cylindrical worksite label');
      const band = can.getObjectByName('Spray color band');
      const initialBand = band.material.color.getHex();
      game.fpsRig.setSprayColor(0xec5528);
      const changedBand = band.material.color.getHex();
      game.fpsRig.setSprayColor(initialBand);
      let flatLabels = 0;
      can.traverse(object => { if (object.isMesh && object.geometry.type === 'PlaneGeometry') flatLabels++; });
      const gripErrors = (game.fpsRig.armSets.get('spray') ?? []).filter(arm => arm.hand.userData.gripping !== false)
        .map(arm => arm.hand.getWorldPosition(arm.grip.clone().set(0, 0, 0)).distanceTo(can.localToWorld(arm.grip.clone())));
      const intervals = [];
      await new Promise(resolve => { let last = performance.now(); const tick = now => { intervals.push(now - last); last = now; if (intervals.length < 90) requestAnimationFrame(tick); else resolve(); }; requestAnimationFrame(tick); });
      intervals.sort((a, b) => a - b);
      return { parts, triangles, grip: can.userData.gripPoint, tip: can.userData.tipPoint,
        wrap: Boolean(wrap), wrapPixels: wrap?.material.map?.image ? [wrap.material.map.image.width, wrap.material.map.image.height] : null,
        flatLabels, gripErrors, initialBand, changedBand, band: Boolean(band), actuator: Boolean(can.getObjectByName('spray-actuator')),
        medianMs: intervals[45], p95Ms: intervals[85], renderError: game.renderer.renderError };
    });
    assert.deepEqual(errors, []);
    assert.equal(state.renderError, '');
    assert(state.band && state.actuator);
    assert.equal(state.changedBand, 0xec5528);
    assert(state.gripErrors.every(error => error < .025));
    if (variant === 'after') { assert(state.wrap && state.flatLabels === 0); }
    report.push({ name, viewport, touch, state, errors });
    await context.close();
  }
} finally { await browser.close(); }
await fs.writeFile(path.join(output, `spray-wrap-${variant}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
