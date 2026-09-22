import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { blockPointerLock } from './browser-safety.mjs';
import { installDistOverlay } from './dist-overlay.mjs';

const url = process.argv.find(value => value.startsWith('http')) ?? 'http://127.0.0.1:5365/Electrical-Game/';
const baseline = process.argv.includes('--baseline');
const out = `output/pvc-stock-bundle/${baseline ? 'before' : 'after'}`;
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { url, baseline, errors: [] };
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await blockPointerLock(context);
  const page = await context.newPage();
  if (process.argv.includes('--dist-overlay')) await installDistOverlay(page);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  await page.goto(url);
  await page.locator('#start-button').click({ timeout: 120000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const game = window.__wireTheHouse;
    game.step = () => {};
    const camera = game.renderer.camera;
    camera.position.set(.9, 1.65, .75);
    camera.lookAt(3.52, 1.42, 1.15);
    camera.updateMatrixWorld(true);
  });
  await page.evaluate(async () => {
    const renderer = window.__wireTheHouse.renderer;
    await renderer.waitForFrame(); renderer.render(); await renderer.waitForFrame();
  });
  await page.screenshot({ path: `${out}/stock.png` });
  await page.evaluate(() => {
    const camera = window.__wireTheHouse.renderer.camera;
    camera.position.set(2.48, .72, 2.02);
    camera.lookAt(3.49, .3, 1.15);
    camera.updateMatrixWorld(true);
  });
  await page.evaluate(async () => {
    const renderer = window.__wireTheHouse.renderer;
    await renderer.waitForFrame(); renderer.render(); await renderer.waitForFrame();
  });
  await page.screenshot({ path: `${out}/stock-base-close.png` });
  report.metrics = await page.evaluate(() => {
    const game = window.__wireTheHouse;
    const stock = game.pvc.stock;
    stock.updateWorldMatrix(true, true);
    game.room.intactPracticeWall.updateWorldMatrix(true, true);
    const wall = game.room.intactPracticeWall;
    const wallFront = wall.position.clone().set(0, 1.5, wall.volume.frontZ);
    wall.localToWorld(wallFront);
    const points = stock.pipes.map(pipe => {
      const base = pipe.localToWorld(pipe.position.clone().set(0, 0, 0));
      const top = pipe.localToWorld(pipe.position.clone().set(0, 3, 0));
      return { base: base.toArray(), top: top.toArray() };
    });
    const extent = (axis) => {
      const values = points.map(point => point.base[axis]);
      return Math.max(...values) - Math.min(...values);
    };
    const triangleCount = object => {
      let triangles = 0;
      object.traverse(child => {
        if (!child.isMesh) return;
        const geometry = child.geometry;
        triangles += geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3;
      });
      return triangles;
    };
    return {
      pipeCount: stock.pipes.length,
      wallInnerX: wallFront.x,
      minimumBaseGap: Math.min(...points.map(point => wallFront.x - point.base[0])),
      minimumTopGap: Math.min(...points.map(point => wallFront.x - point.top[0])),
      baseExtentX: extent(0),
      baseExtentZ: extent(2),
      roundnessRatio: Math.max(extent(0), extent(2)) / Math.min(extent(0), extent(2)),
      strapGeometry: stock.straps.map(strap => strap.geometry.type),
      stockTriangles: triangleCount(stock),
    };
  });
  if (!baseline) {
    assert.equal(report.metrics.pipeCount, 20);
    assert(report.metrics.minimumTopGap >= 0 && report.metrics.minimumTopGap <= .025,
      `Pipe tops must rest at the wall, gap=${report.metrics.minimumTopGap}`);
    assert(report.metrics.minimumBaseGap - report.metrics.minimumTopGap >= .20,
      'The bundle base must stand away from the wall so the pipes visibly lean');
    assert(report.metrics.roundnessRatio <= 1.12,
      `Bundle cross-section must be round, ratio=${report.metrics.roundnessRatio}`);
    assert(report.metrics.strapGeometry.every(type => type === 'TorusGeometry'),
      `Rectangular strap boxes remain: ${report.metrics.strapGeometry.join(', ')}`);
    assert(report.metrics.stockTriangles <= 4200,
      `Rounded stock bundle exceeded its geometry budget: ${report.metrics.stockTriangles} triangles`);
  }
  report.errors = report.errors.filter(message => message !== 'Pointer Lock disabled for automated verification');
  assert.equal(report.errors.length, 0, report.errors.join('\n'));
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report));
