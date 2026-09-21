import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5365/Electrical-Game/';
const output = process.argv[3] ?? 'output/site-pro-after';
const checkSitePro = process.argv.includes('--site-pro');
const only = process.argv.find(value => value.startsWith('--only='))?.slice('--only='.length);
const sizes = [
  { name: 'compact-mobile-portrait', width: 320, height: 740, touch: true },
  { name: 'mobile-portrait', width: 390, height: 844, touch: true },
  { name: 'compact-mobile-landscape', width: 667, height: 375, touch: true },
  { name: 'mobile-landscape', width: 844, height: 390, touch: true },
  { name: 'tablet-portrait', width: 820, height: 1180, touch: true },
  { name: 'tablet-landscape', width: 1180, height: 820, touch: true },
  { name: 'desktop', width: 1366, height: 768, touch: false },
].filter(size => !only || size.name === only);

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { url, checkSitePro, cases: [], errors: [] };
try {
  for (const size of sizes) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, isMobile: size.touch, hasTouch: size.touch });
    await blockPointerLock(context);
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(`${size.name}: ${error.message}`));
    await page.goto(url);
    await page.waitForFunction(() => window.__wireTheHouse?.renderer.renderCamera, null, { timeout: 120000 });
    await page.locator('#apprentice-count').selectOption('0');
    const start = page.locator('#start-button');
    if (size.touch) await start.tap(); else await start.click();
    await page.waitForTimeout(500);
    const state = await page.evaluate(() => {
      const bounds = selector => { const element = document.querySelector(selector); if (!element) return null; const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom, visible: element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) }; };
      return { viewport: { width: innerWidth, height: innerHeight }, scrollWidth: document.documentElement.scrollWidth, objective: document.querySelector('#objective-compact')?.textContent, tool: window.__wireTheHouse.selectedTool, renderError: window.__wireTheHouse.renderer.renderError, controls: Object.fromEntries(['#top-hud', '#settings-toggle', '#joystick', '#look-joystick', '#site-pro-use', '#site-pro-tools', '#mobile-tool-slider', '#site-pro-desktop-tools'].map(id => [id, bounds(id)])) };
    });
    assert.ok(!state.renderError, `${size.name}: renderer error`);
    assert.ok(state.scrollWidth <= state.viewport.width + 1, `${size.name}: horizontal overflow`);
    await page.screenshot({ path: `${output}/${size.name}.png` });
    if (checkSitePro && size.touch) {
      const aim = state.controls['#look-joystick'];
      const use = state.controls['#site-pro-use'];
      assert.ok(aim?.visible && use?.visible && use.width >= 48 && use.height >= 48, `${size.name}: touch controls unavailable`);
      assert.ok(use.bottom <= aim.y, `${size.name}: USE overlaps AIM`);
      const button = page.locator('#site-pro-tools');
      assert.equal(await button.getAttribute('aria-expanded'), 'false');
      await button.tap();
      assert.equal(await button.getAttribute('aria-expanded'), 'true');
      assert.ok(await page.locator('#mobile-tool-slider').isVisible());
      await page.screenshot({ path: `${output}/${size.name}-tools.png` });
      await page.locator('#mobile-tool-slider [data-tool="hammer"]').tap();
      await page.waitForFunction(() => window.__wireTheHouse.selectedTool === 'hammer');
      assert.equal(await button.getAttribute('aria-expanded'), 'false');
      assert.equal(await page.locator('#mobile-tool-slider').isVisible(), false);
      await page.evaluate(() => window.__wireTheHouse.renderer.waitForFrame());
      await page.screenshot({ path: `${output}/${size.name}-hammer.png` });
    } else if (checkSitePro) {
      assert.ok(state.controls['#site-pro-desktop-tools']?.visible, 'desktop hotbar unavailable');
      await page.locator('#site-pro-desktop-tools [data-tool="hammer"]').click();
      await page.waitForFunction(() => window.__wireTheHouse.selectedTool === 'hammer');
      assert.equal(await page.locator('#site-pro-desktop-tools [data-tool="hammer"]').getAttribute('class'), 'selected');
      await page.evaluate(() => window.__wireTheHouse.renderer.waitForFrame());
      await page.screenshot({ path: `${output}/${size.name}-hammer.png` });
    }
    report.cases.push({ name: size.name, state });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.failure = String(error.stack ?? error);
  throw error;
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
