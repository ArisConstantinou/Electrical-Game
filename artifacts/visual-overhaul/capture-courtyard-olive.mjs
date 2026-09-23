import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const variant = process.argv[2] || 'before';
const root = path.resolve('dist');
const output = path.resolve('artifacts/visual-overhaul');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = [];
try {
  for (const [name, viewport, touch] of [['desktop', { width: 1365, height: 768 }, false], ['portrait', { width: 390, height: 844 }, true]]) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://127.0.0.1:5365/Electrical-Game/**', async route => {
      const relative = decodeURIComponent(new URL(route.request().url()).pathname).slice('/Electrical-Game/'.length) || 'index.html';
      const file = path.resolve(root, relative);
      if (!file.startsWith(root + path.sep)) return route.abort();
      try {
        const extension = path.extname(file).toLowerCase();
        await route.fulfill({ status: 200, body: await fs.readFile(file), contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.svg': 'image/svg+xml' })[extension] || 'application/octet-stream' });
      } catch { await route.fulfill({ status: 404, body: `Missing isolated asset: ${relative}` }); }
    });
    await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview');
    await page.locator('#start-button').click({ timeout: 90000 });
    await page.waitForFunction(() => window.__wireTheHouse?.started && window.__wireTheHouse?.room.mansionWing && getComputedStyle(document.querySelector('#start-screen')).visibility === 'hidden', null, { timeout: 45000 });
    await page.evaluate(() => {
      const game = window.__wireTheHouse;
      game.step = () => {};
      game.input.locked = false;
      game.player.velocity.set(0, 0, 0);
      const camera = game.player.camera;
      camera.position.set(10.2, 1.65, 13.8);
      camera.lookAt(13.35, 1.8, 11.35);
      camera.updateMatrixWorld(true);
      game.room.update(0, camera);
    });
    await page.waitForTimeout(1200);
    await page.evaluate(async () => { const renderer = window.__wireTheHouse.renderer; renderer.render(); await renderer.waitForFrame(); });
    await page.screenshot({ path: path.join(output, `courtyard-olive-${variant}-${name}.png`) });
    const state = await page.evaluate(async () => {
      const game = window.__wireTheHouse;
      const tree = game.room.mansionWing.courtyard.tree;
      const obstacle = game.room.mansionWing.obstacles.find(item => item.id === 'retained-olive-trunk');
      let leafInstances = 0, leafTriangles = 0;
      tree.traverse(object => { if (object.isInstancedMesh && object.name.startsWith('Narrow silver-backed olive leaves')) { leafInstances += object.count; leafTriangles += object.count * object.geometry.getAttribute('position').count / 3; } });
      const intervals = [];
      await new Promise(resolve => { let last = performance.now(); const tick = now => { intervals.push(now - last); last = now; if (intervals.length < 90) requestAnimationFrame(tick); else resolve(); }; requestAnimationFrame(tick); });
      intervals.sort((a, b) => a - b);
      return { leafInstances, leafTriangles, treeScale: tree.scale.x, obstacle, medianMs: intervals[45], p95Ms: intervals[85], renderError: game.renderer.renderError };
    });
    assert.equal(errors.length, 0);
    assert.equal(state.renderError, '');
    assert(state.obstacle && state.obstacle.minX < 13.35 && state.obstacle.maxX > 13.35);
    report.push({ name, viewport, touch, state, errors });
    await context.close();
  }
} finally { await browser.close(); }
await fs.writeFile(path.join(output, `courtyard-olive-${variant}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
