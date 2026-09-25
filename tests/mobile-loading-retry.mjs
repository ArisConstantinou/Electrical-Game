import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

const dist = resolve('dist');
const origin = 'http://127.0.0.1:5365/Electrical-Game/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
try {
  for (const failLimit of [1, 2]) {
    const context = await browser.newContext({
      viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3,
    });
    let failedLoads = 0;
    const pageErrors = [];
    await context.route(`${origin}**`, async route => {
      const relative = decodeURIComponent(new URL(route.request().url()).pathname.slice('/Electrical-Game/'.length)) || 'index.html';
      const file = resolve(dist, relative);
      assert(file.startsWith(dist + sep), 'Request escaped the production build');
      if (relative === 'assets/worker/worker-apprentice-lod.glb' && failedLoads < failLimit) {
        failedLoads++;
        return route.abort('failed');
      }
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary', '.json': 'application/json', '.wasm': 'application/wasm' };
      await route.fulfill({ status: 200, contentType: mime[extname(file)] ?? 'application/octet-stream', body: await readFile(file) });
    });
    const page = await context.newPage();
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    const expected = failLimit === 1 ? 'READY' : 'RETRY LOADING';
    await page.waitForFunction(label => document.querySelector('#start-button-label')?.textContent === label, expected, { timeout: 45000 });
    const state = await page.evaluate(() => ({
      label: document.querySelector('#start-button-label')?.textContent,
      progress: document.querySelector('#start-load-percent')?.textContent,
      disabled: document.querySelector('#start-button')?.disabled,
      gameReady: Boolean(window.__wireTheHouse?.isReadyForStart),
    }));
    assert.equal(failedLoads, failLimit);
    assert.equal(state.label, expected);
    assert.equal(state.disabled, false);
    assert.equal(state.gameReady, failLimit === 1);
    assert.equal(state.progress, failLimit === 1 ? 'READY' : 'LOAD FAILED');
    assert.deepEqual(pageErrors, []);
    results.push({ failedLoads, state });
    if (failLimit === 2) {
      await Promise.all([page.waitForEvent('load'), page.locator('#start-button').click()]);
      assert.equal(await page.locator('#start-screen').isVisible(), true, 'Retry must not start an unprepared game');
    }
    await context.close();
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify(results));
