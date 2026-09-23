import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { blockPointerLock } from './browser-safety.mjs';

const live = process.argv.includes('--live');
const dist = resolve('dist');
const out = resolve('output/mansion-partial-retirement');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await blockPointerLock(context);
  if (!live) await context.route('http://127.0.0.1:5365/Electrical-Game/**', async route => {
    const relative = decodeURIComponent(new URL(route.request().url()).pathname.slice('/Electrical-Game/'.length)) || 'index.html';
    const file = resolve(dist, relative);
    if (!file.startsWith(dist + sep)) return route.abort();
    try {
      if (!(await stat(file)).isFile()) return route.abort();
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp',
        '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary' };
      await route.fulfill({ status: 200, contentType: mime[extname(file)] ?? 'application/octet-stream', body: await readFile(file) });
    } catch { await route.abort(); }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&renderer=webgl');
  await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart && !document.querySelector('#start-button')?.disabled, null, { timeout: 120000 });
  await page.locator('#apprentice-count').selectOption('0');
  await page.locator('#start-button').click();
  const result = await page.evaluate(() => {
    const game = window.__wireTheHouse;
    game.step = () => {};
    const camera = game.renderer.camera;
    camera.position.set(15.3, 1.65, 15.0);
    camera.rotation.set(0, Math.PI, 0);
    const wall = game.room.mansionWing.masonryDemolition.get('Courtyard north fired-clay enclosure');
    const target = wall.aim(camera);
    if (!target || !wall.strikeAt(target.index, camera)) throw new Error('Unable to create real initial hammer damage');
    const entry = wall.broken.get(target.index), volume = entry.volume;
    let originalSolidNodes = 0;
    for (let y = 1; y <= volume.ny; y++) for (let x = 1; x <= volume.nx; x++)
      for (let z = 1; z <= volume.nz; z++) if (volume.baseMaterial(x, y, z)) originalSolidNodes++;
    volume.carveBox({ x: -volume.width / 2 - .01, y: -.01, z: volume.frontZ - volume.depth - .01 },
      { x: volume.width * .31, y: volume.height + .01, z: volume.frontZ + .01 });
    const afterCarve = volume.removedNodeCount;
    wall.group.updateWorldMatrix(true, false);
    camera.position.x = entry.origin.x + volume.width * .44 + wall.group.matrixWorld.elements[12];
    const accepted = wall.strikeAt(target.index, camera);
    game.fpsRig.visible = false;
    game.renderer.render();
    const mortar = wall.mortarCells;
    const bedHeight = mortar?.instanceMatrix.array[(target.index * 2) * 16 + 5] ?? null;
    const headWidth = mortar?.instanceMatrix.array[(target.index * 2 + 1) * 16] ?? null;
    const crossWall = game.room.mansionWing.masonryDemolition.get('recessed-room-back-9');
    crossWall.strike(3);
    const crossMortar = crossWall.mortarCells;
    const crossBedHeight = crossMortar?.instanceMatrix.array[5] ?? null;
    const crossHeadWidth = crossMortar?.instanceMatrix.array[16 + 10] ?? null;
    return { accepted, removedBricks: wall.removedIndices().length, partialBricks: wall.partialDamageCount,
      originalSolidNodes, afterCarve, remainingFraction: (originalSolidNodes - volume.removedNodeCount) / originalSolidNodes,
      oldBoxFraction: volume.removedVolume / (volume.width * volume.height * volume.depth),
      removedClayNodes: wall.removedClayNodes, mortarInstances: mortar?.count ?? null,
      expectedMortarInstances: wall.brickRefs.length * 2, bedHeight, headWidth,
      crossMortarInstances: crossMortar?.count ?? null, expectedCrossMortarInstances: crossWall.brickRefs.length * 2,
      crossBedHeight, crossHeadWidth,
      drawCalls: game.renderer.webgl.info.render.calls, triangles: game.renderer.webgl.info.render.triangles,
      renderError: game.renderer.renderError };
  });
  await page.locator('#game-canvas').screenshot({ path: resolve(out, live ? 'before-live.png' : 'candidate.png') });
  const profile = await page.evaluate(async () => {
    const g = window.__wireTheHouse, intervals = [], cpu = [];
    let previous = 0;
    for (let i = 0; i < 90; i++) await new Promise(resolve => requestAnimationFrame(now => {
      if (previous) intervals.push(now - previous);
      previous = now;
      const start = performance.now();
      g.renderer.render();
      cpu.push(performance.now() - start);
      resolve();
    }));
    const p95 = values => values.sort((a, b) => a - b)[Math.floor(values.length * .95)] ?? null;
    return { frameP95Ms: p95(intervals), renderCpuP95Ms: p95(cpu),
      drawCalls: g.renderer.webgl.info.render.calls, triangles: g.renderer.webgl.info.render.triangles };
  });
  const restored = await page.evaluate(() => {
    const g = window.__wireTheHouse;
    const saved = g.levelEditor.document();
    g.room.mansionWing.restoreDemolition({});
    g.levelEditor.applyDocument(saved);
    const w = g.room.mansionWing.masonryDemolition.get('Courtyard north fired-clay enclosure');
    return { partialBricks: w.partialDamageCount, removedClayNodes: w.removedClayNodes,
      removedBricks: w.removedIndices().length, renderError: g.renderer.renderError };
  });
  await writeFile(resolve(out, live ? 'before-profile.json' : 'candidate-profile.json'), JSON.stringify({ result, profile, restored, errors }, null, 2));
  assert(result.afterCarve / result.originalSolidNodes > .5 && result.oldBoxFraction > .48 && result.remainingFraction > .1,
    `Fixture did not leave a visible clay remnant past the old whole-box threshold: ${JSON.stringify(result)}`);
  assert(result.accepted && result.removedBricks === 0 && result.partialBricks === 1 && !result.renderError && !errors.length,
    `Substantial surviving clay was replaced by an empty brick slot: ${JSON.stringify({ result, profile, errors })}`);
  assert(result.mortarInstances === result.expectedMortarInstances && result.bedHeight <= .017 && result.headWidth <= .009,
    `Mortar must remain thin bed and head joints, not a solid block behind each brick: ${JSON.stringify(result)}`);
  assert(result.crossMortarInstances === result.expectedCrossMortarInstances && result.crossBedHeight <= .017 && result.crossHeadWidth <= .009,
    `Perpendicular walls also need thin joints: ${JSON.stringify(result)}`);
  assert(restored.partialBricks === 1 && restored.removedClayNodes === result.removedClayNodes && restored.removedBricks === 0 && !restored.renderError,
    `The retained fractured unit did not survive Studio save and restore: ${JSON.stringify(restored)}`);
  console.log(JSON.stringify({ live, result, profile, restored, errors }));
} finally { await browser.close(); }
