import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { blockPointerLock } from './browser-safety.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await blockPointerLock(context);
  const root = path.resolve('dist');
  await context.route('http://127.0.0.1:5365/Electrical-Game/**', async route => {
    const relative = decodeURIComponent(new URL(route.request().url()).pathname).slice('/Electrical-Game/'.length) || 'index.html';
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep)) return route.abort();
    try { await route.fulfill({ status: 200, body: await readFile(file), contentType: ({'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.glb':'model/gltf-binary'})[path.extname(file)] || 'application/octet-stream' }); }
    catch { await route.abort(); }
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5365/Electrical-Game/');
  await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 120000 });
  await page.locator('#apprentice-count').selectOption('0');
  await page.locator('#start-button').click();
  const report = await page.evaluate(() => {
    const game = window.__wireTheHouse, batcher = game.masonryBatch, mansion = game.room.mansionWing;
    const toMansion = mansion.matrixWorld.clone().invert(), expected = toMansion.clone(), instance = toMansion.clone(), rendered = toMansion.clone();
    let samples = 0, maxMatrixError = 0, endSources = 0;
    for (const source of batcher.sources) {
      if (source.original.name.startsWith('Cut clay ends')) endSources++;
      for (const index of [0, Math.floor(source.original.count / 2), source.original.count - 1]) {
        source.original.getMatrixAt(index, instance);
        if(source.batched)expected.multiplyMatrices(toMansion, source.original.matrixWorld).multiply(instance);
        else expected.makeScale(0,0,0);
        source.batch.getMatrixAt(source.start + index, rendered);
        for (let component = 0; component < 16; component++) maxMatrixError = Math.max(maxMatrixError, Math.abs(expected.elements[component] - rendered.elements[component]));
        samples++;
      }
    }
    const farSource = batcher.sources.find(source => source.original.name.startsWith('Cut clay ends'));
    const wall = mansion.masonryDemolition.get(farSource.wall.name);
    const eye = game.renderer.camera;
    eye.position.set(farSource.wall.position.x, 1.65, farSource.wall.position.z);
    batcher.update(eye);
    const nearVisible = batcher.sources.filter(source => source.wall === farSource.wall).every(source => source.original.visible && !source.batched);
    eye.position.set(100, 1.65, 100);
    wall.strike(0);
    batcher.update(eye);
    const damagedVisible = batcher.sources.filter(source => source.wall === farSource.wall).every(source => source.original.visible && !source.batched);
    wall.reset();
    batcher.update(eye);
    const resetBatched = batcher.sources.filter(source => source.wall === farSource.wall).every(source => !source.original.visible && source.batched);
    batcher.disableForEditor();
    const editorVisible = batcher.sources.every(source => source.original.visible);
    batcher.update(eye);
    const resumedBatched = batcher.sources.some(source => source.batched);
    return { samples, maxMatrixError, endSources, nearVisible, damagedVisible, resetBatched, editorVisible, resumedBatched,
      renderError: game.renderer.renderError };
  });
  assert(report.samples > 100 && report.endSources > 10 && report.maxMatrixError < 1e-4, `Batch transforms changed: ${JSON.stringify(report)}`);
  assert(report.nearVisible && report.damagedVisible && report.resetBatched && report.editorVisible && report.resumedBatched, `Batch did not restore original walls: ${JSON.stringify(report)}`);
  assert(!report.renderError && !errors.length, `Rendering errors: ${JSON.stringify({ report, errors })}`);
  console.log(JSON.stringify({ pass: true, ...report, errors }));
} finally { await browser.close(); }
