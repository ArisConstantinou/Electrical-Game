import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

const base = 'https://arisconstantinou.github.io/Electrical-Game/';
const dist = resolve('dist');
const out = 'output/mobile-mixing-rail';
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.webp':'image/webp', '.png':'image/png', '.jpg':'image/jpeg', '.glb':'model/gltf-binary', '.woff2':'font/woff2' };
const browser = await chromium.launch({ channel:'chrome', headless:true });
await mkdir(out, { recursive:true });
try {
  for (const viewport of [{ width:390, height:844 }, { width:844, height:390 }]) {
    const context = await browser.newContext({ viewport, isMobile:true, hasTouch:true, deviceScaleFactor:2 });
    await blockPointerLock(context);
    if (!process.argv.includes('--public')) await context.route(`${base}**`, async route => {
      const path = resolve(dist, decodeURIComponent(new URL(route.request().url()).pathname.slice('/Electrical-Game/'.length)) || 'index.html');
      if (!path.startsWith(dist)) return route.abort();
      try { if (!(await stat(path)).isFile()) return route.abort(); await route.fulfill({ status:200, contentType:mime[extname(path)] ?? 'application/octet-stream', body:await readFile(path) }); }
      catch { return route.abort(); }
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}?renderer=webgl`, { waitUntil:'domcontentloaded' });
    await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout:120000 });
    await page.locator('#apprentice-count').selectOption('0');
    await page.locator('#start-button').tap();
    await page.evaluate(() => {
      const g = window.__wireTheHouse, m = g.mixing, c = g.renderer.camera;
      window.__mixingRailStep = g.step.bind(g); g.step = () => {};
      const p = m.models.group.getWorldPosition(c.position.clone());
      c.position.set(p.x, g.player.eyeHeight, p.z - .9);
      c.lookAt(p.x, 1, p.z);
      g.player.yaw = c.rotation.y; g.player.pitch = c.rotation.x;
      for (let i=0;i<3;i++) window.__mixingRailStep(1/60);
    });
    await page.waitForFunction(() => document.querySelector('#game-shell').classList.contains('mixing-stage'));
    const name = `${viewport.width}x${viewport.height}`;
    await page.screenshot({ path:`${out}/${name}-${process.argv.includes('--public')?'before':'after'}.png` });
    const bounds = await page.evaluate(() => {
      const rect = id => document.querySelector(id).getBoundingClientRect().toJSON();
      const shell = document.querySelector('#game-shell');
      return { belt:rect('#mixing-toolbelt'), rail:rect('#mobile-top-rail'), move:rect('#joystick'), look:rect('#look-joystick'),
        open:shell.dataset.toolsOpen, visible:document.querySelector('#mixing-toolbelt').checkVisibility() };
    });
    assert.equal(bounds.open, 'true', `${name}: mixing tools should open the shared top rail on first approach`);
    assert(bounds.visible, `${name}: mixing tools are unavailable`);
    assert(bounds.belt.bottom <= bounds.move.top && bounds.belt.bottom <= bounds.look.top,
      `${name}: mixing controls cover the joysticks: ${JSON.stringify(bounds)}`);
    assert(Math.abs(bounds.belt.top-bounds.rail.top) < 8, `${name}: mixing tools are detached from the top rail`);
    await page.locator('[data-mix-equip="mixer"]').tap();
    await page.evaluate(() => window.__mixingRailStep(1/60));
    assert.equal(await page.evaluate(() => window.__wireTheHouse.mixing.tool), 'mixer', `${name}: mixer button is not usable`);
    assert.match(await page.locator('[data-mix-equip="mixer"]').getAttribute('aria-label'), /Άφησε/);
    await page.locator('#mixing-put-down').tap();
    await page.evaluate(() => window.__mixingRailStep(1/60));
    assert.equal(await page.evaluate(() => window.__wireTheHouse.mixing.tool), 'hands', `${name}: put-down button is not usable`);
    await page.locator('#worker-bar-handle').tap();
    assert.equal(await page.locator('#game-shell').getAttribute('data-tools-open'), 'false');
    assert.equal(await page.locator('#mixing-toolbelt').isVisible(), false, `${name}: collapsed rail still shows mixing tools`);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(JSON.stringify({ passed:true, viewports:['390x844','844x390'] }));
} finally { await browser.close(); }
