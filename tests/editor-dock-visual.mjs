import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const phase = process.argv[2] === 'after' ? 'after' : 'before';
const output = new URL('../artifacts/site-pro-04/review/editor-dock-seam/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const [name, viewport, mobile] of [
    ['portrait', { width: 390, height: 844 }, true],
    ['large-portrait', { width: 590, height: 1180 }, true],
    ['tablet', { width: 820, height: 1180 }, true],
    ['desktop', { width: 1440, height: 900 }, false],
  ]) {
    const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&renderer=webgl', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 120_000 });
    await page.locator('#start-level-editor').click();
    await page.waitForFunction(() => window.__wireTheHouse?.levelEditor.active);
    await page.locator('.level-editor__bottom-nav [data-editor-tab="transform"]').click();
    await page.waitForTimeout(200);
    const geometry = await page.evaluate(() => {
      const box = selector => {
        const element = document.querySelector(selector);
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
          display: getComputedStyle(element).display, background: getComputedStyle(element).backgroundColor };
      };
      return { nav: box('.level-editor__bottom-nav'), toggle: box('#level-dock-toggle'),
        edit: box('.level-editor__bottom-nav [data-editor-tab="transform"]'), toolbar: box('.level-editor__bar') };
    });
    await page.screenshot({ path: fileURLToPath(new URL(`${phase}-${name}.png`, output)) });
    console.log(JSON.stringify({ phase, name, geometry, errors }));
    if (phase === 'after') {
      assert.equal(errors.length, 0, `${name}: ${errors.join(', ')}`);
      const { nav, toggle, edit, toolbar } = geometry;
      assert(Math.abs(toggle.x + toggle.width / 2 - edit.x - edit.width / 2) < 2, `${name}: toggle must align with Edit`);
      assert(toggle.y + toggle.height >= nav.y, `${name}: toggle must meet navigation`);
      assert(toolbar.display !== 'none', `${name}: edit toolbar visible`);
      await page.locator('#level-dock-toggle').click();
      assert.equal(await page.locator('#level-dock-toggle').getAttribute('aria-expanded'), 'false');
      assert(await page.locator('#level-editor').evaluate(el => el.classList.contains('dock-collapsed')));
      await page.screenshot({ path: fileURLToPath(new URL(`after-${name}-collapsed.png`, output)) });
      await page.locator('#level-dock-toggle').click();
      assert.equal(await page.locator('#level-dock-toggle').getAttribute('aria-expanded'), 'true');
      assert(await page.locator('.level-editor__bottom-nav [data-editor-tab="transform"]').isVisible());
      await page.screenshot({ path: fileURLToPath(new URL(`after-${name}-nav-only.png`, output)) });
    }
    await context.close();
  }
} finally {
  await browser.close();
}
