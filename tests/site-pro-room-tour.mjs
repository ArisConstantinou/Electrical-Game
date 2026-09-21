import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5365/Electrical-Game/';
const output = process.argv[3] ?? 'output/site-pro-room-tour';
const only = process.argv.find(value => value.startsWith('--only='))?.slice('--only='.length);
const devices = [
  { name: 'mobile-portrait', width: 390, height: 844, touch: true },
  { name: 'desktop', width: 1366, height: 768, touch: false },
].filter(device => !only || device.name === only);
const views = [
  { name: 'rear-room', x: 0, z: -.25, yaw: Math.PI, pitch: -.06 },
  { name: 'supplies', x: 0, z: -.35, yaw: -2.28, pitch: -.39 },
  { name: 'left-room', x: 0, z: -.35, yaw: 2.28, pitch: -.16 },
];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { url, cases: [], errors: [] };
try {
  for (const device of devices) {
    const context = await browser.newContext({ viewport: { width: device.width, height: device.height }, deviceScaleFactor: 1, isMobile: device.touch, hasTouch: device.touch });
    await blockPointerLock(context);
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => window.__wireTheHouse?.renderer.renderCamera, null, { timeout: 120000 });
    await page.locator('#apprentice-count').selectOption('0');
    if (device.touch) await page.locator('#start-button').tap();
    else await page.locator('#start-button').click();
    await page.waitForFunction(() => window.__wireTheHouse.started && document.querySelector('#start-screen')?.classList.contains('hidden'));
    await page.waitForTimeout(800);
    for (const view of views) {
      const state = await page.evaluate(async pose => {
        const game = window.__wireTheHouse;
        game.player.camera.position.set(pose.x, game.player.eyeHeight, pose.z);
        game.player.velocity.set(0, 0, 0);
        game.player.yaw = pose.yaw;
        game.player.pitch = pose.pitch;
        game.player.camera.rotation.set(pose.pitch, pose.yaw, 0, 'YXZ');
        await game.renderer.waitForFrame();
        return {
          position: game.renderer.camera.position.toArray(),
          yaw: game.player.yaw,
          pitch: game.player.pitch,
          error: game.renderer.renderError,
        };
      }, view);
      await page.waitForTimeout(250);
      assert.equal(state.error, '', `${device.name}/${view.name}: render error`);
      await page.screenshot({ path: `${output}/${device.name}-${view.name}.png` });
      report.cases.push({ device: device.name, view: view.name, state });
    }
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
