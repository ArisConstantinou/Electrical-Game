import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const out = 'output/mansion-second-floor-route';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { cases: [], errors: [], note: 'Chrome touch viewport emulation on Windows; physical phone not tested.' };
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
    await page.evaluate(() => {
      const g = window.__wireTheHouse;
      g.player.camera.position.set(7.5, g.player.eyeHeight + 3.3, 6.5);
      g.player.yaw = Math.PI;
      g.player.pitch = -.08;
    });
    const walk = async (yaw, axis, target, greater) => {
      await page.evaluate(value => { const g = window.__wireTheHouse; g.player.yaw = value; g.input.keys.add('KeyW'); }, yaw);
      try {
        await page.waitForFunction(({ axis, target, greater }) => {
          const position = window.__wireTheHouse.player.camera.position;
          const value = axis === 'x' ? position.x : position.z;
          return greater ? value > target : value < target;
        }, { axis, target, greater }, { timeout: 6500, polling: 50 });
      } finally {
        await page.evaluate(() => window.__wireTheHouse.input.keys.delete('KeyW'));
      }
      await page.waitForTimeout(200);
      return page.evaluate(() => window.__wireTheHouse.player.camera.position.toArray());
    };
    await walk(Math.PI, 'z', 7.34, true);
    const cross = await walk(Math.PI / 2, 'x', 5.55, false);
    assert(cross[1] > 4.7 && cross[1] < 5.2, `${device.name}: L1 side passage to upper stair is not level: ${cross}`);
    await page.evaluate(() => { const g = window.__wireTheHouse; g.player.yaw = Math.PI / 2; g.input.keys.add('KeyW'); });
    await page.waitForTimeout(700);
    const deckGuard = await page.evaluate(() => ({ position: window.__wireTheHouse.player.camera.position.toArray(),
      contacts: window.__wireTheHouse.player.collisionContacts,
      groundClear: !window.__wireTheHouse.room.mansionWing.obstaclesAt(0).some(item => item.id === 'L1 side-deck edge guard') }));
    await page.evaluate(() => window.__wireTheHouse.input.keys.delete('KeyW'));
    assert(deckGuard.position[0] >= 4.79 && deckGuard.groundClear,
      `${device.name}: side-deck guard has an incorrect floor or permits a fall: ${JSON.stringify(deckGuard)}`);
    await walk(-Math.PI / 2, 'x', 5.45, true);
    await page.screenshot({ path: `${out}/${device.name}-upper-stair-entry.png` });
    const halfway = await walk(Math.PI, 'z', 11.5, true);
    assert(halfway[1] > 6.35 && halfway[1] < 6.8, `${device.name}: L1-L2 first flight did not reach midlanding: ${halfway}`);
    const across = await walk(-Math.PI / 2, 'x', 7.4, true);
    assert(across[1] > 6.35, `${device.name}: upper midlanding cannot be crossed: ${across}`);
    const second = await walk(0, 'z', 7.9, false);
    assert(second[1] > 8.0 && second[1] < 8.5, `${device.name}: second flight did not reach L2: ${second}`);
    await page.screenshot({ path: `${out}/${device.name}-L2-landing.png` });
    const room = await walk(0, 'z', 3.8, false);
    assert(room[1] > 8.0 && room[2] < 4.5, `${device.name}: L2 room rough opening is not traversable: ${room}`);
    await page.screenshot({ path: `${out}/${device.name}-L2-room.png` });
    await walk(Math.PI, 'z', 11.5, true);
    await walk(Math.PI / 2, 'x', 5.6, false);
    const returnL1 = await walk(0, 'z', 7.5, false);
    assert(returnL1[1] > 4.7 && returnL1[1] < 5.2, `${device.name}: cannot descend back to L1: ${returnL1}`);
    report.cases.push({ device: device.name, cross, deckGuard, halfway, across, second, room, returnL1 });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
} finally {
  await browser.close();
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
