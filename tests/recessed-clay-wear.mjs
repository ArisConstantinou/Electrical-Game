import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { blockPointerLock } from './browser-safety.mjs';

const live = process.argv.includes('--live');
const dist = resolve('dist');
const out = resolve('output/recessed-clay-wear');
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
    game.fpsRig.visible = false;
    const wing = game.room.mansionWing;
    const camera = game.renderer.camera;
    camera.position.set(19.53, 1.6, 9);
    camera.rotation.set(0, -Math.PI / 2, 0);
    game.renderer.render();
    const ids = ['recessed-room-side-9--1', 'recessed-room-back-9', 'recessed-room-side-13--1', 'recessed-room-back-13'];
    const walls = ids.map(id => {
      const wall = wing.masonryDemolition.get(id);
      const meshes = wall.group.children.filter(child => child.isInstancedMesh && child.name.startsWith(`${id} ·`));
      const refs = wall.brickRefs;
      const occupied = refs.map((ref, index) => ref ? index : -1).filter(index => index >= 0);
      const chipped = meshes.filter(mesh => !mesh.name.includes('sound clay units'));
      const relief = occupied.map(index => {
        const e = wall.original[index].elements;
        return wall.alongX ? e[14] : e[12];
      });
      return { id, columns: wall.columns, rows: wall.rows, occupied: occupied.length,
        variants: meshes.map(mesh => ({ name: mesh.name, count: mesh.count,
          triangles: mesh.geometry.getIndex() ? mesh.geometry.getIndex().count / 3 : mesh.geometry.getAttribute('position').count / 3 })),
        chipped: chipped.reduce((n, mesh) => n + mesh.count, 0),
        reliefRange: Math.max(...relief) - Math.min(...relief),
        firstRow: occupied.filter(index => index < wall.columns).map(index => wall.original[index].elements[wall.alongX ? 12 : 14]),
        secondRow: occupied.filter(index => index >= wall.columns && index < wall.columns * 2)
          .map(index => wall.original[index].elements[wall.alongX ? 12 : 14]) };
    });
    return { walls, drawCalls: game.renderer.webgl.info.render.calls,
      triangles: game.renderer.webgl.info.render.triangles,
      geometries: game.renderer.webgl.info.memory.geometries,
      textures: game.renderer.webgl.info.memory.textures, renderError: game.renderer.renderError };
  });
  const frameSample = () => page.evaluate(async () => {
    const spans = [];
    await new Promise(resolve => {
      let previous = performance.now();
      const tick = now => {
        spans.push(now - previous);
        previous = now;
        if (spans.length < 100) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    spans.splice(0, 10);
    spans.sort((a, b) => a - b);
    return { medianMs: spans[45], p95Ms: spans[85] };
  });
  const desktopFrames = await frameSample();
  await page.locator('#game-canvas').screenshot({ path: resolve(out, live ? 'before-live.png' : 'candidate.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await page.evaluate(() => {
    const game = window.__wireTheHouse;
    game.renderer.render();
    return { drawCalls: game.renderer.webgl.info.render.calls,
      triangles: game.renderer.webgl.info.render.triangles, renderError: game.renderer.renderError };
  });
  const mobileFrames = await frameSample();
  await page.locator('#game-canvas').screenshot({ path: resolve(out, live ? 'before-live-mobile.png' : 'candidate-mobile.png') });
  const damage = await page.evaluate(() => {
    const game = window.__wireTheHouse;
    const wall = game.room.mansionWing.masonryDemolition.get('recessed-room-back-9');
    const camera = game.renderer.camera;
    camera.position.set(20, 1.65, 9);
    camera.rotation.set(0, -Math.PI / 2, 0);
    const target = wall.aim(camera);
    if (!target) throw new Error('Recessed room wall cannot be aimed');
    const accepted = [wall.strikeAt(target.index, camera), wall.strikeAt(target.index, camera), wall.strikeAt(target.index, camera)].every(Boolean);
    const removedNodes = wall.broken.get(target.index)?.volume.removedNodeCount ?? 0;
    const removedBricks = wall.removedIndices().length;
    const document = game.levelEditor.document();
    game.room.mansionWing.restoreDemolition({});
    game.levelEditor.applyDocument(document);
    const restoredNodes = wall.broken.get(target.index)?.volume.removedNodeCount ?? 0;
    return { accepted, index: target.index, removedNodes, removedBricks, restoredNodes };
  });
  await writeFile(resolve(out, live ? 'before-live.json' : 'candidate.json'), JSON.stringify({ result, desktopFrames, mobile, mobileFrames, damage, errors }, null, 2));
  assert(result.walls.every(wall => wall.variants.length === 4 && wall.chipped > 0 && wall.reliefRange > .001 &&
    wall.secondRow.length > wall.firstRow.length), `Recessed clay still has factory-identical rows: ${JSON.stringify(result.walls)}`);
  assert(!result.renderError && !mobile.renderError && !errors.length, `Rendering failed: ${JSON.stringify({ result, mobile, errors })}`);
  assert(damage.accepted && damage.removedNodes > 0 && !damage.removedBricks && damage.restoredNodes === damage.removedNodes,
    `Recessed masonry damage or Studio round trip failed: ${JSON.stringify(damage)}`);
  console.log(JSON.stringify({ live, result, desktopFrames, mobile, mobileFrames, damage, errors }));
} finally { await browser.close(); }
