import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { blockPointerLock } from './browser-safety.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:5365/Electrical-Game/';
const out = process.argv[3] ?? 'output/production-startup';
const localBuild = base.startsWith('http://127.0.0.1:5365/');
const dist = resolve('dist');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { base, delivery: localBuild ? 'Unmodified dist files through browser routing on the existing local origin; no second server' : 'Published HTTPS assets; no routing', checks: [], errors: [] };
try {
  for (const fallback of [false, true]) {
    const context = await browser.newContext({ viewport: fallback ? { width: 390, height: 844 } : { width: 1366, height: 768 }, isMobile: fallback, hasTouch: fallback });
    await blockPointerLock(context);
    if (localBuild) await context.route('http://127.0.0.1:5365/Electrical-Game/**', async route => {
      const relative = decodeURIComponent(new URL(route.request().url()).pathname.slice('/Electrical-Game/'.length)) || 'index.html';
      const file = resolve(dist, relative);
      assert(file.startsWith(dist + sep), 'Build request outside dist');
      const contentType = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream';
      await route.fulfill({ status: 200, contentType, body: await readFile(file) });
    });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
    await page.goto(base + (fallback ? '?renderer=webgl' : ''), { waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(window.__wireTheHouse), undefined, { timeout: 30000 });
    await page.locator('#start-button')[fallback ? 'tap' : 'click']();
    await page.keyboard.press('Digit4');
    await page.evaluate(() => {
      const g = window.__wireTheHouse, c = g.renderer.camera;
      c.position.set(.7, g.player.eyeHeight, -1.59); c.lookAt(.7, 1.3, -2.41);
      g.player.yaw = c.rotation.y; g.player.pitch = c.rotation.x; g.step(0);
    });
    const brakeSteps=await page.evaluate(()=>Math.round(window.__wireTheHouse.hammerSpeed/.25));
    for (let i = 0; i < brakeSteps; i++) await page.keyboard.press('Minus');
    await page.keyboard.down('KeyE'); await page.evaluate(() => window.advanceTime(600)); await page.keyboard.up('KeyE');
    assert.equal(await page.evaluate(() => window.__wireTheHouse.room.brickWall.impactCount), 0, 'Production brake did not stop impacts');
    await page.keyboard.press('Equal');
    await page.keyboard.down('KeyE'); await page.evaluate(() => window.advanceTime(1200)); await page.keyboard.up('KeyE');
    await page.keyboard.press('Digit8');
    await page.evaluate(() => {
      const g = window.__wireTheHouse, c = g.renderer.camera;
      c.lookAt(.7, 0, .5); g.player.yaw = c.rotation.y; g.player.pitch = c.rotation.x; g.step(0);
    });
    await page.keyboard.down('KeyE'); await page.evaluate(() => window.advanceTime(650)); await page.keyboard.up('KeyE');
    await page.evaluate(async () => { const g = window.__wireTheHouse; window.advanceTime(3000); await g.room.brickWall.waitForGeometry(); await g.renderer.waitForFrame(); g.renderer.render(); await g.renderer.waitForFrame(); });
    const state = await page.evaluate(() => ({ ...JSON.parse(window.render_game_to_text()), renderError: window.__wireTheHouse.renderer.renderError }));
    assert.equal(state.water.active, true); assert.equal(state.water.backend, fallback ? 'webgl' : 'webgpu');
    assert(state.workSurface.impactCount > 0, 'Compiled hammer produced no impacts');
    assert(state.water.floorLitres > .01, 'Compiled hose water did not reach floor');
    assert.equal(state.renderError, ''); assert.deepEqual(report.errors, []);
    report.checks.push({ backend: state.water.backend, viewport: page.viewportSize(), impacts: state.workSurface.impactCount, water: state.water, renderError: state.renderError });
    await page.screenshot({ path: `${out}/${fallback ? 'webgl-mobile' : 'webgpu-desktop'}.png` });
    await page.keyboard.press('Digit7');
    await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera;c.position.set(0,1.65,-1.25);c.lookAt(0,.55,2.2);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;});
    await page.waitForTimeout(300);
    const equipment=await page.evaluate(async()=>{const g=window.__wireTheHouse,m=g.mixing;m.drum.toggle();const before=m.drum.telemetry.angle;await window.advanceTime(250);await g.renderer.waitForFrame();g.renderer.render();await g.renderer.waitForFrame();return{barrow:m.telemetry.wheelbarrow,drum:m.drum.telemetry,rotated:m.drum.telemetry.angle!==before,loaded:g.fpsRig.tools.get('trowel').getObjectByName('trowel-load').visible,renderError:g.renderer.renderError};});
    assert.equal(equipment.barrow.massKg,114);assert.equal(equipment.loaded,true);assert(equipment.rotated);assert.equal(equipment.renderError,'');assert.deepEqual(report.errors,[]);
    report.checks.at(-1).equipment=equipment;
    await page.screenshot({path:`${out}/${fallback?'webgl-mobile':'webgpu-desktop'}-equipment.png`});
    await context.close();
  }
} finally { await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); await browser.close(); }
console.log(JSON.stringify(report, null, 2));
