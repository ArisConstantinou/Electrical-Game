import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const out = 'output/editor-shadow-cache';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { environment: 'Windows Chrome WebGL mobile emulation, 390x844; not a physical phone', errors: [] };
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await blockPointerLock(context);
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&editor=1&renderer=webgl');
  await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 120000 });
  report.measurement = await page.evaluate(async () => {
    const game = window.__wireTheHouse;
    const editor = game.levelEditor;
    editor.setFloorIndex(0);
    editor.setViewMode('2d');
    const lights = [];
    game.renderer.scene.traverse(object => {
      if (object.isLight && object.castShadow) lights.push(object);
    });
    const shadow = lights[0]?.shadow;
    if (!shadow) throw new Error('No shadow-casting light in Site Pro 04');
    const renderer = game.renderer;
    const originalRender = renderer.gpu.render.bind(renderer.gpu);
    let draws = [];
    renderer.gpu.render = (world, camera) => {
      const result = originalRender(world, camera);
      if (world === renderer.scene && !renderer.gpu.getRenderTarget()) draws.push(renderer.webgl.info.render.calls);
      return result;
    };
    const frames = count => new Promise(resolve => {
      let left = count;
      const next = () => { if (--left <= 0) resolve(); else requestAnimationFrame(next); };
      requestAnimationFrame(next);
    });
    try {
      await frames(8);
      const opening = { autoUpdate: shadow.autoUpdate, needsUpdate: shadow.needsUpdate };
      draws = [];
      await frames(10);
      const cached = draws.slice(-6);
      shadow.autoUpdate = true;
      draws = [];
      await frames(10);
      const uncached = draws.slice(-6);
      shadow.autoUpdate = false;
      shadow.needsUpdate = true;
      await frames(3);
      const wall = [...game.room.mansionWing.editableWalls.values()].find(item => item.visible && item.userData.levelEditorFloor === 0)
        ?? [...game.room.mansionWing.editableWalls.values()][0];
      if (!wall) throw new Error('No editable wall to move');
      const oldX = wall.position.x;
      wall.position.x += .25;
      wall.updateMatrixWorld(true);
      editor.recordHistory();
      const afterEdit = { needsUpdate: shadow.needsUpdate, wall: wall.name };
      draws = [];
      await frames(6);
      const editDraws = draws.slice();
      const afterEditRender = { needsUpdate: shadow.needsUpdate };
      wall.position.x = oldX;
      wall.updateMatrixWorld(true);
      editor.recordHistory();
      await frames(3);
      editor.setFloorIndex(1);
      const afterFloorChange = { needsUpdate: shadow.needsUpdate };
      await frames(5);
      const afterFloorRender = { needsUpdate: shadow.needsUpdate };
      editor.setFloorIndex(0);
      await frames(4);
      return { opening, cached, uncached, afterEdit, editDraws, afterEditRender,
        afterFloorChange, afterFloorRender, beforeClose: { autoUpdate: shadow.autoUpdate },
        lightCount: lights.length, renderError: renderer.renderError };
    } finally {
      renderer.gpu.render = originalRender;
    }
  });
  await page.screenshot({ path: `${out}/ground-top-after.png` });
  report.restored = await page.evaluate(() => {
    const game = window.__wireTheHouse;
    const light = game.renderer.scene.children.find(object => object.isLight && object.castShadow);
    game.levelEditor.close();
    return { autoUpdate: light.shadow.autoUpdate, needsUpdate: light.shadow.needsUpdate,
      editorActive: game.levelEditor.active };
  });
  assert.equal(report.measurement.opening.autoUpdate, false, 'Editor should cache shadows');
  assert.equal(report.measurement.opening.needsUpdate, false, 'Initial editor shadow pass should settle');
  assert(report.measurement.cached.length >= 3 && report.measurement.uncached.length >= 3);
  const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
  report.measurement.meanCached = mean(report.measurement.cached);
  report.measurement.meanUncached = mean(report.measurement.uncached);
  assert(report.measurement.meanCached < report.measurement.meanUncached * .85,
    'Caching did not reduce steady shadow render work');
  assert.equal(report.measurement.afterEdit.needsUpdate, true, 'Wall edit did not invalidate shadow');
  assert.equal(report.measurement.afterEditRender.needsUpdate, false, 'Wall edit shadow did not refresh');
  assert(Math.max(...report.measurement.editDraws) > report.measurement.meanCached + 100,
    'Wall edit did not render a new shadow map');
  assert.equal(report.measurement.afterFloorChange.needsUpdate, true, 'Floor switch did not invalidate shadow');
  assert.equal(report.measurement.afterFloorRender.needsUpdate, false, 'Floor switch shadow did not refresh');
  assert.equal(report.restored.autoUpdate, true, 'Gameplay shadow auto-update not restored');
  assert.equal(report.restored.editorActive, false);
  assert.equal(report.measurement.renderError, '');
  assert.deepEqual(report.errors, []);
  await context.close();
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report));
