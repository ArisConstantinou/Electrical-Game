import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { blockPointerLock } from './browser-safety.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5365/Electrical-Game/?renderer=webgl';
const out = 'output/mixer-work-profile';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { url, device: '390x844 DPR3 Chromium mobile emulation', samples: 0, mixingFrames: 0, p95Ms: null, drawCalls: null, renderError: '', errors: [] };
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  await blockPointerLock(context);
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__wireTheHouse?.mixing, undefined, { timeout: 120000 });
  await page.selectOption('#apprentice-count', '0');
  await page.locator('#start-button').tap();
  await page.evaluate(() => {
    const g = window.__wireTheHouse, m = g.mixing, c = g.renderer.camera;
    const b = m.models.bucket.getWorldPosition(c.position.clone());
    c.position.set(b.x, g.player.eyeHeight, b.z - .92);
    c.lookAt(b.x, .3, b.z);
    g.player.yaw = c.rotation.y; g.player.pitch = c.rotation.x;
    m.setActive(true); m.chooseTool('mixer');
  });
  await page.evaluate(() => window.__wireTheHouse.mixing.action('insert'));
  await page.waitForFunction(() => window.__wireTheHouse.mixing.inserted, undefined, { timeout: 10000 });
  const interact = await page.locator('#mobile-interact').boundingBox();
  assert(interact, 'Visible mobile INTERACT control is required for held mixing');
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: interact.x + interact.width / 2, y: interact.y + interact.height / 2, id: 77 }] });
  await page.evaluate(() => {
    const g = window.__wireTheHouse, times = [], draws = [];
    const original = g.renderer.gpu.render.bind(g.renderer.gpu);
    window.__mixerProfile = { times, draws, active: false, mixingFrames: 0 };
    g.renderer.gpu.render = (scene, camera) => {
      const result = original(scene, camera);
      if (window.__mixerProfile.active && scene === g.renderer.scene && !g.renderer.gpu.getRenderTarget()) {
        times.push(performance.now()); draws.push(g.renderer.webgl.info.render.calls);
        if (g.mixing.mixingNow) window.__mixerProfile.mixingFrames++;
      }
      return result;
    };
    window.__mixerProfile.active = true;
  });
  await page.waitForTimeout(3200);
  Object.assign(report, await page.evaluate(() => {
    const p = window.__mixerProfile, g = window.__wireTheHouse;
    p.active = false;
    const intervals = p.times.slice(1).map((time, index) => time - p.times[index]).sort((a, b) => a - b);
    return { samples: p.times.length, mixingFrames: p.mixingFrames, p95Ms: intervals[Math.floor(intervals.length * .95)], drawCalls: p.draws.reduce((sum, value) => sum + value, 0) / p.draws.length, renderError: g.renderer.renderError, inserted: g.mixing.inserted };
  }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.screenshot({ path: `${out}/mobile-portrait-mixer-work.png` });
  assert(report.inserted && report.samples > 30 && report.mixingFrames > 30 && report.p95Ms < 40 && report.drawCalls < 600 && report.renderError === '');
  assert.deepEqual(report.errors, []);
  await context.close();
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report));
