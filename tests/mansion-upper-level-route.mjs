import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const out = 'output/mansion-upper-level-route';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { cases: [], errors: [], note: 'Chrome viewport emulation on Windows; no physical phone proof.' };
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
      g.player.camera.position.set(7.5, g.player.eyeHeight + 6.6, 6.5);
      g.player.yaw = Math.PI;
      g.player.pitch = -.07;
    });
    const walk = async (yaw, axis, target, greater) => {
      await page.evaluate(value => { const g = window.__wireTheHouse; g.player.yaw = value; g.input.keys.add('KeyW'); }, yaw);
      try {
        await page.waitForFunction(({ axis, target, greater }) => {
          const p = window.__wireTheHouse.player.camera.position, value = axis === 'x' ? p.x : p.z;
          return greater ? value > target : value < target;
        }, { axis, target, greater }, { timeout: 6500, polling: 50 });
      } finally {
        await page.evaluate(() => window.__wireTheHouse.input.keys.delete('KeyW'));
      }
      await page.waitForTimeout(180);
      return page.evaluate(() => window.__wireTheHouse.player.camera.position.toArray());
    };
    const climb = async (name, expectedFloor) => {
      await walk(Math.PI, 'z', 7.38, true);
      const side = await walk(Math.PI / 2, 'x', 5.55, false);
      const mid = await walk(Math.PI, 'z', 11.5, true);
      await walk(-Math.PI / 2, 'x', 7.4, true);
      const floor = await walk(0, 'z', 7.9, false);
      const room = await walk(0, 'z', 3.8, false);
      assert(Math.abs(side[1] - (expectedFloor - 3.3 + 1.65)) < .17, `${device.name} ${name}: side access wrong height: ${side}`);
      assert(Math.abs(mid[1] - (expectedFloor - 1.65 + 1.65)) < .17, `${device.name} ${name}: midlanding wrong height: ${mid}`);
      assert(Math.abs(floor[1] - (expectedFloor + 1.65)) < .17, `${device.name} ${name}: wrong upper landing: ${floor}`);
      assert(room[2] < 4.5 && Math.abs(room[1] - (expectedFloor + 1.65)) < .17,
        `${device.name} ${name}: rough room entry is blocked: ${room}`);
      await page.screenshot({ path: `${out}/${device.name}-${name}-room.png` });
      await walk(0, 'z', 2.75, false);
      const east = name === 'L3' ? 11 : 10;
      const terrace = await walk(-Math.PI / 2, 'x', east + .35, true);
      assert(terrace[0] > east + .25 && Math.abs(terrace[1] - (expectedFloor + 1.65)) < .17,
        `${device.name} ${name}: unfinished terrace opening is blocked: ${terrace}`);
      await page.screenshot({ path: `${out}/${device.name}-${name}-terrace.png` });
      await page.evaluate(() => window.__wireTheHouse.input.keys.add('KeyW'));
      await page.waitForTimeout(700);
      await page.evaluate(() => window.__wireTheHouse.input.keys.delete('KeyW'));
      const edge = await page.evaluate(() => ({ x: window.__wireTheHouse.player.camera.position.x,
        contacts: window.__wireTheHouse.player.collisionContacts }));
      assert(edge.contacts.includes(`${name} terrace east-edge guard`) && edge.x < (name === 'L3' ? 12.1 : 10.61),
        `${device.name} ${name}: exposed terrace edge has no physical guard: ${JSON.stringify(edge)}`);
      await walk(Math.PI / 2, 'x', 7.45, false);
      await walk(Math.PI, 'z', 6.5, true);
      return { side, mid, floor, room, terrace, edge };
    };
    const L3 = await climb('L3', 9.9);
    const L4 = await climb('L4', 13.2);
    const descend = async expectedFloor => {
      await walk(Math.PI, 'z', 11.5, true);
      await walk(Math.PI / 2, 'x', 5.6, false);
      const lower = await walk(0, 'z', 7.5, false);
      assert(Math.abs(lower[1] - (expectedFloor + 1.65)) < .17,
        `${device.name}: return stair ended on wrong floor: ${lower}`);
      await walk(-Math.PI / 2, 'x', 7.4, true);
      await walk(0, 'z', 6.5, false);
      return lower;
    };
    const backL3 = await descend(9.9);
    const backL2 = await descend(6.6);
    report.cases.push({ device: device.name, L3, L4, backL3, backL2 });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
} finally {
  await browser.close();
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
