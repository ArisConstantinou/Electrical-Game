import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5365/Electrical-Game/?renderer=webgl';
const out = process.argv[3] ?? 'output/sand-shoveling-ui';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { url, cases: [], errors: [], passed: false };
try {
  for (const layout of [
    { name: 'desktop', width: 1366, height: 768, touch: false },
    { name: 'portrait', width: 390, height: 844, touch: true },
  ]) {
    const context = await browser.newContext({ viewport: { width: layout.width, height: layout.height }, isMobile: layout.touch, hasTouch: layout.touch });
    await blockPointerLock(context);
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => window.__wireTheHouse?.mixing?.models.sand?.telemetry, null, { timeout: 120000 });
    await page.locator('#apprentice-count').selectOption('0');
    if (layout.touch) await page.locator('#start-button').tap(); else await page.locator('#start-button').click();
    await page.locator('#start-screen').waitFor({ state: 'hidden' });
    await page.evaluate(() => { const game = window.__wireTheHouse; window.__sandStep = game.step.bind(game); game.step = () => {}; });
    const step = count => page.evaluate(n => { for (let i = 0; i < n; i++) window.__sandStep(1 / 60); }, count);
    const before = await page.evaluate(() => {
      const game = window.__wireTheHouse, mixing = game.mixing, sand = mixing.models.sand, camera = game.renderer.camera;
      window.__sandUpdateMs = [];
      const update = sand.update.bind(sand);
      sand.update = dt => { const active = sand.telemetry.pendingSettle > 0, start = performance.now(); update(dt); if (active) window.__sandUpdateMs.push(performance.now() - start); };
      mixing.setActive(true); mixing.chooseTool('shovel');
      const centre = sand.getWorldPosition(camera.position.clone());
      camera.position.set(centre.x, game.player.eyeHeight, centre.z - 1.17);
      camera.lookAt(centre.x - .25, .30, centre.z);
      game.player.yaw = camera.rotation.y; game.player.pitch = camera.rotation.x;
      return { kg: mixing.batch.getState().sandRemainingKg, height: sand.heightAt(-.25, 0) };
    });
    await step(3);
    const target = await page.evaluate(() => window.__wireTheHouse.mixing.aimedObject()?.kind);
    assert.equal(target, 'sand', `${layout.name}: crosshair selects the visible sand, not a hidden prop`);
    await page.screenshot({ path: `${out}/${layout.name}-before.png` });
    const started = await page.evaluate(() => window.__wireTheHouse.mixing.handleInteractionRequest(true, true));
    assert.equal(started, true);
    await step(35);
    const carrying = await page.evaluate(() => {
      const mixing = window.__wireTheHouse.mixing, sand = mixing.models.sand;
      return { activity: mixing.telemetry.activity, held: mixing.batch.getState().heldShovel?.kg ?? 0, cut: sand.telemetry.lastScoop,
        visibleLoad: mixing.heldTools.get('shovel').getObjectByName('shovel-sand-load').visible };
    });
    assert.equal(carrying.activity, 'sand');
    assert(carrying.held > 0 && carrying.visibleLoad, `${layout.name}: sand rides on the physical blade`);
    assert(carrying.cut && Math.abs(carrying.cut.kg - carrying.held) < 1e-6, `${layout.name}: visual cut matches held mass`);
    await page.screenshot({ path: `${out}/${layout.name}-carrying.png` });
    await step(35);
    const stream = await page.evaluate(() => {
      const mixing = window.__wireTheHouse.mixing;
      return { visible: mixing.pouring.visible, kind: mixing.pouringKind, grains: mixing.pouring.geometry.getAttribute('position').count };
    });
    assert(stream.visible && stream.kind === 'sand' && stream.grains >= 48, `${layout.name}: a granular stream connects the blade to the bucket`);
    await page.evaluate(() => {
      const game = window.__wireTheHouse, camera = game.renderer.camera, bucket = game.mixing.models.bucket.getWorldPosition(camera.position.clone());
      window.__sandCamera = { position: camera.position.clone(), rotation: camera.rotation.clone() };
      camera.position.set(bucket.x - .35, 1.22, bucket.z - .95);
      camera.lookAt(bucket.x, bucket.y + .27, bucket.z);
      game.player.yaw = camera.rotation.y; game.player.pitch = camera.rotation.x;
    });
    await step(1);
    await page.screenshot({ path: `${out}/${layout.name}-pouring.png` });
    await page.evaluate(() => {
      const game = window.__wireTheHouse, camera = game.renderer.camera;
      camera.position.copy(window.__sandCamera.position); camera.rotation.copy(window.__sandCamera.rotation);
      game.player.yaw = camera.rotation.y; game.player.pitch = camera.rotation.x;
    });
    await step(1);
    await step(40);
    const after = await page.evaluate(() => {
      const mixing = window.__wireTheHouse.mixing, sand = mixing.models.sand;
      const samples = window.__sandUpdateMs;
      return { sourceKg: mixing.batch.getState().sandRemainingKg, surfaceKg: sand.telemetry.surfaceKg,
        centreHeight: sand.heightAt(-.25, 0), pitHeight: sand.heightAt(sand.telemetry.lastScoop.x, sand.telemetry.lastScoop.z),
        batchScoops: mixing.batch.sandScoops, settling: { frames: samples.length, meanMs: samples.reduce((a,b)=>a+b,0)/samples.length, worstMs: Math.max(...samples) }, renderError: window.__wireTheHouse.renderer.renderError };
    });
    assert(Math.abs(after.sourceKg - (before.kg - carrying.held)) < 1e-6);
    assert(Math.abs(after.surfaceKg - after.sourceKg) < .04, `${layout.name}: rendered pile conserves the inventory mass`);
    assert(after.centreHeight < before.height, `${layout.name}: the scoop persists as a local pit`);
    assert.equal(after.batchScoops, 1, `${layout.name}: the shovel load reaches the bucket once`);
    assert(after.settling.frames >= 15 && after.settling.meanMs < 3, `${layout.name}: surface relaxation stays within a small CPU budget`);
    assert.equal(after.renderError, '');
    await page.screenshot({ path: `${out}/${layout.name}-after.png` });
    for (let scoop = 1; scoop < 6; scoop++) {
      assert.equal(await page.evaluate(() => window.__wireTheHouse.mixing.aimedObject()?.kind), 'sand');
      assert.equal(await page.evaluate(() => window.__wireTheHouse.mixing.handleInteractionRequest(true, true)), true);
      await step(105);
    }
    const repeated = await page.evaluate(() => {
      const mixing = window.__wireTheHouse.mixing, sand = mixing.models.sand;
      return { sourceKg: mixing.batch.getState().sandRemainingKg, surfaceKg: sand.telemetry.surfaceKg,
        cutX: sand.telemetry.lastScoop.x, cutZ: sand.telemetry.lastScoop.z,
        pitHeight: sand.heightAt(sand.telemetry.lastScoop.x, sand.telemetry.lastScoop.z), batchScoops: mixing.batch.sandScoops };
    });
    assert.equal(repeated.batchScoops, 6);
    assert(Math.abs(repeated.sourceKg - repeated.surfaceKg) < .05, `${layout.name}: six cuts retain mass balance`);
    assert(repeated.pitHeight < after.pitHeight - .025, `${layout.name}: a real trench grows where the player repeatedly cuts`);
    await page.screenshot({ path: `${out}/${layout.name}-six-cuts.png` });
    await page.evaluate(async () => {
      const game = window.__wireTheHouse, sand = game.mixing.models.sand, camera = game.renderer.camera;
      const centre = sand.getWorldPosition(camera.position.clone());
      camera.position.set(centre.x - .72, .91, centre.z - .80);
      camera.lookAt(centre.x - .18, .26, centre.z - .04);
      game.renderer.render(); await game.renderer.waitForFrame();
    });
    await page.screenshot({ path: `${out}/${layout.name}-cut-detail.png` });
    const external = await page.evaluate(() => {
      const mixing = window.__wireTheHouse.mixing;
      const took = mixing.batch.scoopSand();
      mixing.update(1 / 60, false, false);
      return { took, sourceKg: mixing.batch.sandRemainingKg, surfaceKg: mixing.models.sand.telemetry.surfaceKg };
    });
    assert(external.took && Math.abs(external.sourceKg - external.surfaceKg) < .05, `${layout.name}: apprentice-style direct stock use updates the same visible pile`);
    report.cases.push({ layout: layout.name, before, carrying, after, repeated, external });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
  console.log(JSON.stringify({ passed: true, cases: report.cases.map(c => ({ layout: c.layout, kg: c.carrying.held, sourceKg: c.after.sourceKg, surfaceKg: c.after.surfaceKg })) }));
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
