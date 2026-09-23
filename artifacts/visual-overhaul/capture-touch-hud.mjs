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
  for (const [name, viewport] of [['portrait', { width: 390, height: 844 }], ['landscape', { width: 844, height: 390 }]]) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
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
    await page.goto('http://127.0.0.1:5365/Electrical-Game/');
    await page.locator('#start-button').click({ timeout: 90000 });
    await page.waitForFunction(() => window.__wireTheHouse?.started && getComputedStyle(document.querySelector('#start-screen')).visibility === 'hidden', null, { timeout: 30000 });
    await page.evaluate(() => {
      const game = window.__wireTheHouse;
      game.player.velocity.set(0, 0, 0);
      const point = game.mission.points.find(item => item.definition.id === 'C');
      const target = point.getWorldPosition(game.player.camera.position.clone());
      game.player.camera.position.set(target.x, game.player.eyeHeight, target.z + .8);
      game.player.yaw = 0;
      game.player.pitch = Math.atan2(target.y - game.player.eyeHeight, .8);
      game.player.camera.rotation.set(game.player.pitch, 0, 0);
      game.selectTool('drill');
    });
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(output, `touch-hud-${variant}-${name}.png`) });
    const layout = await page.evaluate(() => {
      const box = selector => { const element = document.querySelector(selector); if (!element || getComputedStyle(element).display === 'none') return null; const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; };
      return { coarse: matchMedia('(pointer:coarse)').matches, shell: box('#game-shell'), panel: box('#laser-panel'), prompt: box('#interaction-prompt'), controls: ['#site-pro-tools', '#site-pro-coordinator', '#site-pro-use', '#joystick', '#look-joystick', '#mobile-stance-controls'].map(box) };
    });
    await page.evaluate(() => window.__wireTheHouse.selectTool('laser'));
    await page.waitForTimeout(200);
    const laser = await page.evaluate(() => ({
      tool: document.querySelector('#laser-panel')?.dataset.tool,
      title: document.querySelector('#laser-tool-title')?.textContent,
      visible: getComputedStyle(document.querySelector('#laser-panel')).display !== 'none',
      height: document.querySelector('#laser-work-height')?.textContent,
      heightHidden: document.querySelector('#laser-work-height')?.hidden,
      placeHidden: document.querySelector('#laser-place')?.hidden,
    }));
    const laserWithHeight = await page.evaluate(() => {
      window.__wireTheHouse.hud.updateLaser('laser', { phase: 'mount-ready', hint: 'Place at the marked height', heightM: 1.25, progress: .5, active: false, mounted: false });
      return {
        height: document.querySelector('#laser-work-height')?.textContent,
        heightHidden: document.querySelector('#laser-work-height')?.hidden,
        progressHidden: document.querySelector('.laser-progress')?.hidden,
        placeHidden: document.querySelector('#laser-place')?.hidden,
      };
    });
    assert.equal(layout.coarse, true);
    assert.equal(errors.length, 0);
    assert.equal(laser.visible, true);
    assert.equal(laser.placeHidden, false);
    assert.equal(laserWithHeight.height, '1.25 m');
    assert.equal(laserWithHeight.heightHidden, false);
    assert.equal(laserWithHeight.progressHidden, false);
    assert.equal(laserWithHeight.placeHidden, false);
    const overlaps = (a, b) => a && b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    assert(layout.controls.slice(0, 2).every(control => !overlaps(layout.panel, control)));
    report.push({ name, viewport, layout, laser, laserWithHeight, errors });
    await context.close();
  }
} finally { await browser.close(); }
await fs.writeFile(path.join(output, `touch-hud-${variant}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.map(item => ({ name: item.name, coarse: item.layout.coarse, panel: item.layout.panel, prompt: item.layout.prompt, errors: item.errors }))));
