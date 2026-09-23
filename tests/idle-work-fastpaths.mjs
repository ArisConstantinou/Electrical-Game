import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  await blockPointerLock(context);
  if (process.argv.includes('--dist')) {
    const root = resolve('dist');
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml' };
    await context.route('https://arisconstantinou.github.io/Electrical-Game/**', async route => {
      const relative = decodeURIComponent(new URL(route.request().url()).pathname.slice('/Electrical-Game/'.length)) || 'index.html';
      const file = resolve(root, relative);
      if (!file.startsWith(`${root}\\`) && file !== root) return route.abort();
      try { await route.fulfill({ status: 200, contentType: mime[extname(file)] ?? 'application/octet-stream', body: await readFile(file) }); }
      catch { await route.abort(); }
    });
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.argv.includes('--dist') ? 'https://arisconstantinou.github.io/Electrical-Game/?renderer=webgl' : 'http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');
  await page.locator('#apprentice-count').selectOption('0');
  await page.locator('#start-button').tap({ timeout: 120000 });
  await page.waitForFunction(() => window.__wireTheHouse?.workerBody?.loaded);
  const result = await page.evaluate(() => {
    const game = window.__wireTheHouse, pvc = game.pvc, cart = game.mixing.wheelbarrow;
    game.step = () => {};
    const far = pvc.stockAimed();
    pvc.present();
    const idleRevision = cart.mortarSlump.revision, idlePosition = cart.model.group.position.clone();
    for (let i = 0; i < 300; i++) cart.update(1 / 120);
    const idleUnchanged = cart.mortarSlump.revision === idleRevision && cart.model.group.position.equals(idlePosition);

    game.renderer.camera.position.set(.9, 1.65, .75);
    game.renderer.camera.lookAt(3.52, 1.42, 1.15);
    game.renderer.camera.updateMatrixWorld(true);
    pvc.present();
    const near = pvc.stockAimed(), useLabel = document.querySelector('#site-pro-use span')?.textContent;
    pvc.stock.position.x += 1;
    game.renderer.camera.position.x += 1;
    game.renderer.camera.lookAt(4.52, 1.42, 1.15);
    game.renderer.camera.updateMatrixWorld(true);
    const movedStock = pvc.stockAimed();
    const entered = cart.enter(), driveStart = cart.model.group.position.clone();
    game.input.keys.add('KeyW');
    for (let i = 0; i < 96; i++) cart.update(1 / 120);
    game.input.keys.delete('KeyW');
    const travel = cart.model.group.position.distanceTo(driveStart);
    cart.release();
    return { far, near, movedStock, useLabel, idleUnchanged, entered, travel };
  });
  assert.equal(result.far, false, 'Out-of-reach PVC stock must not aim');
  assert.equal(result.near, true, 'PVC stock must become aimable again when close');
  assert.equal(result.movedStock, true, 'PVC stock must remain aimable after editor translation');
  assert.equal(result.useLabel, 'ΚΟΨΕ', 'PVC prompt must resume when close');
  assert.equal(result.idleUnchanged, true, 'Settled cart must remain stable while parked');
  assert.equal(result.entered, true, 'Cart must still enter drive mode');
  assert(result.travel > .1, 'Cart must still move after idle frames');
  assert.deepEqual(errors, [], 'No browser errors');
  console.log(JSON.stringify(result));
  await context.close();
} finally { await browser.close(); }
