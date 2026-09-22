import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const out = 'output/mansion-stairs-touch';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { cases: [], errors: [], note: 'Real touch events in Chrome emulation on desktop hardware; no physical phone claim.' };
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await blockPointerLock(context);
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&renderer=webgl');
    await page.locator('#start-button').waitFor({ state: 'visible', timeout: 120000 });
    await page.locator('#apprentice-count').selectOption('0');
    await page.locator('#start-button').tap();
    await page.waitForFunction(() => window.__wireTheHouse?.started, null, { timeout: 120000 });
    await page.evaluate(() => {
      const g = window.__wireTheHouse;
      g.player.camera.position.set(5.5, g.player.eyeHeight, 8.05);
      g.player.yaw = Math.PI;
      g.player.pitch = -.28;
      g.player.camera.rotation.set(-.28, Math.PI, 0, 'YXZ');
    });
    const box = async selector => {
      const bounds = await page.locator(selector).boundingBox();
      assert(bounds, `${selector} missing`);
      return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, radius: bounds.width / 2 };
    };
    const move = await box('#joystick');
    const look = await box('#look-joystick');
    const use = await box('#site-pro-use');
    const cdp = await context.newCDPSession(page), points = new Map();
    const touch = async (type, id, x, y) => {
      if (type === 'touchEnd') points.delete(id);
      else points.set(id, { id, x, y });
      await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...points.values()] });
    };
    await touch('touchStart', 1, move.x, move.y);
    await touch('touchMove', 1, move.x, move.y - move.radius * .72);
    await touch('touchStart', 2, look.x, look.y);
    await touch('touchMove', 2, look.x + look.radius * .12, look.y);
    await touch('touchStart', 3, use.x, use.y);
    const before = await page.evaluate(() => {
      const g = window.__wireTheHouse;
      return { position: g.player.camera.position.toArray(), yaw: g.player.yaw, held: g.input.actionHeld,
        move: { ...g.input.mobileMove }, look: { ...g.input.mobileLook } };
    });
    assert(before.held && before.move.y < 0 && before.look.x > 0, `three touch channels are not independent: ${JSON.stringify(before)}`);
    await page.waitForTimeout(900);
    const during = await page.evaluate(() => {
      const g = window.__wireTheHouse;
      return { position: g.player.camera.position.toArray(), yaw: g.player.yaw, held: g.input.actionHeld };
    });
    assert(during.held && during.position[2] > before.position[2] + .35 && during.position[1] > before.position[1] + .16 &&
      Math.abs(during.yaw - before.yaw) > .001, `MOVE+AIM+USE did not climb together: ${JSON.stringify({ before, during })}`);
    await page.screenshot({ path: `${out}/${viewport.width}x${viewport.height}-three-touch-climb.png` });
    points.clear();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await page.waitForFunction(() => {
      const input = window.__wireTheHouse.input;
      return !input.actionHeld && input.mobileMove.x === 0 && input.mobileMove.y === 0 && input.mobileLook.x === 0;
    });
    report.cases.push({ viewport, before, during });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
} finally {
  await browser.close();
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
