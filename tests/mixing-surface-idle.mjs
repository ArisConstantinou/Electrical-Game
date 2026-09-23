import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

const base = 'https://arisconstantinou.github.io/Electrical-Game/';
const dist = resolve('dist');
const out = 'output/mixing-surface-idle';
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.webp':'image/webp', '.png':'image/png', '.jpg':'image/jpeg', '.glb':'model/gltf-binary', '.woff2':'font/woff2' };
await mkdir(out, { recursive:true });
const browser = await chromium.launch({ channel:'chrome', headless:true });
try {
  const context = await browser.newContext({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true, deviceScaleFactor:3 });
  await blockPointerLock(context);
  if (!process.argv.includes('--public')) await context.route(`${base}**`, async route => {
    const path = resolve(dist, decodeURIComponent(new URL(route.request().url()).pathname.slice('/Electrical-Game/'.length)) || 'index.html');
    if (!path.startsWith(dist)) return route.abort();
    try { if (!(await stat(path)).isFile()) return route.abort(); await route.fulfill({ status:200, contentType:mime[extname(path)] ?? 'application/octet-stream', body:await readFile(path) }); }
    catch { return route.abort(); }
  });
  const page = await context.newPage();
  await page.goto(`${base}?renderer=webgl`, { waitUntil:'domcontentloaded' });
  await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout:120000 });
  await page.locator('#apprentice-count').selectOption('0');
  await page.locator('#start-button').tap();
  const report = await page.evaluate(() => {
    const game = window.__wireTheHouse, mixing = game.mixing;
    game.step = () => {};
    mixing.batch.addWater(5);
    mixing.present();
    const geometry = mixing.models.fill.geometry;
    const original = geometry.computeVertexNormals.bind(geometry);
    let calls = 0;
    geometry.computeVertexNormals = (...args) => { calls++; return original(...args); };
    const sample = count => {
      calls = 0;
      const begin = performance.now();
      for (let i=0;i<count;i++) mixing.present();
      return { calls, msPerCall:(performance.now()-begin)/count, positionVersion:geometry.getAttribute('position').version };
    };
    const idle = sample(80);
    mixing.batch.addWater(1);
    const changed = sample(1);
    mixing.mixingNow = true;
    mixing.elapsed += .1;
    const spinning = sample(3);
    mixing.mixingNow = false;
    const settled = sample(1);
    const still = sample(20);
    geometry.computeVertexNormals = original;
    return { idle, changed, spinning, settled, still, renderError:game.renderer.renderError };
  });
  await writeFile(`${out}/${process.argv.includes('--public')?'public':'candidate'}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  assert.equal(report.renderError, '');
  assert.equal(report.idle.calls, 0, 'unchanged still mortar must not rebuild its mesh each frame');
  assert.equal(report.changed.calls, 1, 'adding water must update the visible surface');
  assert.equal(report.spinning.calls, 3, 'active mixing must animate every frame');
  assert.equal(report.settled.calls, 1, 'stopping the mixer must restore the resting surface');
  assert.equal(report.still.calls, 0, 'the settled surface must remain stable');
  await context.close();
} finally { await browser.close(); }
