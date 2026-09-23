import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const roots = [
  ['before', path.resolve(process.env.QA_BASE_DIST_ROOT ?? '../../site-pro-visual-integration/Electrical-Game/dist')],
  ['after', path.resolve('dist')],
];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
try {
  for (const [label, root] of roots) for (const device of [
    { name: 'desktop', width: 1365, height: 768, touch: false },
    { name: 'portrait-emulation', width: 390, height: 844, touch: true },
  ]) {
    const context = await browser.newContext({
      viewport: { width: device.width, height: device.height }, deviceScaleFactor: 1,
      isMobile: device.touch, hasTouch: device.touch,
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://127.0.0.1:5365/Electrical-Game/**', async route => {
      const relative = decodeURIComponent(new URL(route.request().url()).pathname).slice('/Electrical-Game/'.length) || 'index.html';
      const file = path.resolve(root, relative);
      if (!file.startsWith(root + path.sep)) return route.abort();
      try {
        const extension = path.extname(file).toLowerCase();
        await route.fulfill({ status: 200, body: await readFile(file), contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary' })[extension] || 'application/octet-stream' });
      } catch { await route.fulfill({ status: 404, body: `Missing: ${relative}` }); }
    });
    await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=basic&renderer=webgl');
    if (device.touch) await page.locator('#start-button').tap({ timeout: 120000 });
    else await page.locator('#start-button').click({ timeout: 120000 });
    await page.waitForFunction(() => window.__wireTheHouse?.started, null, { timeout: 120000 });
    const sample = await page.evaluate(async () => {
      const game = window.__wireTheHouse;
      game.input.locked = false;
      game.step(0); game.step = () => {};
      game.player.camera.position.set(0, 1.65, -1.55);
      game.player.yaw = game.player.pitch = 0;
      game.player.camera.rotation.set(0, 0, 0, 'YXZ');
      game.fpsRig.visible = false;
      await game.renderer.render(); await game.renderer.waitForFrame();
      const intervals = [], submits = [];
      let previous = performance.now();
      for (let i = 0; i < 110; i++) {
        await new Promise(requestAnimationFrame);
        const current = performance.now();
        if (i >= 20) intervals.push(current - previous);
        previous = current;
        const start = performance.now();
        await game.renderer.render(); await game.renderer.waitForFrame();
        if (i >= 20) submits.push(performance.now() - start);
      }
      const stats = values => {
        values.sort((a, b) => a - b);
        return { median: values[Math.floor(values.length * .5)], p95: values[Math.floor(values.length * .95)], max: values.at(-1) };
      };
      return { frameMs: stats(intervals), submitMs: stats(submits),
        calls: game.renderer.webgl.info.render.calls, triangles: game.renderer.webgl.info.render.triangles,
        geometries: game.renderer.webgl.info.memory.geometries, textures: game.renderer.webgl.info.memory.textures,
        renderError: game.renderer.renderError };
    });
    if (errors.length || sample.renderError) throw new Error(JSON.stringify({ label, device: device.name, errors, sample }));
    results.push({ label, device: device.name, sample });
    await context.close();
  }
} finally { await browser.close(); }
await writeFile('artifacts/workwall-mortar/profile.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
