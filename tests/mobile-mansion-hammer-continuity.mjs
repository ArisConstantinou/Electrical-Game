import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { blockPointerLock } from './browser-safety.mjs';

const distMode = process.argv.includes('--dist');
const yawOffset = Number(process.env.MASONRY_YAW ?? 0);
const initialYaw = Math.PI + yawOffset;
const url = distMode ? 'https://arisconstantinou.github.io/Electrical-Game/?mansion=preview&renderer=webgl'
  : 'http://127.0.0.1:5365/Electrical-Game/?mansion=preview&renderer=webgl';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await blockPointerLock(context);
  if (distMode) await context.route('https://arisconstantinou.github.io/Electrical-Game/**', async route => {
    const file = resolve('dist', decodeURIComponent(new URL(route.request().url()).pathname.slice('/Electrical-Game/'.length)) || 'index.html');
    if (!file.startsWith(`${resolve('dist')}\\`)) return route.abort();
    try {
      if (!(await stat(file)).isFile()) return route.abort();
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml' };
      await route.fulfill({ status: 200, contentType: mime[extname(file)] ?? 'application/octet-stream', body: await readFile(file) });
    } catch { await route.abort(); }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 120000 });
  await page.locator('#apprentice-count').selectOption('0');
  await page.locator('#start-button').tap();
  await page.locator('#worker-bar-handle').tap();
  await page.locator('#mobile-tool-slider [data-tool="hammer"]').tap();
  await page.evaluate(yaw => {
    const game = window.__wireTheHouse, camera = game.renderer.camera;
    window.__hammerStep = game.step.bind(game);
    game.step = () => {};
    game.hammerMode = 'demolish';
    camera.position.set(15.3, game.player.eyeHeight, 15);
    game.player.yaw = yaw;
    game.player.pitch = 0;
    camera.rotation.set(0, yaw, 0);
    for (let frame = 0; frame < 120; frame++) window.__hammerStep(1 / 60);
  }, initialYaw);
  await mkdir('output/hammer-mobile-stability', { recursive: true });
  await page.screenshot({ path: 'output/hammer-mobile-stability/idle.png' });
  const use = await page.locator('#site-pro-use').boundingBox();
  assert(use, 'Mobile USE control is missing');
  const cdp = await context.newCDPSession(page);
  const point = { id: 41, x: use.x + use.width / 2, y: use.y + use.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  const { samples, stepMs, attempts } = await page.evaluate(async () => {
    const game = window.__wireTheHouse, camera = game.renderer.camera;
    const wall = game.room.mansionWing.masonryDemolition.get('Courtyard north fired-clay enclosure');
    const samples = [], stepMs = [], attempts = [];
    const strike = wall.strikeAt.bind(wall);
    let currentFrame = -1;
    wall.strikeAt = (...args) => {
      const before = wall.removedClayNodes;
      const success = strike(...args);
      attempts.push({ frame: currentFrame, index: args[0], success, removed: wall.removedClayNodes - before });
      return success;
    };
    for (let frame = 0; frame < 120; frame++) {
      currentFrame = frame;
      const started = performance.now();
      window.__hammerStep(1 / 60);
      if (frame >= 30) stepMs.push(performance.now() - started);
      if (frame % 10 === 0) {
        const tip = game.fpsRig.chiselTipWorld.clone().project(camera);
        samples.push({ frame, yaw: game.player.yaw, pitch: game.player.pitch,
          removed: wall.removedClayNodes, contact: game.fpsRig.contactStatus,
          tipDistanceFromAim: Math.hypot(tip.x, tip.y),
          aim: game.room.mansionWing.aimMasonry(camera)?.wall.group.name ?? null });
      }
      if (frame % 12 === 0) await game.chasing.waitForDebrisSplits();
    }
    stepMs.sort((a, b) => a - b);
    return { samples, attempts, stepMs: { median: stepMs[Math.floor(stepMs.length / 2)], p95: stepMs[Math.floor(stepMs.length * .95)] } };
  });
  await page.screenshot({ path: 'output/hammer-mobile-stability/held.png' });
  const aimCostMs = await page.evaluate(() => {
    const game = window.__wireTheHouse, direct = [], assisted = [];
    for (let i = 0; i < 100; i++) {
      let start = performance.now(); game.room.mansionWing.aimMasonry(game.renderer.camera); direct.push(performance.now() - start);
      start = performance.now(); game.hammerMasonryAim(); assisted.push(performance.now() - start);
    }
    const summarize = values => { values.sort((a, b) => a - b); return { median: values[50], p95: values[95] }; };
    return { direct: summarize(direct), assisted: summarize(assisted) };
  });
  const beforeDrag = await page.evaluate(() => ({ yaw: window.__wireTheHouse.player.yaw, pitch: window.__wireTheHouse.player.pitch }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, x: point.x + 12 }] });
  const afterDrag = await page.evaluate(() => { window.__hammerStep(1 / 60); return { yaw: window.__wireTheHouse.player.yaw, pitch: window.__wireTheHouse.player.pitch }; });
  await page.evaluate(() => { for (let frame = 0; frame < 30; frame++) window.__hammerStep(1 / 60); });
  const stationary = await page.evaluate(() => ({ yaw: window.__wireTheHouse.player.yaw, pitch: window.__wireTheHouse.player.pitch }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] });
  const reversed = await page.evaluate(() => { window.__hammerStep(1 / 60); return { yaw: window.__wireTheHouse.player.yaw, pitch: window.__wireTheHouse.player.pitch }; });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const close = await page.evaluate(() => {
    const game = window.__wireTheHouse, camera = game.renderer.camera;
    game.room.mansionWing.masonryDemolition.get('Courtyard north fired-clay enclosure').reset();
    camera.position.set(15.3, game.player.eyeHeight, 15.4);
    game.player.yaw = Math.PI; game.player.pitch = 0;
    camera.rotation.set(0, Math.PI, 0);
    window.__hammerStep(1 / 60);
    const label = document.querySelector('#mobile-use-status');
    return { contact: game.fpsRig.contactStatus, reason: game.fpsRig.reachReason,
      label: label?.textContent, labelDisplay: getComputedStyle(label).display };
  });
  await page.screenshot({ path: 'output/hammer-mobile-stability/too-close.png' });
  const backedOff = await page.evaluate(() => {
    const game = window.__wireTheHouse, camera = game.renderer.camera;
    camera.position.z = 15;
    window.__hammerStep(1 / 60);
    return { contact: game.fpsRig.contactStatus, label: document.querySelector('#mobile-use-status')?.textContent };
  });
  const first = samples.find(sample => sample.frame === 30);
  const middle = samples.find(sample => sample.frame === 60);
  const last = samples.at(-1);
  console.log(JSON.stringify({ yawOffset, samples, stepMs, attempts: attempts.slice(-22), aimCostMs, drag: { beforeDrag, afterDrag, stationary, reversed }, close, backedOff, errors }));
  assert(samples.every(sample => Math.abs(sample.yaw - initialYaw) < 1e-8 && Math.abs(sample.pitch) < 1e-8), 'Stationary USE rotated the camera');
  assert(first.removed > 0 && last.removed > middle.removed, 'Demolition stopped after opening the first cavity');
  assert(samples.every(sample => sample.tipDistanceFromAim < .24), 'Hammer bit jumped far away from the aim after a cavity opened');
  assert(afterDrag.yaw < beforeDrag.yaw && beforeDrag.yaw - afterDrag.yaw < .1, 'USE drag turned the view too far or the wrong way');
  assert(Math.abs(stationary.yaw - afterDrag.yaw) < 1e-8 && Math.abs(stationary.pitch - afterDrag.pitch) < 1e-8, 'Camera kept turning after USE finger stopped');
  assert(Math.abs(reversed.yaw - beforeDrag.yaw) < .005, 'Reversing USE drag did not restore the original aim');
  assert.equal(close.contact, 'too-close', 'A bit that cannot fit at the wall was reported ready');
  assert.match(close.label ?? '', /step back/i);
  assert.equal(close.labelDisplay, 'block', 'Mobile close-contact instruction is hidden');
  assert.equal(backedOff.contact, 'ready', 'Stepping back did not restore masonry contact');
  assert.deepEqual(errors, []);
  await context.close();
} finally {
  await browser.close();
}
