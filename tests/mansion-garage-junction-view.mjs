import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const label = process.argv.find(arg => arg.startsWith('--label='))?.slice(8);
assert(label === 'before' || label === 'after', 'Use --label=before or --label=after');
const out = 'output/mansion-garage-junction-view';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { label, cases: [], errors: [], note: 'Windows Chrome viewport screenshots, not physical devices.' };
try {
  for (const device of [
    { name: 'mobile-portrait', width: 390, height: 844, touch: true },
    { name: 'desktop', width: 1366, height: 768, touch: false },
  ]) {
    const context = await browser.newContext({ viewport: { width: device.width, height: device.height },
      deviceScaleFactor: 1, isMobile: device.touch, hasTouch: device.touch });
    await blockPointerLock(context);
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(`${device.name}: ${error.message}`));
    await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&renderer=webgl');
    await page.locator('#start-button').waitFor({ state: 'visible', timeout: 120000 });
    await page.locator('#apprentice-count').selectOption('0');
    await page.locator('#start-button').click();
    await page.waitForFunction(() => window.__wireTheHouse?.started, null, { timeout: 120000 });
    const pose = await page.evaluate(() => {
      const g = window.__wireTheHouse;
      g.player.camera.position.set(12, g.player.eyeHeight, 1.6);
      g.player.yaw = .82; g.player.pitch = -.03;
      return { camera: g.player.camera.position.toArray(), yaw: g.player.yaw, pitch: g.player.pitch };
    });
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${out}/${device.name}-${label}.png` });
    report.cases.push({ device: device.name, ...pose });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
} finally {
  await browser.close();
  await writeFile(`${out}/${label}-report.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
