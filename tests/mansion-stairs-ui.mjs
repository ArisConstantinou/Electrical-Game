import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const out = 'output/mansion-stairs-ui';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { cases: [], errors: [], note: 'Desktop-host touch emulation; physical iPhone not tested.' };
try {
  for (const device of [
    { name: 'mobile-portrait', viewport: { width: 390, height: 844 }, isMobile: true },
    { name: 'desktop', viewport: { width: 1366, height: 768 }, isMobile: false },
  ]) {
    const context = await browser.newContext({ viewport: device.viewport, deviceScaleFactor: 1, isMobile: device.isMobile, hasTouch: device.isMobile });
    await blockPointerLock(context);
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(`${device.name}: ${error.message}`));
    await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&renderer=webgl');
    await page.locator('#start-button').waitFor({ state: 'visible', timeout: 120000 });
    await page.locator('#apprentice-count').selectOption('0');
    await page.locator('#start-button').click();
    await page.waitForFunction(() => window.__wireTheHouse?.started, null, { timeout: 120000 });
    const pose = await page.evaluate(() => {
      const game = window.__wireTheHouse;
      game.player.camera.position.set(5.5, game.player.eyeHeight, 8.05);
      game.player.yaw = Math.PI;
      game.player.pitch = -.22;
      game.player.camera.rotation.set(-.22, Math.PI, 0, 'YXZ');
      return game.player.camera.position.toArray();
    });
    const walk = async (yaw, axis, direction, target) => {
      await page.evaluate(value => {
        const game = window.__wireTheHouse;
        game.player.yaw = value;
        game.input.keys.add('KeyW');
      }, yaw);
      try {
        await page.waitForFunction(({ axis, direction, target }) => {
          const position = window.__wireTheHouse.player.camera.position;
          const value = axis === 'x' ? position.x : position.z;
          return direction === 'gt' ? value > target : value < target;
        }, { axis, direction, target }, { timeout: 6000, polling: 50 });
      } finally {
        await page.evaluate(() => window.__wireTheHouse.input.keys.delete('KeyW'));
      }
      await page.waitForTimeout(170);
      return page.evaluate(() => window.__wireTheHouse.player.camera.position.toArray());
    };
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${out}/${device.name}-stair-base.png` });
    const halfway = await walk(Math.PI, 'z', 'gt', 11.5);
    assert(halfway[1] > 3.1 && halfway[1] < 3.55, `${device.name}: first flight did not reach the 1.65 m landing: ${halfway}`);
    const across = await walk(-Math.PI / 2, 'x', 'gt', 7.4);
    assert(across[0] > 7.1 && across[0] < 7.9 && across[1] > 3.1, `${device.name}: midlanding cannot be crossed: ${across}`);
    const upper = await walk(0, 'z', 'lt', 7.95);
    assert(upper[1] > 4.7 && upper[2] < 8.5, `${device.name}: second flight did not reach L1: ${upper}`);
    await page.screenshot({ path: `${out}/${device.name}-first-floor-landing.png` });
    const firstRoom = await walk(0, 'z', 'lt', 3.8);
    assert(firstRoom[1] > 4.8 && firstRoom[2] < 4.5, `${device.name}: cannot pass through the unfinished door opening: ${firstRoom}`);
    await page.screenshot({ path: `${out}/${device.name}-first-floor-room.png` });
    const returnToLanding = await walk(Math.PI, 'z', 'gt', 7.9);
    assert(returnToLanding[1] > 4.8, `${device.name}: cannot leave L1 room by the same open passage: ${returnToLanding}`);
    const downSecond = await walk(Math.PI, 'z', 'gt', 11.5);
    assert(downSecond[1] < 3.6 && downSecond[1] > 3.0, `${device.name}: return flight B did not reach midlanding: ${downSecond}`);
    const acrossBack = await walk(Math.PI / 2, 'x', 'lt', 5.6);
    assert(acrossBack[0] < 5.9, `${device.name}: cannot cross landing back to flight A: ${acrossBack}`);
    const ground = await walk(0, 'z', 'lt', 8.3);
    assert(ground[1] < 2.1 && ground[2] < 8.6, `${device.name}: cannot descend to ground floor: ${ground}`);
    report.cases.push({ device: device.name, pose, halfway, across, upper, firstRoom, returnToLanding, downSecond, acrossBack, ground });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
} finally {
  await browser.close();
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
