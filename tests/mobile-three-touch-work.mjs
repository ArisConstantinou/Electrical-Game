import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
await mkdir('artifacts/site-pro-04/review/three-touch', { recursive: true });
try {
  const base = process.env.QA_BASE ?? 'http://127.0.0.1:5365/Electrical-Game/';
  for (const [name, viewport] of [
    ['portrait', { width: 390, height: 844 }],
    ['landscape', { width: 844, height: 390 }],
    ['tablet', { width: 820, height: 1180 }],
  ].filter(([name]) => !process.argv.includes('--portrait-only') || name === 'portrait')) {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await blockPointerLock(context);
    if (process.argv.includes('--dist')) {
      const dist = resolve('dist');
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
        '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2' };
      await context.route('https://arisconstantinou.github.io/Electrical-Game/**', async route => {
        const path = resolve(dist, decodeURIComponent(new URL(route.request().url()).pathname.slice('/Electrical-Game/'.length)) || 'index.html');
        if (!path.startsWith(dist)) return route.abort();
        try {
          if (!(await stat(path)).isFile()) return route.abort();
          await route.fulfill({ status: 200, contentType: mime[extname(path)] ?? 'application/octet-stream', body: await readFile(path) });
        } catch { return route.abort(); }
      });
    }
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(`${base}?renderer=webgl`);
      await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 120000 });
      await page.locator('#apprentice-count').selectOption('0');
      await page.locator('#start-button').tap();
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('wirehouse:select-tool', { detail: 'hose' })));
      await page.waitForFunction(() => window.__wireTheHouse?.selectedTool === 'hose');
      const controls = await page.evaluate(() => {
        const rect = selector => {
          const element = document.querySelector(selector);
          const bounds = element.getBoundingClientRect();
          return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2,
            width: bounds.width, height: bounds.height, visible: getComputedStyle(element).visibility !== 'hidden' && bounds.width > 0 && bounds.height > 0 };
        };
        return { move: rect('#joystick'), aim: rect('#look-joystick'), use: rect('#site-pro-use') };
      });
      assert(Object.values(controls).every(control => control.visible && control.x >= 0 && control.x <= viewport.width &&
        control.y >= 0 && control.y <= viewport.height), `${name}: all three controls must be visible and reachable`);
      const initial = await page.evaluate(() => {
        const game = window.__wireTheHouse;
        return { position: game.renderer.camera.position.toArray(), yaw: game.player.yaw,
          litres: game.roomWater.telemetry.receivedLitres };
      });
      const touch = (x, y, id) => ({ x, y, id });
      const move = touch(controls.move.x, controls.move.y, 1);
      const aim = touch(controls.aim.x, controls.aim.y, 2);
      const use = touch(controls.use.x, controls.use.y, 3);
      const cdp = await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [move] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [move, aim] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [move, aim, use] });
      const moved = touch(move.x + 32, move.y, 1);
      const aimed = touch(aim.x + 28, aim.y - 8, 2);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [moved, aimed, use] });
      await page.waitForTimeout(1600);
      const active = await page.evaluate(() => {
        const game = window.__wireTheHouse;
        return { position: game.renderer.camera.position.toArray(), yaw: game.player.yaw,
          litres: game.roomWater.telemetry.receivedLitres, move: game.input.mobileMove,
          look: game.input.mobileLook, held: game.input.actionHeld,
          renderError: game.renderer.renderError, pointerLock: Boolean(document.pointerLockElement) };
      });
      assert(active.held, `${name}: USE must remain held with MOVE and AIM active`);
      assert(Math.abs(active.move.x) > .1 && Math.abs(active.look.x) > .1,
        `${name}: both sticks must respond while USE is held: ${JSON.stringify(active)}`);
      assert(Math.hypot(active.position[0] - initial.position[0], active.position[2] - initial.position[2]) > .08,
        `${name}: player must move while aiming and using: ${JSON.stringify({ initial, active, controls })}`);
      assert(Math.abs(active.yaw - initial.yaw) > .02, `${name}: camera must turn while moving and using`);
      assert(active.litres > initial.litres, `${name}: held hose must produce real water while both sticks move`);
      assert.equal(active.renderError, '');
      assert.equal(active.pointerLock, false);
      await page.evaluate(() => dispatchEvent(new Event('resize')));
      await page.waitForTimeout(120);
      const afterResize = await page.evaluate(() => ({
        move: { ...window.__wireTheHouse.input.mobileMove }, look: { ...window.__wireTheHouse.input.mobileLook },
        held: window.__wireTheHouse.input.actionHeld,
      }));
      assert(afterResize.held && Math.abs(afterResize.move.x) > .1 && Math.abs(afterResize.look.x) > .1,
        `${name}: a browser viewport resize must not cancel held MOVE+AIM+USE: ${JSON.stringify(afterResize)}`);
      if (name === 'portrait') {
        await page.setViewportSize({ width: viewport.width, height: viewport.height - 44 });
        await page.waitForTimeout(120);
        const afterViewport = await page.evaluate(() => ({
          move: { ...window.__wireTheHouse.input.mobileMove }, look: { ...window.__wireTheHouse.input.mobileLook },
          held: window.__wireTheHouse.input.actionHeld,
          joystick: document.querySelector('#joystick').getBoundingClientRect().toJSON(),
        }));
        console.log(JSON.stringify({ viewportResize: afterViewport }));
        assert(afterViewport.held && Math.abs(afterViewport.move.x) > .1 && Math.abs(afterViewport.look.x) > .1,
          `portrait: toolbar-height change must preserve active MOVE+AIM+USE: ${JSON.stringify(afterViewport)}`);
      }
      await page.screenshot({ path: `artifacts/site-pro-04/review/three-touch/${name}.jpg`, type: 'jpeg', quality: 82 });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(100);
      const released = await page.evaluate(() => ({
        held: window.__wireTheHouse.input.actionHeld,
        move: { ...window.__wireTheHouse.input.mobileMove },
        look: { ...window.__wireTheHouse.input.mobileLook },
      }));
      assert.equal(released.held, false);
      assert.deepEqual(released.move, { x: 0, y: 0 });
      assert.deepEqual(released.look, { x: 0, y: 0 });
      assert.deepEqual(errors, []);
      results.push({ name, controls, movementMetres: Math.hypot(active.position[0] - initial.position[0], active.position[2] - initial.position[2]),
        yawRadians: active.yaw - initial.yaw, waterLitres: active.litres - initial.litres });
    } finally { await context.close(); }
  }
  console.log(JSON.stringify({ pass: true, emulatedMobile: true, results }));
} finally { await browser.close(); }
