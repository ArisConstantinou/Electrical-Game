import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { blockPointerLock } from './browser-safety.mjs';

const live = process.argv.includes('--live');
const out = resolve('output/original-side-clay-wear');
const dist = resolve('dist');
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
  const inspect = (x, z, yaw, side) => page.evaluate(({ x, z, yaw, side }) => {
    const game = window.__wireTheHouse;
    game.step = () => {};
    game.fpsRig.visible = false;
    const camera = game.renderer.camera;
    camera.position.set(x, 1.65, z);
    camera.rotation.set(0, yaw, 0);
    game.renderer.render();
    const group = game.room.referenceWalls.find(wall => wall.name === `${side} concrete wall`);
    const base = group.getObjectByName(side === 'Right' ? 'Right fired-clay courses' : 'Left fired-clay courses cut around unglazed opening');
    const chips = group.children.filter(child => child.isInstancedMesh && child.name.startsWith(`${side} physically chipped`));
    const positions = Array.from({ length: base.count }, (_, index) => {
      const matrix = new camera.matrixWorld.constructor();
      base.getMatrixAt(index, matrix);
      return { depth: matrix.elements[12], visible: Math.abs(matrix.elements[0]) > .001 };
    });
    return { side, baseCount: base.count, visibleBase: positions.filter(item => item.visible).length,
      chipCounts: chips.map(mesh => mesh.count), chipTriangles: chips.map(mesh =>
        mesh.geometry.getIndex() ? mesh.geometry.getIndex().count / 3 : mesh.geometry.getAttribute('position').count / 3),
      reliefRange: Math.max(...positions.filter(item => item.visible).map(item => item.depth)) - Math.min(...positions.filter(item => item.visible).map(item => item.depth)),
      draws: game.renderer.webgl.info.render.calls, triangles: game.renderer.webgl.info.render.triangles,
      geometries: game.renderer.webgl.info.memory.geometries, renderError: game.renderer.renderError };
  }, { x, z, yaw, side });
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
  const right = await inspect(1.5, -1.1, -Math.PI / 2, 'Right');
  const rightFrames = await frameSample();
  await page.locator('#game-canvas').screenshot({ path: resolve(out, live ? 'before-right.png' : 'candidate-right.png') });
  const left = await inspect(-1.5, -.9, Math.PI / 2, 'Left');
  await page.locator('#game-canvas').screenshot({ path: resolve(out, live ? 'before-left.png' : 'candidate-left.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await inspect(1.5, -1.1, -Math.PI / 2, 'Right');
  const mobileFrames = await frameSample();
  await page.locator('#game-canvas').screenshot({ path: resolve(out, live ? 'before-mobile.png' : 'candidate-mobile.png') });
  await writeFile(resolve(out, live ? 'before-live.json' : 'candidate.json'), JSON.stringify({ right, rightFrames, left, mobile, mobileFrames, errors }, null, 2));
  assert([right, left, mobile].every(wall => wall.chipCounts.length === 3 &&
    wall.chipCounts.reduce((a, b) => a + b, 0) > 15 && wall.reliefRange > .001 && !wall.renderError),
  `Side walls still have uniform factory geometry: ${JSON.stringify({ right, left, mobile })}`);
  assert(!errors.length, `Rendering errors: ${errors.join('; ')}`);
  console.log(JSON.stringify({ live, right, rightFrames, left, mobile, mobileFrames, errors }));
} finally { await browser.close(); }
