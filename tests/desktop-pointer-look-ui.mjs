import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const native = process.argv.includes('--native');
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (!native) await context.addInitScript(() => {
    let locked = null;
    window.__lockCalls = [];
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => locked });
    Object.defineProperty(Element.prototype, 'requestPointerLock', { configurable: true, value(options) {
      window.__lockCalls.push({ id: this.id, options: options ?? null });
      locked = this;
      document.dispatchEvent(new Event('pointerlockchange'));
      return Promise.resolve();
    } });
    Object.defineProperty(document, 'exitPointerLock', { configurable: true, value() {
      locked = null;
      document.dispatchEvent(new Event('pointerlockchange'));
      return Promise.resolve();
    } });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');
  await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 120000 });
  await page.locator('#start-button').click();
  if (native) await page.waitForFunction(() => document.pointerLockElement?.id === 'game-canvas');
  const state = () => page.evaluate(() => ({
    mode: window.__wireTheHouse.apprentice.mode,
    locked: document.pointerLockElement?.id ?? null,
    yaw: window.__wireTheHouse.player.yaw,
    calls: window.__lockCalls ?? [],
  }));
  const started = await state();
  assert.equal(started.mode, 'point', 'Default desktop coordinator mode changed');
  assert.equal(started.locked, 'game-canvas', `Starting with an Apprentice must allow mouse look: ${JSON.stringify(started)}`);
  if (native) {
    await page.mouse.move(350, 450);
    await page.mouse.move(400, 450);
  } else await page.evaluate(() => {
    const event = new MouseEvent('mousemove', { bubbles: true });
    Object.defineProperties(event, { movementX: { value: 32 }, movementY: { value: 0 } });
    document.dispatchEvent(event); // The first delta after lock is intentionally discarded.
    document.dispatchEvent(event);
  });
  const moved = await state();
  assert(Math.abs(moved.yaw - started.yaw) > 0.02, `Coordinator mouse look did not turn: ${JSON.stringify({ started, moved })}`);
  await page.evaluate(() => document.exitPointerLock());
  await page.locator('#game-canvas').click({ position: { x: 400, y: 450 } });
  if (native) await page.waitForFunction(() => document.pointerLockElement?.id === 'game-canvas');
  assert.equal((await state()).locked, 'game-canvas', 'Clicking the playfield must restore mouse look after Escape');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('wirehouse:select-tool', { detail: 'spray' })));
  assert.equal((await state()).mode, 'off', 'Selecting a Worker tool must exit Coordinator');
  await page.evaluate(() => document.exitPointerLock());
  await page.locator('#game-canvas').click({ position: { x: 400, y: 450 } });
  if (native) await page.waitForFunction(() => document.pointerLockElement?.id === 'game-canvas');
  assert.equal((await state()).locked, 'game-canvas', 'Worker mode must also restore mouse look');
  await page.keyboard.press('KeyV');
  assert.equal((await state()).mode, 'plan', 'V must open the Coordinator plan');
  assert.equal((await state()).locked, null, 'The readable plan must release the pointer');
  await page.keyboard.press('KeyT');
  if (native) await page.waitForFunction(() => document.pointerLockElement?.id === 'game-canvas');
  assert.equal((await state()).mode, 'point', 'T must return to pointing');
  assert.equal((await state()).locked, 'game-canvas', 'Returning from the plan must restore mouse look');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, native, started, moved, final: await state() }));
} finally {
  await browser.close();
}
