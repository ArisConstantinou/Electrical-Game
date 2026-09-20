import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const out = 'output/start-screen-ui';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { errors: [], viewports: {} };

try {
  for (const [name, viewport] of Object.entries({ desktop: { width: 1440, height: 900 }, tablet: { width: 820, height: 1180 }, mobile: { width: 390, height: 844 } })) {
    const context = await browser.newContext({ viewport, hasTouch: name === 'mobile', isMobile: name === 'mobile' });
    await context.addInitScript(() => {
      let locked = null;
      Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => locked });
      Object.defineProperty(Element.prototype, 'requestPointerLock', { configurable: true, value(options) {
        window.__startLockCalls ??= [];
        window.__startLockCalls.push(options ?? null);
        locked = this;
        document.dispatchEvent(new Event('pointerlockchange'));
        return Promise.resolve();
      }});
      Object.defineProperty(document, 'exitPointerLock', { configurable: true, value() {
        locked = null;
        document.dispatchEvent(new Event('pointerlockchange'));
      }});
    });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(`${name}: ${error.message}`));
    await page.goto('http://127.0.0.1:5365/Electrical-Game/');
    const start = page.locator('#start-button');
    await start.waitFor({ state: 'visible', timeout: 120000 });
    await page.waitForFunction(() => !document.querySelector('#start-button')?.disabled, null, { timeout: 120000 });
    await page.screenshot({ path: `${out}/${name}-menu.png` });
    const layout = await page.evaluate(() => {
      const box = selector => document.querySelector(selector).getBoundingClientRect();
      const start = box('#start-button');
      const models = box('#start-models');
      const settings = box('#start-settings');
      return {
        active: document.activeElement?.id,
        start: { x: start.x, y: start.y, w: start.width, h: start.height },
        modelsY: models.y,
        settingsY: settings.y,
        backgroundImage: getComputedStyle(document.querySelector('#start-screen')).backgroundImage,
        centerDelta: Math.abs(start.x + start.width / 2 - innerWidth / 2),
        modelsBelow: models.y > start.y + start.height,
        settingsBelow: settings.y > start.y + start.height,
      };
    });
    assert(layout.centerDelta < 2, `${name}: Start must be centred`);
    assert(layout.modelsBelow && layout.settingsBelow, `${name}: icon buttons must sit below Start`);
    assert(layout.start.h >= 60, `${name}: Start target is too small`);
    assert.equal(layout.active, 'start-button', `${name}: ready Start must receive focus`);
    assert.equal(layout.backgroundImage.includes('start-site-cinematic-portrait.webp'), name !== 'desktop', `${name}: responsive loading artwork mismatch`);

    await page.locator('#start-settings').click();
    assert.equal(await page.locator('#settings-panel').getAttribute('aria-hidden'), 'false');
    await page.locator('#settings-close').click();
    await page.locator('#start-models').click();
    await page.locator('#model-inspector').waitFor({ state: 'visible', timeout: 120000 });
    await page.locator('#model-close').click();

    await start.click();
    await page.waitForFunction(() => window.__wireTheHouse?.started === true);
    const started = await page.evaluate(() => ({
      hidden: document.querySelector('#start-screen').classList.contains('hidden'),
      started: window.__wireTheHouse.started,
      calls: window.__startLockCalls ?? [],
    }));
    assert(started.hidden && started.started, `${name}: one Start click must enter the game`);
    if (name === 'desktop') {
      assert.equal(started.calls.length, 1, 'Desktop Start must request Pointer Lock exactly once');
      assert.equal(started.calls[0], null, 'Initial Pointer Lock must use the compatible standard request');
    } else assert.equal(started.calls.length, 0, 'Touch Start must not request Pointer Lock');
    await page.screenshot({ path: `${out}/${name}-started.png` });
    report.viewports[name] = { layout, started };
    await context.close();
  }
  assert.equal(report.errors.length, 0, 'No page errors expected');
  report.passed = true;
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}

console.log(JSON.stringify(report));
