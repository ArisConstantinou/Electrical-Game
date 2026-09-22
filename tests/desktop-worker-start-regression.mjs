import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5365/Electrical-Game/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 45000 });
  await page.locator('#start-button').click();
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => ({ lock: document.pointerLockElement?.id ?? null,
    target: window.__wireTheHouse.input.desktop?.lockTarget?.id ?? null,
    fine: matchMedia('(any-pointer: fine)').matches,
    coarse: matchMedia('(pointer: coarse)').matches,
    apprenticeCount: window.__wireTheHouse.apprentice.count,
    apprenticeOwns: window.__wireTheHouse.apprentice.ownsInput,
    yaw: window.__wireTheHouse.player.yaw,
    active: document.activeElement?.id ?? null,
    startHidden: document.querySelector('#start-screen')?.classList.contains('hidden') }));
  await page.mouse.move(690, 380);
  await page.mouse.move(740, 400);
  const after = await page.evaluate(() => ({ lock: document.pointerLockElement?.id ?? null,
    yaw: window.__wireTheHouse.player.yaw, active: document.activeElement?.id ?? null }));
  assert.equal(before.apprenticeCount, 1, 'Regression needs the default apprentice present');
  assert.equal(before.apprenticeOwns, false, 'Worker must own input until Coordinator is chosen');
  assert.equal(before.lock, 'game-canvas', 'Start must acquire desktop mouse look');
  assert(Math.abs(after.yaw - before.yaw) > .01, 'Mouse movement must rotate the player');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ before, after, errors }));
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mobile.goto('http://127.0.0.1:5365/Electrical-Game/', { waitUntil: 'networkidle' });
  await mobile.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 45000 });
  await mobile.locator('#start-button').tap();
  assert.equal(await mobile.evaluate(() => window.__wireTheHouse.apprentice.ownsInput), false);
  await mobile.locator('#site-pro-coordinator').tap();
  assert.equal(await mobile.evaluate(() => window.__wireTheHouse.apprentice.ownsInput), true);
  await mobile.locator('#site-pro-tools').tap();
  assert.equal(await mobile.evaluate(() => window.__wireTheHouse.apprentice.ownsInput), false);
  console.log('mobile: Worker → Coordinator → Worker input ownership passed');
} finally { await browser.close(); }
