import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await blockPointerLock(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');
  await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 120000 });
  await page.locator('#apprentice-count').selectOption('0');
  await page.locator('#start-button').tap();
  const report = await page.evaluate(async () => {
    const game = window.__wireTheHouse, renderer = game.renderer, gpu = renderer.gpu;
    game.step = () => {};
    await renderer.waitForFrame();
    const original = gpu.render.bind(gpu);
    let captures = [];
    gpu.render = (scene, camera) => {
      const target = gpu.getRenderTarget();
      const before = gpu.info.render.calls;
      const result = original(scene, camera);
      captures.push({ target: target ? `${target.name || target.texture?.name || 'unnamed'}:${target.width}x${target.height}` : 'screen',
        camera: camera.name || camera.type, mainScene: scene === renderer.scene,
        calls: gpu.info.render.calls - before });
      return result;
    };
    const sample = async name => {
      const frames = [];
      for (let index = 0; index < 8; index++) {
        captures = [];
        await new Promise(requestAnimationFrame);
        renderer.render();
        await renderer.waitForFrame();
        frames.push(captures);
      }
      const groups = new Map();
      for (const frame of frames) for (const pass of frame) {
        const key = `${pass.target}|${pass.camera}|${pass.mainScene}`;
        const item = groups.get(key) ?? { target: pass.target, camera: pass.camera,
          mainScene: pass.mainScene, totalCalls: 0, passes: 0 };
        item.totalCalls += pass.calls; item.passes++;
        groups.set(key, item);
      }
      return { name, frames: frames.length, totalCallsPerFrame: frames.map(frame => frame.reduce((sum, pass) => sum + pass.calls, 0)),
        passes: [...groups.values()].sort((a, b) => b.totalCalls - a.totalCalls) };
    };
    try {
      const dry = await sample('dry');
      game.roomWater.addFloorWater(0, 0, 12);
      for (let index = 0; index < 30; index++) game.roomWater.update(1 / 30);
      game.roomWater.rebuildGeometry();
      if (!game.roomWater.waterProActive && game.activateWaterPro) await game.activateWaterPro();
      // Attaching Water Pro performs one transition update before the steady
      // off-screen policy can be measured.
      renderer.render();
      await renderer.waitForFrame();
      const wet = await sample('wet-offscreen');
      const originalWaterInView = renderer.waterInView.bind(renderer);
      renderer.waterInView = () => true;
      const forced = await sample('wet-forced-old-policy');
      renderer.waterInView = originalWaterInView;
      const target = game.roomWater.wetBounds.getCenter(game.renderer.camera.position.clone());
      game.renderer.camera.lookAt(target);
      renderer.eyePitch = 0; renderer.eyeYaw = 0;
      renderer.snapshotRenderCamera();
      const wetInView = renderer.waterInView(game.roomWater);
      const visible = await sample('wet-visible');
      return { dry, wet, forced, visible, wetInView, waterVisible: game.roomWater.surface.visible,
        waterProActive: game.roomWater.waterProActive,
        waterLitres: game.roomWater.field.volumeLitres, error: renderer.renderError };
    } finally { gpu.render = original; }
  });
  assert.equal(report.error, '');
  assert(report.waterProActive, 'Water Pro must be active before attributing its optical passes');
  assert(report.waterVisible && report.waterLitres > 0);
  assert(report.wetInView, 'Wet bounds must allow optical updates when the camera faces the puddle');
  const count256 = stage => stage.passes.filter(item => item.target.includes('256x256')).reduce((sum, item) => sum + item.passes, 0) / stage.frames;
  assert.equal(count256(report.wet), 0, 'Off-screen water must skip FFT passes');
  assert(count256(report.forced) > 0 && count256(report.visible) > 0,
    'Old always-update policy and visible water must retain FFT passes');
  assert.deepEqual(errors, []);
  const result = { method: 'Windows Chrome mobile 390x844 DPR3 WebGL, paused gameplay, eight dry and eight 12L wet frames. Counts are renderer invocations, not physical-device FPS.',
    ...report, errors };
  await mkdir('artifacts/site-pro-04/review/performance', { recursive: true });
  await page.screenshot({ path: 'artifacts/site-pro-04/review/performance/water-visible-after-cull.jpg', type: 'jpeg', quality: 82 });
  await writeFile('artifacts/site-pro-04/review/performance/water-pass-attribution.json', `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ pass: true, dryPassesPerFrame: result.dry.passes.reduce((sum, item) => sum + item.passes, 0) / result.dry.frames,
    wetPassesPerFrame: result.wet.passes.reduce((sum, item) => sum + item.passes, 0) / result.wet.frames,
    offscreen256PassesPerFrame: count256(result.wet), forced256PassesPerFrame: count256(result.forced),
    visible256PassesPerFrame: count256(result.visible) }));
  await context.close();
} finally { await browser.close(); }
