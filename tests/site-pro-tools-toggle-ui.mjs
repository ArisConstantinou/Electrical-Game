import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5365/Electrical-Game/?renderer=webgl';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
    await blockPointerLock(context);
    const page = await context.newPage();
    await page.goto(url);
    await page.waitForFunction(() => window.__wireTheHouse?.hud, undefined, { timeout: 120000 });
    await page.selectOption('#apprentice-count', '0');
    await page.locator('#start-button').tap();
    await page.locator('#start-screen').waitFor({ state: 'hidden' });
    const toggle = page.locator('#site-pro-tools');
    for (let attempt = 0; attempt < 12; attempt++) {
      await toggle.tap();
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true', `Open touch ${attempt} toggled twice or was ignored`);
      assert(await page.locator('#mobile-tool-slider').isVisible());
      await toggle.tap();
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false', `Close touch ${attempt} toggled twice or was ignored`);
      assert.equal(await page.locator('#mobile-tool-slider').isVisible(), false);
    }
    results.push({ viewport, touchToggles: 24, selected: await page.evaluate(() => window.__wireTheHouse.selectedTool) });
    await context.close();
  }
} finally { await browser.close(); }
console.log(JSON.stringify({ passed: true, results }));
