import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&renderer=webgl');
  await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 120000 });
  await page.locator('#start-button').click();
  await page.locator('#start-screen').waitFor({ state: 'hidden' });
  const state = () => page.evaluate(() => ({
    mode: window.__wireTheHouse.apprentice.mode,
    locked: document.pointerLockElement?.id ?? null,
    yaw: window.__wireTheHouse.player.yaw,
  }));
  const started = await state();
  assert.equal(started.locked, 'game-canvas', 'Starting the game must capture PC aim');
  const canvas = await page.locator('#game-canvas').boundingBox();
  assert(canvas, 'Game canvas is absent');
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await page.mouse.move(canvas.x + canvas.width / 2 + 80, canvas.y + canvas.height / 2);
  await page.mouse.move(canvas.x + canvas.width / 2 + 140, canvas.y + canvas.height / 2);
  const moved = await state();
  assert(Math.abs(moved.yaw - started.yaw) > .02, `Locked pointer did not turn the camera: ${JSON.stringify({ started, moved })}`);
  assert.equal(moved.locked, 'game-canvas', 'Mouse look must retain pointer capture');
  await page.evaluate(() => document.exitPointerLock());
  await page.locator('#settings-toggle').click();
  assert.equal(await page.locator('#settings-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal((await state()).locked, null, 'Settings must remain reachable after unlock');
  await page.locator('#settings-close').click();
  await page.locator('#game-canvas').click({ position: { x: 400, y: 450 } });
  assert.equal((await state()).locked, 'game-canvas', 'Clicking the playfield must restore pointer capture');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, started, moved, final: await state() }));
} finally {
  await browser.close();
}
