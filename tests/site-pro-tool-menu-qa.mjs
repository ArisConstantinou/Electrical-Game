import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { blockPointerLock } from './browser-safety.mjs';

const output = 'artifacts/site-pro-04/review/mobile-tool-menu';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = [];
try {
  for (const [name, width, height] of [
    ['portrait', 390, 844], ['landscape', 844, 390], ['compact-landscape', 667, 375], ['tablet', 820, 1180],
  ]) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true });
    await blockPointerLock(context);
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:5365/Electrical-Game/');
    await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 45000 });
    await page.locator('#start-button').tap();
    await page.locator('#site-pro-tools').tap();
    await page.locator('#mobile-tool-slider [data-tool="hammer"]').tap();
    await page.waitForTimeout(100);
    for (const state of ['closed', 'open']) {
      if (state === 'open') await page.locator('#site-pro-tools').tap();
      const measure = await page.evaluate(() => {
        const bounds = selector => {
          const element = document.querySelector(selector), box = element?.getBoundingClientRect();
          return box ? { x: box.x, y: box.y, width: box.width, height: box.height, visible: element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) } : null;
        };
        const panel = ['#mobile-tool-slider', '#tool-quick-controls', '#aim-quick-controls'].map(bounds);
        const center = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
        return { open: document.querySelector('#game-shell').dataset.toolsOpen,
          panel, centerTag: center?.tagName, centerId: center?.id ?? '',
          centerBlockedByMenu: Boolean(center?.closest('#mobile-tool-slider,#tool-quick-controls,#aim-quick-controls')),
          hintVisible: document.querySelector('#interaction-prompt').checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
          viewport: [innerWidth, innerHeight], overflow: document.documentElement.scrollWidth > innerWidth,
          renderError: window.__wireTheHouse.renderer.renderError };
      });
      report.push({ name, state, ...measure });
      assert.equal(measure.overflow, false, `${name}: horizontal overflow`);
      assert.equal(measure.renderError, '', `${name}: render error`);
      assert.equal(measure.centerBlockedByMenu, false, `${name}: ${state} tools cover the centre of the scene`);
      assert.equal(measure.panel.every(part => part.visible), state === 'open', `${name}: wrong menu visibility`);
      if (state === 'open') assert.equal(measure.hintVisible, false, `${name}: tool hint obscures the picker`);
      if (state === 'open' && name.includes('landscape')) {
        assert(measure.panel[1].y > height * .7, `${name}: tool settings are not below the work wall`);
      }
      await page.screenshot({ path: `${output}/${name}-${state}.png` });
      const frameProfile = await page.evaluate(async () => {
        const frames = [];
        let previous = await new Promise(requestAnimationFrame);
        for (let index = 0; index < 60; index++) {
          const now = await new Promise(requestAnimationFrame);
          frames.push(now - previous);
          previous = now;
        }
        frames.sort((a, b) => a - b);
        return { p95Ms: frames[Math.floor(frames.length * .95)], worstMs: frames.at(-1) };
      });
      report.at(-1).frameProfile = frameProfile;
      assert(Number.isFinite(frameProfile.p95Ms), `${name}: frame profile unavailable`);
      if (state === 'open') for (const id of ['quick-chisel-width', 'quick-chisel-tilt', 'quick-hammer-side', 'quick-hammer-speed']) {
        const button = page.locator(`#${id}`);
        await button.scrollIntoViewIfNeeded();
        assert(await button.evaluate(element => {
          const box = element.getBoundingClientRect();
          return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest(`#${element.id}`) === element;
        }), `${name}: ${id} is unreachable`);
      }
    }
    await context.close();
  }
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report));
