import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const out = 'artifacts/site-pro-04/review/mansion-ground-preview';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { pose: { x: 1.8, y: 1.65, z: .4, yaw: 2.65, pitch: -.08 }, cases: [], errors: [] };
try {
  for (const mode of ['default', 'mansion-preview']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await blockPointerLock(context);
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(`${mode}: ${error.message}`));
    await page.goto(`http://127.0.0.1:5365/Electrical-Game/?renderer=webgl${mode === 'mansion-preview' ? '&mansion=preview' : ''}`);
    await page.locator('#start-button').waitFor({ state: 'visible', timeout: 120000 });
    await page.locator('#apprentice-count').selectOption('0');
    await page.locator('#start-button').tap();
    await page.waitForFunction(() => window.__wireTheHouse?.started, null, { timeout: 120000 });
    const state = await page.evaluate(pose => {
      const game = window.__wireTheHouse;
      game.player.camera.position.set(pose.x, pose.y, pose.z);
      game.player.yaw = pose.yaw; game.player.pitch = pose.pitch;
      game.player.camera.rotation.set(pose.pitch, pose.yaw, 0, 'YXZ');
      return { wing: Boolean(game.room.mansionWing), position: game.player.camera.position.toArray() };
    }, report.pose);
    await page.waitForTimeout(650);
    assert.equal(state.wing, mode === 'mansion-preview');
    await page.screenshot({ path: `${out}/mobile-portrait-rear-${mode}.png` });
    report.cases.push({ mode, ...state });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
} finally {
  await browser.close();
  await writeFile(`${out}/opening-review.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
