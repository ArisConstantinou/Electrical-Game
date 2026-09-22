import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const selected = process.argv.includes('--focus') ? new Set(['released-room', 'preview-same-room-pose', 'preview-new-foyer', 'preview-third-floor-terrace']) : null;
const out = selected ? 'output/mansion-performance-focus.json' : 'artifacts/site-pro-04/performance/mansion-ground-preview.json';
await mkdir('artifacts/site-pro-04/performance', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { environment: '390x844 DPR3 Chrome WebGL mobile emulation on Windows host; not physical phone', cases: [], errors: [] };
try {
  for (const scene of [
    { name: 'released-room', suffix: '', x: .45, z: 2.7, yaw: Math.PI },
    { name: 'preview-same-room-pose', suffix: '&mansion=preview', x: .45, z: 2.7, yaw: Math.PI },
    { name: 'preview-new-foyer', suffix: '&mansion=preview', x: 3.1, z: 9.4, yaw: -Math.PI / 2 },
    { name: 'preview-stair-flight', suffix: '&mansion=preview', x: 5.5, z: 9.4, floorY: .9, yaw: Math.PI },
    { name: 'preview-first-floor-room', suffix: '&mansion=preview', x: 7.5, z: 3.7, floorY: 3.3, yaw: 0 },
    { name: 'preview-courtyard', suffix: '&mansion=preview', x: 10.2, z: 13.8, yaw: -.9 },
    { name: 'preview-upper-stair', suffix: '&mansion=preview', x: 5.5, z: 9.4, floorY: 4.2, yaw: Math.PI },
    { name: 'preview-second-floor-room', suffix: '&mansion=preview', x: 7.5, z: 3.7, floorY: 6.6, yaw: 0 },
    { name: 'preview-third-floor-terrace', suffix: '&mansion=preview', x: 11.423, z: 2.687, floorY: 9.9, yaw: -Math.PI / 2 },
    { name: 'preview-fourth-floor-room', suffix: '&mansion=preview', x: 7.5, z: 3.7, floorY: 13.2, yaw: 0 },
  ].filter(scene => !selected || selected.has(scene.name))) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await blockPointerLock(context);
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(`${scene.name}: ${error.message}`));
    await page.goto(`http://127.0.0.1:5365/Electrical-Game/?renderer=webgl${scene.suffix}`);
    await page.locator('#start-button').waitFor({ state: 'visible', timeout: 120000 });
    await page.locator('#apprentice-count').selectOption('0');
    await page.locator('#start-button').tap();
    await page.waitForFunction(() => window.__wireTheHouse?.started, null, { timeout: 120000 });
    await page.evaluate(pose => {
      const game = window.__wireTheHouse;
      game.player.camera.position.set(pose.x, game.player.eyeHeight + (pose.floorY ?? 0), pose.z);
      game.player.yaw = pose.yaw; game.player.pitch = -.04;
      game.player.camera.rotation.set(-.04, pose.yaw, 0, 'YXZ');
      const render = game.renderer.gpu.render.bind(game.renderer.gpu);
      window.__mansionProfile = { active: false, times: [], draws: [], triangles: [] };
      game.renderer.gpu.render = (world, camera) => {
        const result = render(world, camera), profile = window.__mansionProfile;
        if (profile.active && world === game.renderer.scene && !game.renderer.gpu.getRenderTarget()) {
          profile.times.push(performance.now());
          profile.draws.push(game.renderer.webgl.info.render.calls);
          profile.triangles.push(game.renderer.webgl.info.render.triangles);
        }
        return result;
      };
    }, scene);
    await page.waitForTimeout(500);
    await page.evaluate(() => { window.__mansionProfile.active = true; });
    await page.waitForTimeout(2200);
    const sample = await page.evaluate(() => {
      const p = window.__mansionProfile;
      p.active = false;
      const intervals = p.times.slice(1).map((time, index) => time - p.times[index]).sort((a, b) => a - b);
      const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
      return { frames: p.times.length, p95Ms: intervals[Math.floor(intervals.length * .95)] ?? null,
        maxMs: intervals.at(-1) ?? null, meanDrawCalls: mean(p.draws),
        minDrawCalls: Math.min(...p.draws), maxDrawCalls: Math.max(...p.draws), meanTriangles: mean(p.triangles),
        mansionWing: Boolean(window.__wireTheHouse.room.mansionWing),
        renderError: window.__wireTheHouse.renderer.renderError };
    });
    assert(sample.frames > 35 && !sample.renderError, `${scene.name}: ${JSON.stringify(sample)}`);
    report.cases.push({ name: scene.name, ...sample });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
} finally {
  await browser.close();
  await writeFile(out, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
