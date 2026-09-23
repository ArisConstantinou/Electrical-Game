import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { blockPointerLock } from './browser-safety.mjs';

const live = process.argv.includes('--live');
const dist = resolve('dist');
const out = resolve('output/mansion-joint-fracture');
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
    if (!target) throw new Error('Could not target the courtyard wall');
    const index = target.index, neighbor = index + 1;
    if (index % wall.columns === wall.columns - 1 || !wall.remaining[neighbor]) throw new Error('Fixture has no right-hand brick');
    const matrix = wall.original[index].elements;
    camera.position.set(matrix[12] + matrix[0] / 2 - .011 + wall.group.position.x, matrix[13] + wall.group.position.y, 15.0);
    camera.rotation.set(0, Math.PI, 0);
    const first = wall.strikeAt(index, camera);
    const second = wall.strikeAt(index, camera);
    const third = wall.strikeAt(index, camera);
    game.fpsRig.visible = false;
    game.renderer.render();
    return { index, neighbor, first, second, third,
      primaryNodes: wall.broken.get(index)?.volume.removedNodeCount ?? 0,
      neighborNodes: wall.broken.get(neighbor)?.volume.removedNodeCount ?? 0,
      partialBricks: wall.partialDamageCount, removedBricks: wall.removedIndices().length,
      renderError: game.renderer.renderError };
  });
  await page.locator('#game-canvas').screenshot({ path: resolve(out, live ? 'before-live.png' : 'candidate.png') });
  const further = await page.evaluate(() => {
    const game = window.__wireTheHouse, wing = game.room.mansionWing, camera = game.renderer.camera;
    const wall = wing.masonryDemolition.get('Courtyard north fired-clay enclosure');
    const firstIndex = wall.broken.keys().next().value;
    const matrix = wall.original[firstIndex].elements;
    wall.reset();
    camera.position.set(matrix[12] + wall.group.position.x, matrix[13] + wall.group.position.y, 15.0);
    camera.rotation.set(0, Math.PI, 0);
    for (let i = 0; i < 3; i++) wall.strikeAt(firstIndex, camera);
    const center = { partialBricks: wall.partialDamageCount, neighboringDamage: [...wall.broken.keys()].filter(index => index !== firstIndex).length };
    wall.reset();
    camera.position.y = matrix[13] + matrix[5] / 2 - .011 + wall.group.position.y;
    for (let i = 0; i < 3; i++) wall.strikeAt(firstIndex, camera);
    const bed = { partialBricks: wall.partialDamageCount,
      otherRowDamage: [...wall.broken.keys()].filter(index => Math.floor(index / wall.columns) !== Math.floor(firstIndex / wall.columns)).length };
    wall.reset();
    camera.position.set(matrix[12] + matrix[0] / 2 - .011 + wall.group.position.x,
      matrix[13] + wall.group.position.y, 15.0);
    game.selectedTool = 'hammer';
    game.fpsRig.show('hammer');
    for (let i = 0; i < 6; i++) game.performAction();
    const tool = { partialBricks: wall.partialDamageCount,
      primaryNodes: wall.broken.get(firstIndex)?.volume.removedNodeCount ?? 0,
      neighborNodes: wall.broken.get(firstIndex + 1)?.volume.removedNodeCount ?? 0,
      damaged: [...wall.broken].map(([index, entry]) => [index, entry.volume.removedNodeCount]) };
    wall.reset();
    const cross = wing.masonryDemolition.get('recessed-room-back-9');
    camera.position.set(20.0, 1.65, 9);
    camera.rotation.set(0, -Math.PI / 2, 0);
    const target = cross.aim(camera);
    if (!target || target.index % cross.columns === cross.columns - 1) throw new Error('Perpendicular wall target lacks a neighbor');
    const crossMatrix = cross.original[target.index].elements;
    cross.group.updateWorldMatrix(true, false);
    const world = cross.group.matrixWorld.elements;
    camera.position.set(20.0, crossMatrix[13] + world[13],
      crossMatrix[14] + crossMatrix[10] / 2 - .011 + world[14]);
    const aimAtEdge = cross.aim(camera);
    const strikes = [];
    for (let i = 0; i < 3; i++) strikes.push(cross.strikeAt(target.index, camera));
    const perpendicular = { primaryNodes: cross.broken.get(target.index)?.volume.removedNodeCount ?? 0,
      neighborNodes: cross.broken.get(target.index + 1)?.volume.removedNodeCount ?? 0,
      partialBricks: cross.partialDamageCount, targetIndex: target.index, strikes,
      camera: camera.position.toArray(), initialDistance: target.distance,
      edgeDistance: aimAtEdge?.distance ?? null, edgeIndex: aimAtEdge?.index ?? null,
      instance: [crossMatrix[12], crossMatrix[13], crossMatrix[14], crossMatrix[0], crossMatrix[5], crossMatrix[10]] };
    const document = game.levelEditor.document();
    wing.restoreDemolition({});
    game.levelEditor.applyDocument(document);
    const restored = { primaryNodes: cross.broken.get(target.index)?.volume.removedNodeCount ?? 0,
      neighborNodes: cross.broken.get(target.index + 1)?.volume.removedNodeCount ?? 0,
      partialBricks: cross.partialDamageCount };
    camera.position.set(matrix[12] + matrix[0] / 2 - .011 + wall.group.position.x,
      matrix[13] + wall.group.position.y, 15.0);
    camera.rotation.set(0, Math.PI, 0);
    const timings = [];
    for (let i = 0; i < 12; i++) {
      wall.reset();
      const start = performance.now();
      wall.strikeAt(firstIndex, camera);
      timings.push(performance.now() - start);
    }
    timings.sort((a, b) => a - b);
    const profile = { hitMedianMs: timings[6], hitP95Ms: timings[11] };
    return { center, bed, tool, perpendicular, restored, profile, renderError: game.renderer.renderError };
  });
  await writeFile(resolve(out, live ? 'before-live.json' : 'candidate.json'), JSON.stringify({ result, further, errors }, null, 2));
  assert(result.first && result.primaryNodes > 0 && result.neighborNodes > 0 && result.partialBricks >= 2 && !result.removedBricks && !result.renderError && !errors.length,
    `A hit beside the mortar joint did not fracture the adjacent brick: ${JSON.stringify({ result, further, errors })}`);
  assert(further.center.partialBricks === 1 && further.center.neighboringDamage === 0,
    `A hit in the brick centre damaged an unrelated unit: ${JSON.stringify(further.center)}`);
  assert(further.bed.otherRowDamage > 0,
    `A hit along the bed joint did not reach the next course: ${JSON.stringify(further.bed)}`);
  assert(further.tool.partialBricks >= 2 && further.tool.primaryNodes > 0 && further.tool.neighborNodes > 0,
    `The visible hammer action did not carry its contact across the joint: ${JSON.stringify(further.tool)}`);
  assert(further.perpendicular.primaryNodes > 0 && further.perpendicular.neighborNodes > 0 && further.perpendicular.partialBricks >= 2,
    `A perpendicular mansion wall did not carry damage across its joint: ${JSON.stringify(further.perpendicular)}`);
  assert.deepEqual(further.restored, { primaryNodes: further.perpendicular.primaryNodes,
    neighborNodes: further.perpendicular.neighborNodes, partialBricks: further.perpendicular.partialBricks },
  'Studio restore lost cross-joint clay damage');
  assert(!further.renderError && !errors.length);
  console.log(JSON.stringify({ live, result, further, errors }));
} finally { await browser.close(); }
