import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const out = 'output/mansion-ground-garage-review';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { views: [], errors: [], note: 'Same camera and viewport in Chrome mobile emulation; not a physical iPhone.' };
try {
  for (const mode of ['before', 'after']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await blockPointerLock(context);
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(`${mode}: ${error.message}`));
    const suffix = mode === 'before' ? '&garage=off' : '';
    await page.goto(`http://127.0.0.1:5365/Electrical-Game/?mansion=preview&renderer=webgl${suffix}`);
    await page.locator('#start-button').waitFor({ state: 'visible', timeout: 120000 });
    await page.locator('#apprentice-count').selectOption('0');
    await page.locator('#start-button').click();
    await page.waitForFunction(() => window.__wireTheHouse?.started, null, { timeout: 120000 });
    const state = await page.evaluate(() => {
      const g = window.__wireTheHouse;
      g.player.camera.position.set(7.5, g.player.eyeHeight, 7.85);
      g.player.yaw = 0; g.player.pitch = -.06;
      return { garage: Boolean(g.room.mansionWing.getObjectByName('Ground private garage and client workshop concrete slab')),
        camera: g.player.camera.position.toArray(), yaw: g.player.yaw, pitch: g.player.pitch };
    });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${out}/mobile-portrait-${mode}.png` });
    assert.equal(state.garage, mode === 'after');
    report.views.push({ mode, ...state });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.views[0].camera, report.views[1].camera);
} finally {
  await browser.close();
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
