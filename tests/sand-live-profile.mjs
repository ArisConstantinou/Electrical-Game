import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5365/Electrical-Game/?renderer=webgl';
const out = process.argv[3] ?? 'output/sand-live-profile';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { url, device: '390x844 DPR3 Chrome mobile emulation on Windows host', errors: [], idle: null, shoveling: null };
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  await blockPointerLock(context);
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(url);
  await page.locator('#apprentice-count').selectOption('0');
  await page.locator('#start-button').tap({ timeout: 120000 });
  await page.evaluate(() => {
    const game = window.__wireTheHouse, sand = game.mixing.models.sand, camera = game.renderer.camera;
    game.mixing.setActive(true);
    game.mixing.chooseTool('shovel');
    const centre = sand.getWorldPosition(camera.position.clone());
    camera.position.set(centre.x, game.player.eyeHeight, centre.z - 1.17);
    camera.lookAt(centre.x - .25, .30, centre.z);
    game.player.yaw = camera.rotation.y;
    game.player.pitch = camera.rotation.x;
    const profile = window.__sandLiveProfile = { phase: 'idle', times: { idle: [], shoveling: [] }, draws: { idle: [], shoveling: [] }, updateMs: { idle: [], shoveling: [] }, activeGrains: 0 };
    const originalRender = game.renderer.gpu.render.bind(game.renderer.gpu);
    game.renderer.gpu.render = (scene, view) => {
      const result = originalRender(scene, view);
      if (scene === game.renderer.scene && !game.renderer.gpu.getRenderTarget()) {
        profile.times[profile.phase]?.push(performance.now());
        profile.draws[profile.phase]?.push(game.renderer.webgl.info.render.calls);
      }
      return result;
    };
    const originalUpdate = sand.update.bind(sand);
    sand.update = dt => {
      const start = performance.now();
      originalUpdate(dt);
      profile.updateMs[profile.phase]?.push(performance.now() - start);
      profile.activeGrains = Math.max(profile.activeGrains, sand.telemetry.activeGrains);
    };
  });
  await page.waitForTimeout(1600);
  const started = await page.evaluate(() => {
    window.__sandLiveProfile.phase = 'shoveling';
    return window.__wireTheHouse.mixing.handleInteractionRequest(true, true);
  });
  assert.equal(started, true, 'The live player must start a real shovel action');
  await page.waitForTimeout(3300);
  await page.screenshot({ path: `${out}/mobile-portrait-after.png` });
  Object.assign(report, await page.evaluate(() => {
    const profile = window.__sandLiveProfile, game = window.__wireTheHouse;
    profile.phase = null;
    const summary = phase => {
      const times = profile.times[phase];
      const intervals = times.slice(1).map((time, i) => time - times[i]).sort((a, b) => a - b);
      const updates = profile.updateMs[phase];
      return { frames: times.length, fps: times.length * 1000 / (times.at(-1) - times[0]),
        p95Ms: intervals[Math.floor(intervals.length * .95)], maxMs: intervals.at(-1),
        drawCalls: profile.draws[phase].reduce((sum, value) => sum + value, 0) / profile.draws[phase].length,
        sandUpdateMeanMs: updates.reduce((sum, value) => sum + value, 0) / updates.length,
        sandUpdateWorstMs: Math.max(...updates) };
    };
    return { idle: summary('idle'), shoveling: summary('shoveling'),
      sandRemainingKg: game.mixing.batch.sandRemainingKg,
      surfaceKg: game.mixing.models.sand.telemetry.surfaceKg,
      activeGrainsPeak: profile.activeGrains,
      renderError: game.renderer.renderError };
  }));
  assert(report.idle.frames > 30 && report.shoveling.frames > 90);
  assert(Math.abs(report.sandRemainingKg - 597.76) < .01 && Math.abs(report.surfaceKg - report.sandRemainingKg) < .04);
  assert(report.activeGrainsPeak > 0 && report.renderError === '');
  assert.deepEqual(report.errors, []);
  await context.close();
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report));
