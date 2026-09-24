import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const isolatedRoot = process.env.QA_DIST_ROOT ? path.resolve(process.env.QA_DIST_ROOT) : null;
const output = process.argv[2] ?? 'output/front-wall-surface-profile.json';
await mkdir(path.dirname(output), { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { environment: 'Windows Chrome WebGL, 390x844 DPR3 touch emulation, front work wall',
  source: isolatedRoot ?? 'live 5365', samples: [], errors: [] };
try {
  for (let run = 0; run < 2; run++) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await blockPointerLock(context);
    const page = await context.newPage();
    if (isolatedRoot) await page.route('http://127.0.0.1:5365/Electrical-Game/**', async route => {
      const relative = decodeURIComponent(new URL(route.request().url()).pathname).slice('/Electrical-Game/'.length) || 'index.html';
      const file = path.resolve(isolatedRoot, relative);
      if (!file.startsWith(isolatedRoot + path.sep)) return route.abort();
      try {
        const extension = path.extname(file).toLowerCase();
        await route.fulfill({ status: 200, body: await readFile(file), contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml' })[extension] || 'application/octet-stream' });
      } catch { await route.fulfill({ status: 404, body: `Missing isolated asset: ${relative}` }); }
    });
    page.on('pageerror', error => report.errors.push(error.message));
    await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl&mansion=basic');
    await page.waitForFunction(() => window.__wireTheHouse?.renderer.renderCamera, null, { timeout: 120000 });
    await page.locator('#apprentice-count').selectOption('0');
    await page.locator('#start-button').tap();
    await page.waitForFunction(() => window.__wireTheHouse?.started, null, { timeout: 120000 });
    await page.evaluate(() => {
      const game = window.__wireTheHouse;
      game.player.camera.position.set(0, game.player.eyeHeight, -1.85);
      game.player.velocity.set(0, 0, 0);
      game.player.yaw = 0; game.player.pitch = 0;
      game.player.camera.rotation.set(0, 0, 0, 'YXZ');
      const render = game.renderer.gpu.render.bind(game.renderer.gpu);
      window.__wallProfile = { active: false, times: [], draws: [], triangles: [] };
      game.renderer.gpu.render = (world, camera) => {
        const result = render(world, camera), sample = window.__wallProfile;
        if (sample.active && world === game.renderer.scene && !game.renderer.gpu.getRenderTarget()) {
          sample.times.push(performance.now());
          sample.draws.push(game.renderer.webgl.info.render.calls);
          sample.triangles.push(game.renderer.webgl.info.render.triangles);
        }
        return result;
      };
    });
    await page.waitForTimeout(900);
    await page.evaluate(() => { window.__wallProfile.active = true; });
    await page.waitForTimeout(1800);
    const sample = await page.evaluate(() => {
      const p = window.__wallProfile;
      p.active = false;
      const intervals = p.times.slice(1).map((time, index) => time - p.times[index]).sort((a, b) => a - b);
      const mean = list => list.reduce((sum, value) => sum + value, 0) / list.length;
      return { frames: p.times.length, medianMs: intervals[Math.floor(intervals.length / 2)] ?? null,
        p95Ms: intervals[Math.floor(intervals.length * .95)] ?? null, maxMs: intervals.at(-1) ?? null,
        drawCalls: mean(p.draws), triangles: mean(p.triangles),
        renderError: window.__wireTheHouse.renderer.renderError };
    });
    assert(sample.frames > 35 && !sample.renderError, JSON.stringify(sample));
    report.samples.push(sample);
    await context.close();
  }
  assert.deepEqual(report.errors, []);
} finally {
  await browser.close();
  await writeFile(output, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
