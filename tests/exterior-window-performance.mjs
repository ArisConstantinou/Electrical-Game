import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { blockPointerLock } from './browser-safety.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5365/Electrical-Game/?renderer=webgl';
const out = 'output/exterior-window-performance';
await mkdir(out, { recursive: true });
const report = { url, device: '390x844 DPR3 Chromium mobile emulation, WebGL', cases: [], errors: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await blockPointerLock(context);
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__wireTheHouse?.room?.exterior, undefined, { timeout: 120000 });
  await page.selectOption('#apprentice-count', '0');
  await page.locator('#start-button').tap();
  await page.locator('#start-screen').waitFor({ state: 'hidden' });
  await page.evaluate(() => {
    const game = window.__wireTheHouse;
    const original = game.renderer.gpu.render.bind(game.renderer.gpu);
    window.__windowProfile = { active: false, times: [], draws: [], triangles: [] };
    game.renderer.gpu.render = (scene, camera) => {
      const result = original(scene, camera), profile = window.__windowProfile;
      if (profile.active && scene === game.renderer.scene && !game.renderer.gpu.getRenderTarget()) {
        profile.times.push(performance.now());
        profile.draws.push(game.renderer.webgl.info.render.calls);
        profile.triangles.push(game.renderer.webgl.info.render.triangles);
      }
      return result;
    };
  });
  for (const pose of [
    { name: 'exterior-opening', x: -1.45, z: 2, yaw: Math.PI / 2, pitch: -.04 },
    { name: 'interior-masonry', x: 0, z: -.35, yaw: 0, pitch: -.04 },
  ]) {
    await page.evaluate(({ x, z, yaw, pitch }) => {
      const game = window.__wireTheHouse, camera = game.renderer.camera;
      camera.position.set(x, game.player.eyeHeight, z);
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
      game.player.yaw = yaw; game.player.pitch = pitch;
      window.__windowProfile.active = false;
      window.__windowProfile.times = []; window.__windowProfile.draws = []; window.__windowProfile.triangles = [];
    }, pose);
    await page.waitForTimeout(300);
    await page.evaluate(() => { window.__windowProfile.active = true; });
    await page.waitForTimeout(2400);
    const sample = await page.evaluate(() => {
      const profile = window.__windowProfile, game = window.__wireTheHouse;
      profile.active = false;
      const intervals = profile.times.slice(1).map((time, index) => time - profile.times[index]).sort((a, b) => a - b);
      return { frames: profile.times.length, p95Ms: intervals[Math.floor(intervals.length * .95)] ?? null,
        drawCalls: profile.draws.reduce((sum, value) => sum + value, 0) / profile.draws.length,
        triangles: profile.triangles.reduce((sum, value) => sum + value, 0) / profile.triangles.length,
        renderError: game.renderer.renderError };
    });
    assert(sample.frames > 35 && sample.p95Ms < 40 && sample.drawCalls < 700 && !sample.renderError, `${pose.name}: ${JSON.stringify(sample)}`);
    report.cases.push({ name: pose.name, ...sample });
  }
  assert.deepEqual(report.errors, []);
  await context.close();
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report));
