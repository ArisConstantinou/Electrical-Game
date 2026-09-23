import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const url = 'http://127.0.0.1:5365/Electrical-Game/?mansion=preview&editor=1&renderer=webgl';
const output = new URL('../artifacts/site-pro-04/review/editor-desktop-dock/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await blockPointerLock(desktop);
  const page = await desktop.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 45000 });
  const editor = page.locator('#level-editor');
  const nav = page.locator('.level-editor__bottom-nav');
  assert(await nav.isVisible());
  assert(!(await page.locator('header', { has: page.locator('#level-close') }).isVisible()));
  assert(!(await page.locator('#level-list').isVisible()));
  assert(!(await page.locator('.level-editor__bar').isVisible()));
  const dock = await nav.boundingBox();
  assert(dock && dock.width < 600 && dock.height < 90,
    `Desktop dock should leave the world visible: ${JSON.stringify(dock)}`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: fileURLToPath(new URL('desktop-after-closed.png', output)) });

  await nav.locator('[data-editor-tab="select"]').click();
  assert(await page.locator('#level-view-quick').isVisible());
  assert(!(await page.locator('#level-list').isVisible()));
  await page.locator('#level-browser-toggle').click();
  assert(await page.locator('#level-list').isVisible());
  await nav.locator('[data-editor-tab="select"]').click();
  assert(!(await page.locator('#level-editor aside').isVisible()));

  await nav.locator('[data-editor-tab="build"]').click();
  assert(await page.locator('#level-add-brick').isVisible());
  assert(!(await page.locator('#level-list').isVisible()));
  await page.screenshot({ path: fileURLToPath(new URL('desktop-build-open.png', output)) });
  await page.locator('#level-add-brick').click();
  assert.equal(await editor.getAttribute('data-tab'), 'transform');
  assert(await page.locator('.level-editor__bar').isVisible());
  assert(!(await page.locator('.level-editor__inspector').isVisible()));
  await page.locator('#level-details-toggle').click();
  assert(await page.locator('.level-editor__inspector').isVisible());
  await page.screenshot({ path: fileURLToPath(new URL('desktop-edit-details.png', output)) });
  await page.locator('#level-details-close').click();
  assert(!(await page.locator('.level-editor__inspector').isVisible()));

  await nav.locator('[data-editor-tab="starts"]').click();
  assert(await page.locator('#level-player').isVisible());
  await page.locator('#level-scene-settings').click();
  await page.locator('#level-nav-mode').selectOption('wheel');
  assert(await page.locator('#level-wheel-toggle').isVisible());
  assert(!(await nav.isVisible()));
  await page.locator('#level-wheel-toggle').click();
  await page.locator('.level-editor__wheel [data-editor-tab="save"]').click();
  assert(await page.locator('#level-save-mobile').isVisible());
  await page.locator('#level-nav-mode').selectOption('bottom');
  assert(await nav.isVisible());
  await nav.locator('[data-editor-tab="save"]').click();
  assert(!(await page.locator('.level-editor__save').isVisible()));
  await page.locator('#level-dock-toggle').click();
  assert(await editor.evaluate(element => element.classList.contains('dock-collapsed')));
  const collapsed = await nav.boundingBox();
  assert(collapsed && collapsed.width <= 74 && collapsed.height <= 25);
  await page.screenshot({ path: fileURLToPath(new URL('desktop-dock-collapsed.png', output)) });
  await page.locator('#level-dock-toggle').click();
  assert(await nav.locator('[data-editor-tab="build"]').isVisible());

  for (const [name, viewport] of [
    ['portrait', { width: 390, height: 844 }],
    ['landscape', { width: 844, height: 390 }],
    ['tablet', { width: 820, height: 1180 }],
  ]) {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
    await blockPointerLock(context);
    const mobile = await context.newPage();
    mobile.on('pageerror', error => errors.push(`${name}: ${error.message}`));
    await mobile.goto(url);
    await mobile.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 45000 });
    assert(await mobile.locator('.level-editor__bottom-nav').isVisible(), `${name} dock`);
    assert(!(await mobile.locator('.level-editor__bar').isVisible()), `${name} initial sheet`);
    await mobile.locator('.level-editor__bottom-nav [data-editor-tab="build"]').tap();
    assert(await mobile.locator('#level-add-brick').isVisible(), `${name} build`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ desktopDock: dock, collapsed, responsive: ['portrait', 'landscape', 'tablet'], errors }));
  await desktop.close();
} finally { await browser.close(); }
