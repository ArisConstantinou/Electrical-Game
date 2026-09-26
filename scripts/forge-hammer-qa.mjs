import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blockPointerLock } from '../tests/browser-safety.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'output', 'forge-hammer-qa');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = {};
const serveCandidate = context => context.route('http://127.0.0.1:5365/Electrical-Game/**', async route => {
  const url = new URL(route.request().url());
  const relative = decodeURIComponent(url.pathname.slice('/Electrical-Game/'.length)) || 'index.html';
  const filename = path.resolve(root, 'dist', relative);
  if (!filename.startsWith(path.resolve(root, 'dist') + path.sep)) return route.abort();
  const contentType = filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : filename.endsWith('.html') ? 'text/html' : filename.endsWith('.json') ? 'application/json' : filename.endsWith('.wasm') ? 'application/wasm' : undefined;
  try { await route.fulfill({ status: 200, body: await readFile(filename), contentType }); }
  catch { await route.abort(); }
});
try {
  for (const variant of (process.env.QA_REVERSE === '1' ? ['candidate', 'baseline'] : ['baseline', 'candidate'])) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await blockPointerLock(context);
    if (variant === 'candidate') await serveCandidate(context);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'warning' || message.type() === 'error') errors.push(`${message.type()}: ${message.text()}`); });
    page.on('requestfailed', request => errors.push(`request failed: ${request.url()} ${request.failure()?.errorText}`));
    await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');
    await page.waitForFunction(() => window.__wireTheHouse?.workerBody.loaded, null, { timeout: 120000 });
    await page.locator('#start-button').click();
    await page.keyboard.press('Digit4');
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.__wireTheHouse.renderer.waitForFrame());
    await page.screenshot({ path: path.join(output, `${variant}-game.png`) });
    const game = await page.evaluate(() => {
      const g = window.__wireTheHouse, hammer = g.fpsRig.tools.get('hammer');
      return { drawCalls: g.renderer.webgl.info.render.calls, triangles: g.renderer.webgl.info.render.triangles, grip: hammer.userData.gripPoint, tip: hammer.userData.tipPoint, visualAsset: hammer.userData.visualAsset, loaded: g.workerBody.loaded, renderError: g.renderer.renderError };
    });
    const work = await page.evaluate(async () => {
      const g = window.__wireTheHouse, camera = g.renderer.camera;
      const originalStep = g.step, step = originalStep.bind(g); g.step = () => {};
      camera.position.set(0, 1.65, g.room.brickWall.volume.frontZ + .9);
      g.player.yaw = 0; g.player.pitch = -.18;
      for (let i = 0; i < 120; i++) step(1 / 60);
      const start = g.room.brickWall.impactCount;
      const times = [];
      g.input.actionHeld = true;
      for (let i = 0; i < 180; i++) {
        const before = performance.now(); step(1 / 60); times.push(performance.now() - before);
        if ((i + 1) % 30 === 0) { await g.chasing.waitForDebrisSplits(); await g.renderer.waitForFrame(); }
      }
      g.input.actionHeld = false;
      times.sort((a, b) => a - b);
      g.step = originalStep;
      return { impacts: g.room.brickWall.impactCount - start, contact: g.fpsRig.contactStatus, reachable: g.fpsRig.reachable, hands: g.fpsRig.debugPose().arms.map(a => ({ side: a.side, gripRole: a.gripRole, gripping: a.gripping })), cpuP95Ms: times[Math.floor(times.length * .95)], cpuMaxMs: times.at(-1), removedVolume: g.room.brickWall.volume.removedVolume };
    });
    await page.screenshot({ path: path.join(output, `${variant}-work.png`) });
    await page.evaluate(() => { window.__wireTheHouse.input.actionHeld = true; });
    await page.waitForTimeout(1800);
    await page.screenshot({ path: path.join(output, `${variant}-work-live.png`) });
    const liveWork = await page.evaluate(() => ({ fpsLabel: document.querySelector('#fps-counter')?.textContent, drawCalls: window.__wireTheHouse.renderer.webgl.info.render.calls, triangles: window.__wireTheHouse.renderer.webgl.info.render.triangles }));
    await page.evaluate(() => { window.__wireTheHouse.input.actionHeld = false; });
    const sampleFps = () => page.evaluate(() => new Promise(resolve => {
      const times = [], start = performance.now();
      function frame(now) {
        times.push(now);
        if (now - start < 1800) requestAnimationFrame(frame);
        else {
          const deltas = times.slice(1).map((time, index) => time - times[index]).sort((a, b) => a - b);
          resolve({ fps: (times.length - 1) * 1000 / (times.at(-1) - times[0]), p95Ms: deltas[Math.floor(deltas.length * .95)] });
        }
      }
      requestAnimationFrame(frame);
    }));
    const visibleFps = await sampleFps();
    await page.evaluate(() => { window.__wireTheHouse.fpsRig.tools.get('hammer').visible = false; });
    const hiddenFps = await sampleFps();
    await page.evaluate(() => { window.__wireTheHouse.fpsRig.tools.get('hammer').visible = true; });
    await page.evaluate(() => document.querySelector('#model-inspector-open').click());
    await page.selectOption('#model-tool', 'hammer');
    await page.locator('#model-side').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(output, `${variant}-side.png`) });
    await page.locator('#model-assets').click();
    await page.locator('#model-search').fill('FPS hammer tool');
    await page.locator('#model-list button').filter({ hasText: 'FPS hammer tool' }).first().click();
    await page.locator('#model-side').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(output, `${variant}-asset-side.png`) });
    await page.locator('#model-front').click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(output, `${variant}-asset-front.png`) });
    results[variant] = { game, work, liveWork, visibleFps, hiddenFps, errors };
    if (variant === 'candidate') {
      await page.locator('#model-close').click();
      await page.locator('#settings-toggle').click();
      await page.locator('#hammer-handle-angle').fill('45');
      await page.waitForTimeout(500);
      results[variant].angle = await page.evaluate(() => window.__wireTheHouse.fpsRig.sideHandleAngleDegrees);
      await page.screenshot({ path: path.join(output, 'candidate-handle-settings.png') });
      await page.locator('#settings-close').click();
      results[variant].handleRight = await page.evaluate(() => {
        const g = window.__wireTheHouse, step = g.step.bind(g), h = g.fpsRig.tools.get('hammer');
        for (let i = 0; i < 120; i++) step(1 / 60);
        const side = h.getObjectByName('Rotatable auxiliary handle');
        return { rotation: side.rotation.z, supportGrip: h.userData.secondaryGripPoint, roles: g.fpsRig.debugPose().arms.map(a => a.gripRole) };
      });
      await page.locator('#hammer-view-left').click();
      results[variant].handleLeft = await page.evaluate(() => {
        const g = window.__wireTheHouse, step = g.step.bind(g), h = g.fpsRig.tools.get('hammer');
        for (let i = 0; i < 120; i++) step(1 / 60);
        const side = h.getObjectByName('Rotatable auxiliary handle');
        return { rotation: side.rotation.z, supportGrip: h.userData.secondaryGripPoint, roles: g.fpsRig.debugPose().arms.map(a => a.gripRole), contact: g.fpsRig.contactStatus };
      });
      await page.screenshot({ path: path.join(output, 'candidate-left-grip.png') });
    }
    await context.close();
  }
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await blockPointerLock(mobile);
  await serveCandidate(mobile);
  const page = await mobile.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');
  await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 120000 });
  await page.locator('#start-button').tap();
  await page.locator('#start-screen').waitFor({ state: 'hidden' });
  await page.locator('#worker-bar-handle').tap();
  await page.locator('#mobile-tool-slider [data-tool="hammer"]').tap();
  await page.waitForFunction(() => window.__wireTheHouse?.fpsRig.tools.get('hammer')?.userData.visualAsset === 'FORGE concept C Blender GLB');
  const mobileWork = await page.evaluate(async () => {
    const g = window.__wireTheHouse, camera = g.renderer.camera;
    const step = g.step.bind(g); g.step = () => {};
    camera.position.set(0, 1.65, g.room.brickWall.volume.frontZ + .9);
    g.player.yaw = 0; g.player.pitch = -.18;
    for (let i = 0; i < 120; i++) step(1 / 60);
    const before = g.room.brickWall.impactCount;
    g.input.actionHeld = true;
    for (let i = 0; i < 120; i++) {
      step(1 / 60);
      if ((i + 1) % 30 === 0) await g.chasing.waitForDebrisSplits();
    }
    g.input.actionHeld = false;
    return { impacts: g.room.brickWall.impactCount - before, contact: g.fpsRig.contactStatus, hands: g.fpsRig.debugPose().arms.map(a => a.gripRole), asset: g.fpsRig.tools.get('hammer').userData.visualAsset, renderError: g.renderer.renderError };
  });
  await page.screenshot({ path: path.join(output, 'candidate-mobile-work.png') });
  results.mobile = { work: mobileWork, errors };
  await mobile.close();
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
