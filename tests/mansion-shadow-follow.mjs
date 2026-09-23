import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(process.env.QA_DIST_ROOT || 'dist');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = [];
try {
  for (const mansion of [false, true]) {
    const page = await browser.newPage({ viewport: { width: 1365, height: 768 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://127.0.0.1:5365/Electrical-Game/**', async route => {
      const relative = decodeURIComponent(new URL(route.request().url()).pathname).slice('/Electrical-Game/'.length) || 'index.html';
      const file = path.resolve(root, relative);
      if (!file.startsWith(root + path.sep)) return route.abort();
      try {
        const extension = path.extname(file).toLowerCase();
        await route.fulfill({ status: 200, body: await readFile(file), contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.svg': 'image/svg+xml' })[extension] || 'application/octet-stream' });
      } catch { await route.fulfill({ status: 404, body: `Missing isolated asset: ${relative}` }); }
    });
    await page.goto(`http://127.0.0.1:5365/Electrical-Game/?mansion=${mansion ? 'preview' : 'basic'}`);
    await page.locator('#start-button').click({ timeout: 120000 });
    await page.waitForFunction(() => window.__wireTheHouse?.started, null, { timeout: 120000 });
    const first = await page.evaluate(() => {
      const sun = window.__wireTheHouse.renderer.scene.getObjectByName('Cyprus afternoon sun');
      return { target: sun.target.position.toArray(), left: sun.shadow.camera.left, far: sun.shadow.camera.far };
    });
    await page.evaluate(() => {
      const game = window.__wireTheHouse;
      game.player.camera.position.set(10.2, 1.65, 13.8);
      game.player.velocity.set(0, 0, 0);
    });
    if (mansion) {
      await page.waitForFunction(() => {
        const sun = window.__wireTheHouse.renderer.scene.getObjectByName('Cyprus afternoon sun');
        return sun.target.position.x > 5 && sun.target.position.z > 10;
      }, null, { timeout: 10000 });
    } else await page.waitForTimeout(250);
    const second = await page.evaluate(() => {
      const sun = window.__wireTheHouse.renderer.scene.getObjectByName('Cyprus afternoon sun');
      return { target: sun.target.position.toArray(), left: sun.shadow.camera.left, far: sun.shadow.camera.far, camera: window.__wireTheHouse.player.camera.position.toArray(), viewCamera: window.__wireTheHouse.renderer.viewCamera?.position.toArray() ?? null, renderError: window.__wireTheHouse.renderer.renderError };
    });
    assert.deepEqual(errors, []);
    assert.equal(second.renderError, '');
    if (mansion) {
      assert.equal(second.left, -8);
      assert.equal(second.far, 28);
      assert(second.target[0] > first.target[0] + 5 && second.target[2] > first.target[2] + 5, `mansion shadow camera did not follow the view: ${JSON.stringify({ first, second })}`);
    } else {
      assert.equal(second.left, -5);
      assert.equal(second.far, 18);
      assert.deepEqual(second.target, first.target, 'original workroom sun moved');
    }
    report.push({ mansion, first, second, errors });
    await page.close();
  }
} finally { await browser.close(); }
console.log(JSON.stringify(report));
