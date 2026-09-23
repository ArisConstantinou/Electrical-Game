import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { blockPointerLock } from './browser-safety.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5365/Electrical-Game/';
const out = process.argv[3] ?? 'output/movement-stick-modes-ui';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 820, height: 1180 }]) {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
    await blockPointerLock(context);
    if (process.argv.includes('--dist')) {
      const dist = resolve('dist');
      const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.glb':'model/gltf-binary','.woff2':'font/woff2'};
      await context.route('https://arisconstantinou.github.io/Electrical-Game/**', async route => {
        const path = resolve(dist, decodeURIComponent(new URL(route.request().url()).pathname.slice('/Electrical-Game/'.length)) || 'index.html');
        if (!path.startsWith(dist)) return route.abort();
        try { if (!(await stat(path)).isFile()) return route.abort(); await route.fulfill({status:200,contentType:mime[extname(path)]??'application/octet-stream',body:await readFile(path)}); }
        catch { await route.abort(); }
      });
    }
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => window.__wireTheHouse?.renderer.renderCamera);
    await page.locator('#start-button').tap();
    await page.waitForFunction(() => window.__wireTheHouse.started);
    assert.equal(await page.evaluate(() => window.__wireTheHouse.movementStickMode), 'fixed', 'Movement stick must start anchored');
    await page.locator('#worker-bar-handle').tap();
    await page.locator('#settings-toggle').tap();
    await page.locator('#movement-stick-mode').tap();
    await page.locator('#settings-close').tap();
    const cdp = await context.newCDPSession(page);
    const points = new Map();
    const send = async (type, id, x, y) => {
      if (type === 'touchStart' || type === 'touchMove') points.set(id, { id, x, y });
      const ending = points.get(id);
      if (type === 'touchEnd') points.delete(id);
      await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? points.size ? [ending] : [] : [...points.values()] });
    };
    const rect = async selector => page.locator(selector).evaluate(el => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width, height: r.height };
    });
    const state = () => page.evaluate(() => {
      const g = window.__wireTheHouse, r = document.querySelector('#joystick').getBoundingClientRect();
      return { mode: g.movementStickMode, owner: g.mobileControls.joystickPointer, move: { ...g.input.mobileMove }, look: { ...g.input.mobileLook }, held: g.input.actionHeld, ring: { x: r.left + r.width / 2, y: r.top + r.height / 2 }, error: g.renderer.renderError };
    });
    const start = await rect('#joystick');
    const zone = await rect('#mobile-move-zone');
    const anchor = { x: zone.x, y: zone.y };
    await send('touchStart', 1, anchor.x, anchor.y);
    let s = await state();
    assert.equal(s.mode, 'floating');
    assert.notEqual(s.owner, null);
    assert(Math.hypot(s.ring.x - anchor.x, s.ring.y - anchor.y) < 1, JSON.stringify(s));
    assert.deepEqual(s.move, { x: 0, y: 0 });
    await send('touchMove', 1, anchor.x + 25, anchor.y - 14);
    s = await state();
    assert(Math.hypot(s.move.x, s.move.y) > .1, JSON.stringify(s));
    const use = await rect('#site-pro-use');
    await send('touchStart', 2, use.x, use.y);
    s = await state();
    assert(s.held && Math.hypot(s.move.x, s.move.y) > .1, `MOVE + USE: ${JSON.stringify(s)}`);
    const aim = await rect('#look-joystick');
    await send('touchStart', 4, aim.x, aim.y);
    await send('touchMove', 4, aim.x + aim.width * .25, aim.y);
    s = await state();
    assert(s.held && Math.hypot(s.move.x, s.move.y) > .1 && Math.hypot(s.look.x, s.look.y) > .1, `MOVE + AIM + USE: ${JSON.stringify(s)}`);
    await page.screenshot({ path: `${out}/${viewport.width}x${viewport.height}-floating-held.png` });
    await send('touchEnd', 4);
    await send('touchEnd', 1);
    s = await state();
    assert(s.held);
    assert.deepEqual(s.move, { x: 0, y: 0 });
    assert(Math.hypot(s.ring.x - start.x, s.ring.y - start.y) < 1, JSON.stringify(s));
    await send('touchEnd', 2);
    assert.equal((await state()).held, false);

    await page.locator('#settings-toggle').tap();
    await page.locator('#movement-stick-mode').tap();
    await page.locator('#settings-close').tap();
    s = await state();
    assert.equal(s.mode, 'fixed');
    assert.equal(await page.locator('#movement-stick-mode b').textContent(), 'FIXED');
    const fixed = await rect('#joystick');
    await send('touchStart', 3, fixed.x, fixed.y);
    s = await state();
    assert.notEqual(s.owner, null, JSON.stringify({ state: s, target: await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, fixed), zone: await rect('#mobile-move-zone'), settings: await page.locator('#game-shell').getAttribute('class') }));
    assert.deepEqual(s.move, { x: 0, y: 0 });
    await send('touchMove', 3, fixed.x + fixed.width * .28, fixed.y - fixed.height * .1);
    s = await state();
    assert(Math.hypot(s.move.x, s.move.y) > .1);
    assert(Math.hypot(s.ring.x - fixed.x, s.ring.y - fixed.y) < 1);
    await page.screenshot({ path: `${out}/${viewport.width}x${viewport.height}-fixed.png` });
    await send('touchEnd', 3);
    assert.deepEqual((await state()).move, { x: 0, y: 0 });
    assert.equal((await state()).error, '');
    assert.deepEqual(errors, []);
    await page.reload();
    await page.waitForFunction(() => window.__wireTheHouse?.renderer.renderCamera);
    assert.equal(await page.evaluate(() => window.__wireTheHouse.movementStickMode), 'fixed', 'Joystick choice did not persist after reload');
    results.push({ viewport, floatingAnchor: anchor, fixedAnchor: fixed, simultaneousMoveAndUse: true });
    await context.close();
  }
  console.log(JSON.stringify({ passed: true, results }));
} finally {
  await browser.close();
}
