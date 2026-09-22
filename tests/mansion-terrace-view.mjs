import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const out = 'output/mansion-terrace-view';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { cases: [], errors: [], note: 'Viewport screenshots on Windows, not a physical phone.' };
try {
  for (const device of [
    { name: 'mobile-portrait', viewport: { width: 390, height: 844 }, mobile: true },
    { name: 'mobile-landscape', viewport: { width: 844, height: 390 }, mobile: true },
    { name: 'tablet-portrait', viewport: { width: 820, height: 1180 }, mobile: true },
    { name: 'desktop', viewport: { width: 1366, height: 768 }, mobile: false },
  ]) {
    const context = await browser.newContext({ viewport: device.viewport, deviceScaleFactor: 1, isMobile: device.mobile, hasTouch: device.mobile });
    await blockPointerLock(context);
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(`${device.name}: ${error.message}`));
    await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&renderer=webgl');
    await page.locator('#start-button').waitFor({ state: 'visible', timeout: 120000 });
    await page.locator('#apprentice-count').selectOption('0');
    await page.locator('#start-button').click();
    await page.waitForFunction(() => window.__wireTheHouse?.started, null, { timeout: 120000 });
    const before = await page.evaluate(() => {
      const g = window.__wireTheHouse;
      g.player.camera.position.set(11.423, g.player.eyeHeight + 9.9, 2.687);
      g.player.yaw = -Math.PI / 2;
      g.player.pitch = -.07;
      const outer = g.room.mansionWing.surroundings;
      const tree = outer.getObjectByName('Modeled wind-responsive olive in outer grove 1');
      const high = tree.getObjectByName('Grove high-detail olive 1');
      return { terrain: Boolean(outer.getObjectByName('Rising subdivided ground and distant ridge beyond the construction site')),
        neighbour: Boolean(outer.getObjectByName('Distant Cypriot unfinished residential block with open bays')),
        trees: outer.children.filter(child => child.name.startsWith('Modeled wind-responsive olive')).length,
        lodLevels: tree.levels.length,
        canopyAngle: high.children.find(child => child.type === 'Group').rotation.z };
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${device.name}-L3-exterior.png` });
    const after = await page.evaluate(() => {
      const outer = window.__wireTheHouse.room.mansionWing.surroundings;
      const tree = outer.getObjectByName('Modeled wind-responsive olive in outer grove 1');
      const high = tree.getObjectByName('Grove high-detail olive 1');
      return { canopyAngle: high.children.find(child => child.type === 'Group').rotation.z,
        renderError: window.__wireTheHouse.renderer.renderError };
    });
    assert(before.terrain && before.neighbour && before.trees === 9 && before.lodLevels === 2 && !after.renderError &&
      Math.abs(after.canopyAngle - before.canopyAngle) > .0002,
    `${device.name}: modeled exterior depth or wind is missing: ${JSON.stringify({ before, after })}`);
    report.cases.push({ device: device.name, before, after });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
} finally {
  await browser.close();
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
