import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const out = 'output/mansion-basement-route';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { environment: 'Windows Chrome; touch cases emulate viewports, not physical devices', cases: [], errors: [] };
try {
  for (const device of [
    { name: 'desktop', viewport: { width: 1366, height: 768 }, mobile: false },
    { name: 'mobile-portrait', viewport: { width: 390, height: 844 }, mobile: true },
  ]) {
    const context = await browser.newContext({ viewport: device.viewport, deviceScaleFactor: 1,
      isMobile: device.mobile, hasTouch: device.mobile });
    await blockPointerLock(context);
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(`${device.name}: ${error.message}`));
    await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&renderer=webgl');
    await page.locator('#start-button').waitFor({ state: 'visible', timeout: 120000 });
    await page.locator('#apprentice-count').selectOption('0');
    await page.locator('#start-button').click();
    await page.waitForFunction(() => window.__wireTheHouse?.started, null, { timeout: 120000 });
    const walk = async (yaw, axis, target, greater) => {
      await page.evaluate(value => { const game = window.__wireTheHouse; game.player.yaw = value; game.input.keys.add('KeyW'); }, yaw);
      try {
        await page.waitForFunction(({ axis, target, greater }) => {
          const value = window.__wireTheHouse.player.camera.position[axis];
          return greater ? value > target : value < target;
        }, { axis, target, greater }, { timeout: 9000, polling: 50 });
      } finally {
        await page.evaluate(() => window.__wireTheHouse.input.keys.delete('KeyW'));
      }
      await page.waitForTimeout(180);
      return page.evaluate(() => window.__wireTheHouse.player.camera.position.toArray());
    };
    const setStart = async feet => page.evaluate(feetY => {
      const game = window.__wireTheHouse;
      game.player.camera.position.set(7.5, feetY + game.player.eyeHeight, 7.75);
      game.player.yaw = Math.PI;
    }, feet);
    await setStart(0);
    const gToMid = await walk(Math.PI, 'z', 11.5, true);
    assert(gToMid[1] < .45 && gToMid[1] > -.35, `${device.name}: ground to B1 half-flight blocked ${gToMid}`);
    await walk(Math.PI / 2, 'x', 5.55, false);
    const b1 = await walk(0, 'z', 7.5, false);
    assert(b1[1] < -1.65 && b1[1] > -2.0, `${device.name}: B1 stair foot failed ${b1}`);
    await walk(-Math.PI / 2, 'x', 7.5, true);
    const b1Corridor = await walk(0, 'z', 2.1, false);
    assert(b1Corridor[1] < -1.65 && b1Corridor[1] > -2.0,
      `${device.name}: B1 corridor unreachable ${b1Corridor}`);
    const b1Garage = await walk(-Math.PI / 2, 'x', 10.2, true);
    assert(b1Garage[1] < -1.65 && b1Garage[1] > -2.0,
      `${device.name}: B1 garage opening blocked ${b1Garage}`);
    await page.screenshot({ path: `${out}/${device.name}-B1-garage.png` });
    await setStart(-3.4);
    await walk(Math.PI, 'z', 11.5, true);
    await walk(Math.PI / 2, 'x', 5.55, false);
    const b2 = await walk(0, 'z', 7.5, false);
    assert(b2[1] < -5.0 && b2[1] > -5.4, `${device.name}: B2 stair foot failed ${b2}`);
    await walk(-Math.PI / 2, 'x', 7.5, true);
    const b2Corridor = await walk(0, 'z', 2.1, false);
    assert(b2Corridor[1] < -5.0 && b2Corridor[1] > -5.4,
      `${device.name}: B2 corridor unreachable ${b2Corridor}`);
    await page.screenshot({ path: `${out}/${device.name}-B2-services.png` });
    report.cases.push({ device: device.name, gToMid, b1, b1Corridor, b1Garage, b2, b2Corridor });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
} finally {
  await browser.close();
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
