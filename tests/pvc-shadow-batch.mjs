import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  await blockPointerLock(context);
  if (process.argv.includes('--dist')) {
    const root = resolve('dist'), mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2' };
    await context.route('https://arisconstantinou.github.io/Electrical-Game/**', async route => {
      const file = resolve(root, decodeURIComponent(new URL(route.request().url()).pathname.slice('/Electrical-Game/'.length)) || 'index.html');
      if (!file.startsWith(`${root}\\`) && file !== root) return route.abort();
      try { if (!(await stat(file)).isFile()) return route.abort(); await route.fulfill({ status: 200, contentType: mime[extname(file)] ?? 'application/octet-stream', body: await readFile(file) }); }
      catch { await route.abort(); }
    });
  }
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.argv.includes('--dist') ? 'https://arisconstantinou.github.io/Electrical-Game/?renderer=webgl' : 'http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');
  await page.locator('#apprentice-count').selectOption('0');
  await page.locator('#start-button').tap({ timeout: 120000 });
  const result = await page.evaluate(() => {
    const game = window.__wireTheHouse, stock = game.pvc.stock;
    const bounding = (objects) => {
      const bounds = new stock.bundleBox.constructor();
      for (const object of objects) bounds.expandByObject(object);
      return bounds;
    };
    const check = () => stock.pipes.map(group => {
      group.updateWorldMatrix(true, true);
      const source = group.children.filter(object => object.castShadow === false && object.name !== 'Permanent marker ring');
      const caster = group.children.find(object => object.name.endsWith('static shadow batch'));
      const a = bounding(source), b = bounding([caster]);
      return { source: source.length, caster: Boolean(caster), visible: group.visible,
        boundsError: Math.max(a.min.distanceTo(b.min), a.max.distanceTo(b.max)),
        casterLayer: caster?.layers.mask, sourceRaycast: source.every(object => typeof object.raycast === 'function') };
    });
    const bundled = check();
    stock.layout(1);
    const spread = check();
    stock.position.x += 1;
    const moved = check();
    stock.setBundleRemaining(0, 12);
    const depleted = check();
    return { bundled, spread, moved, depleted, visibleCount: stock.pipes.filter(group => group.visible).length };
  });
  for (const phase of ['bundled', 'spread', 'moved', 'depleted']) for (const pipe of result[phase]) {
    assert.equal(pipe.source, 3, `${phase}: body and two open ends stay individually pickable`);
    assert.equal(pipe.caster, true, `${phase}: one batched caster per PVC length`);
    assert(pipe.boundsError < 1e-4, `${phase}: caster must follow its visible pipe geometry`);
    assert.equal(pipe.casterLayer, 2, `${phase}: shadow-only layer`);
    assert.equal(pipe.sourceRaycast, true);
  }
  assert.equal(result.visibleCount, 12, 'Depleted bundle hides its spent pipe groups');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ phases: 4, pipeCount: result.bundled.length, visibleAfterDepletion: result.visibleCount, errors }));
  await context.close();
} finally { await browser.close(); }
