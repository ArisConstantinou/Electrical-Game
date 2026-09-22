import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { blockPointerLock } from './browser-safety.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const output = 'artifacts/site-pro-04/review/mobile-hud-cleanup';
await mkdir(output, { recursive: true });
const results = [];
try {
  for (const [name, viewport, mobile] of [
    ['portrait', { width: 390, height: 844 }, true],
    ['narrow', { width: 320, height: 720 }, true],
    ['landscape', { width: 844, height: 390 }, true],
    ['tablet', { width: 820, height: 1180 }, true],
    ['desktop', { width: 1440, height: 900 }, false],
  ]) {
    const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
    await blockPointerLock(context);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.stack ?? error.message));
    try {
      await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');
      await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 120000 });
      await page.locator('#apprentice-count').selectOption('0');
      await page.locator('#start-button').click();
      await page.waitForFunction(() => document.querySelector('#start-screen')?.classList.contains('hidden'));
      assert.equal(await page.locator('#top-hud').evaluate(el => getComputedStyle(el).display), 'none');
      assert.equal(await page.locator('#model-inspector-open').evaluate(el => el.parentElement?.id), 'settings-panel');
      assert.equal(await page.locator('#model-inspector-open').isVisible(), false);
      if (mobile) {
        for (const [selector, pressed] of [['#mobile-stand', 'true'], ['#mobile-crouch', 'false']]) {
          const button = page.locator(selector);
          assert.equal(await button.getAttribute('aria-pressed'), pressed);
          const box = await button.boundingBox();
          assert(box && box.width >= 44 && box.height >= 44, `${name}: ${selector} touch target`);
          assert(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height,
            `${name}: ${selector} outside viewport`);
          assert.equal(await button.evaluate(el => getComputedStyle(el).borderRadius), '50%', `${name}: ${selector} must be circular`);
        }
        assert.equal(await page.locator('#site-pro-use').evaluate(el => getComputedStyle(el).borderRadius), '50%');
        assert.equal(await page.locator('#site-pro-coordinator').evaluate(el => getComputedStyle(el).borderRadius), '50%');
        const actionIcons = await page.evaluate(() => ({
          stand: getComputedStyle(document.querySelector('#mobile-stand'), '::before').backgroundImage,
          crouch: getComputedStyle(document.querySelector('#mobile-crouch'), '::before').backgroundImage,
          standLabel: getComputedStyle(document.querySelector('#mobile-stand span')).display,
          crouchLabel: getComputedStyle(document.querySelector('#mobile-crouch span')).display,
          useLabel: getComputedStyle(document.querySelector('#site-pro-use > span')).display,
        }));
        assert(actionIcons.stand !== 'none' && actionIcons.crouch !== 'none' && actionIcons.stand !== actionIcons.crouch,
          `${name}: standing and crouching need distinct human icons`);
        assert(['standLabel', 'crouchLabel', 'useLabel'].every(key => actionIcons[key] === 'none'),
          `${name}: action labels should be hidden`);
        const topIcons = await page.evaluate(() => ['#site-pro-tools', '#site-pro-coordinator', '#settings-toggle'].map(selector => {
          const button = document.querySelector(selector);
          const rect = button.getBoundingClientRect();
          return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
            textVisible: getComputedStyle(button.querySelector('span') ?? button).display !== 'none' && selector !== '#settings-toggle' };
        }));
        assert(topIcons[0].right < topIcons[1].left && topIcons[1].right < topIcons[2].left,
          `${name}: Worker, Coordinator and Settings icons must sit separately in one row`);
        assert(topIcons.every(icon => icon.top === topIcons[0].top && icon.bottom === topIcons[0].bottom),
          `${name}: top icons must share a baseline`);
        assert(topIcons.every(icon => !icon.textVisible), `${name}: top role labels should be hidden`);
        const orbit = await page.evaluate(() => Object.fromEntries(['#joystick', '#mobile-stand', '#look-joystick', '#site-pro-use'].map(selector => {
          const rect = document.querySelector(selector).getBoundingClientRect();
          return [selector, { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }];
        })));
        assert(orbit['#joystick'].bottom >= viewport.height - 50 && orbit['#look-joystick'].bottom >= viewport.height - 50,
          `${name}: joysticks should be at the bottom edge`);
        if (name === 'narrow') {
          assert(orbit['#mobile-stand'].bottom < orbit['#joystick'].top);
          assert(orbit['#site-pro-use'].bottom < orbit['#look-joystick'].top);
        } else {
          assert(orbit['#mobile-stand'].left >= orbit['#joystick'].right, `${name}: stance covers MOVE`);
          assert(orbit['#site-pro-use'].right <= orbit['#look-joystick'].left, `${name}: tool action covers AIM`);
        }
        const interactions = await page.evaluate(() => {
          const button = document.querySelector('#mobile-interact');
          button.hidden = false;
          const action = button.getBoundingClientRect();
          const use = document.querySelector('#site-pro-use').getBoundingClientRect();
          const look = document.querySelector('#look-joystick').getBoundingClientRect();
          const circular = getComputedStyle(button).borderRadius === '50%';
          button.hidden = true;
          const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
          return { circular, overlapsUse: intersects(action, use), overlapsLook: intersects(action, look) };
        });
        assert(interactions.circular && !interactions.overlapsUse && !interactions.overlapsLook,
          `${name}: contextual interaction must have its own circular target`);
        await page.locator('#mobile-crouch').tap();
        await page.waitForFunction(() => document.querySelector('#mobile-crouch')?.getAttribute('aria-pressed') === 'true');
        assert.equal(await page.evaluate(() => window.__wireTheHouse.player.crouched), true);
        await page.locator('#mobile-stand').tap();
        await page.waitForFunction(() => document.querySelector('#mobile-stand')?.getAttribute('aria-pressed') === 'true');
        assert.equal(await page.evaluate(() => window.__wireTheHouse.player.crouched), false);
      }
      await page.screenshot({ path: `${output}/${name}-game.jpg`, type: 'jpeg', quality: 85 });
      if (mobile) {
        await page.locator('#site-pro-tools').tap();
        await page.waitForFunction(() => document.querySelector('#game-shell')?.dataset.toolsOpen === 'true');
        const drawer = await page.evaluate(() => {
          const rect = document.querySelector('#mobile-tool-slider').getBoundingClientRect();
          const stick = document.querySelector('#joystick').getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom, joystickTop: stick.top };
        });
        assert(drawer.top >= 60 && drawer.bottom < drawer.joystickTop,
          `${name}: temporary tool drawer should open above the bottom controls`);
        await page.screenshot({ path: `${output}/${name}-tools.jpg`, type: 'jpeg', quality: 85 });
        await page.locator('#site-pro-tools').tap();
        await page.waitForFunction(() => document.querySelector('#game-shell')?.dataset.toolsOpen === 'false');
      }
      await page.locator('#settings-toggle').click();
      assert.equal(await page.locator('#settings-panel').getAttribute('aria-hidden'), 'false');
      await page.locator('#model-inspector-open').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${output}/${name}-settings.jpg`, type: 'jpeg', quality: 85 });
      await page.locator('#model-inspector-open').click();
      await page.waitForFunction(() => document.querySelector('#model-inspector')?.hidden === false, null, { timeout: 20000 });
      assert.equal(await page.locator('#settings-panel').getAttribute('aria-hidden'), 'true');
      await page.locator('#model-close').click();
      assert.equal(await page.locator('#model-inspector').evaluate(el => el.hidden), true);
      assert.deepEqual(errors, [], `${name}: page errors`);
      results.push({ name, passed: true });
    } finally {
      await context.close();
    }
  }
  console.log(JSON.stringify({ passed: true, browser: 'Chrome emulation', results }));
} finally {
  await browser.close();
}
