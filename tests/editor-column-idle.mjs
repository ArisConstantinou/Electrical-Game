import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { routeBuildingDist } from './building-qa-utils.mjs';
import { blockPointerLock } from './browser-safety.mjs';
import { openEditorDetails, saveEditorLevel } from './editor-navigation.mjs';

const { launchManagedBrowser, runManagedClient } = await import(pathToFileURL(path.join(os.homedir(),
  '.codex/skills/develop-web-game/scripts/browser_lifecycle.mjs')).href);
const baseline = process.argv.includes('--before');
const renderer = process.env.QA_RENDERER ?? 'webgl';
const out = `output/editor-column-idle/${process.env.QA_LABEL ?? (baseline ? 'before' : process.env.QA_LIVE === '1' ? 'live' : 'candidate')}${renderer === 'webgl' ? '' : `-${renderer}`}`;
await mkdir(out, { recursive: true });
const report = { errors: [], baseline, renderer, samples: {} };
const session = await launchManagedBrowser(chromium, { channel: 'chrome', headless: true, screenshotDir: out });
const url = `${process.env.QA_URL ?? 'http://127.0.0.1:5365/Electrical-Game/'}?mansion=preview&editor=1&renderer=${renderer}`;
const legacyId = 'site-asset:continuous-reinforced-concrete-court-edge-columns:1';
async function setup(context) {
  if (!process.env.QA_URL) await routeBuildingDist(context);
  await blockPointerLock(context);
  // Exercise real browser persistence without writing to the shared checkout.
  await context.route('**/__wire-house-mansion-level*', route => route.fulfill({
    status: 200, contentType: 'application/json', body: route.request().method() === 'POST' ? '{}' : '[]',
  }));
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__wireTheHouse?.levelEditor.active, null, { timeout: 120000 });
  await page.waitForTimeout(1000);
  return page;
}
async function aim(page) {
  return page.evaluate(() => {
    const e = window.__wireTheHouse.levelEditor;
    e.setViewMode('3d'); e.setFloorIndex(-1);
    e.camera.position.set(3.8, 8.5, 28); e.orbit.target.set(13, 3.6, 11); e.orbit.update();
    e.camera.updateMatrixWorld();
    const v = e.camera.position.clone().set(9, 4.3, 16).project(e.camera);
    const rect = document.querySelector('#game-canvas').getBoundingClientRect();
    return { x: rect.x + (v.x + 1) * rect.width / 2, y: rect.y + (1 - v.y) * rect.height / 2 };
  });
}
async function state(page) {
  return page.evaluate(legacyId => {
    const g = window.__wireTheHouse, e = g.levelEditor, wing = g.room.mansionWing;
    const colliders = wing.obstaclesAt(0);
    const columns = [...wing.editableAssets.values()].filter(o => o.name.startsWith(legacyId + ':column:'));
    const selected = e.selected, size = selected ? e.gizmoBounds.clone().setFromObject(selected)
      .getSize(e.camera.position.clone()).toArray() : null;
    return { selected: selected?.name, selectedCount: e.selectedObjects.size, size,
      webGPU: g.renderer.gpu.backend.isWebGPUBackend === true,
      columns: columns.map((o, index) => ({ id: o.name, local: o.position.toArray(),
        world: o.getWorldPosition(e.camera.position.clone()).toArray(), scale: o.scale.toArray(), yaw: o.rotation.y,
        collider: colliders.find(c => c.id === `court-structural-column-${index}`) })), renderError: g.renderer.renderError };
  }, legacyId);
}
async function measure(page) {
  return page.evaluate(async () => {
    const g = window.__wireTheHouse, r = g.renderer, original = r.render;
    const samples = [], intervals = []; let last = performance.now();
    r.render = function (...args) {
      const now = performance.now(), dirty = r.materialsDirty, shadow = g.room.sun.shadow.needsUpdate;
      intervals.push(now - last); last = now;
      const start = performance.now(), result = original.apply(this, args);
      samples.push({ dirty, shadow, cpuMs: performance.now() - start, draws: r.webgl.info.render.calls });
      return result;
    };
    try {
      // Reload can still be compiling/fencing WebGPU frames after the editor
      // opens. A zero-render interval is not evidence of efficient rendering.
      const deadline = performance.now() + 20000;
      while (samples.length < 5 && performance.now() < deadline)
        await new Promise(resolve => setTimeout(resolve, 50));
      if (samples.length < 5) throw new Error('Editor did not present enough frames for measurement');
      samples.length = 0; intervals.length = 0; last = performance.now();
      await new Promise(resolve => setTimeout(resolve, 1600));
      if (samples.length < 5) throw new Error('Insufficient rendered frames in the performance sample');
      const sorted = intervals.slice(1).sort((a, b) => a - b);
      const cpu = samples.map(s => s.cpuMs).sort((a, b) => a - b);
      return { renders: samples.length, draws: samples.slice(-6).map(s => s.draws),
        shadowUpdates: samples.filter(s => s.shadow).length, materialUpdates: samples.filter(s => s.dirty).length,
        frameP95: sorted[Math.floor(sorted.length * .95)], frameMax: sorted.at(-1),
        renderCpuP95: cpu[Math.floor(cpu.length * .95)] };
    } finally { r.render = original; }
  });
}
function collidersFollow(state) {
  for (const c of state.columns) {
    assert(c.collider, c.id + ' has no collision');
    assert(Math.abs((c.collider.minX + c.collider.maxX) / 2 - c.world[0]) < .001, 'Column collider X detached');
    assert(Math.abs((c.collider.minZ + c.collider.maxZ) / 2 - c.world[2]) < .001, 'Column collider Z detached');
  }
}
try {
  await runManagedClient(session, 300000, async () => {
    const context = await session.browser.newContext({ viewport: { width: 1237, height: 1039 }, deviceScaleFactor: 1 });
    const page = await setup(context), point = await aim(page);
    await page.waitForTimeout(350); await page.mouse.click(point.x, point.y);
    report.initial = await state(page);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${out}/column-click.png` });
    await page.waitForTimeout(500);
    report.samples.idle = await measure(page);
    assert.equal(report.initial.selectedCount, 1);
    assert(report.initial.size?.[0] < .5 && report.initial.size[2] < .5,
      'A native click must select one column, not the bounds of the courtyard');
    assert.equal(report.initial.columns.length, 7);
    collidersFollow(report.initial);
    assert(report.samples.idle.shadowUpdates <= 1, 'Idle editor regenerates its static shadows');
    assert(report.samples.idle.materialUpdates <= 1, 'Idle editor re-prepares unchanged scene materials');
    const originalDocument = await page.evaluate(() => window.__wireTheHouse.levelEditor.document());
    const selectedIndex = report.initial.columns.findIndex(c => c.id === report.initial.selected);
    const originalColumn = report.initial.columns[selectedIndex];
    await openEditorDetails(page);
    const input = page.locator('[data-axis="x"]');
    await input.fill(String(originalColumn.local[0] + .5)); await input.dispatchEvent('change');
    const width = page.locator('[data-size="x"]'); await width.fill('0.5'); await width.dispatchEvent('change');
    const yaw = page.locator('#level-yaw'); await yaw.fill('30'); await yaw.dispatchEvent('change');
    await page.locator('#level-name').click();
    report.edited = await state(page);
    collidersFollow(report.edited);
    for (let i = 0; i < 7; i++) {
      if (i === selectedIndex) continue;
      assert.deepEqual(report.edited.columns[i], report.initial.columns[i], 'Editing moved another column');
    }
    assert(Math.abs(report.edited.columns[selectedIndex].world[0] - originalColumn.world[0] - .5) < .001);
    assert(Math.abs(report.edited.columns[selectedIndex].yaw - Math.PI / 6) < .001);
    assert(Math.abs(report.edited.columns[selectedIndex].scale[0] * .34 - .5) < .001);
    // Scene shortcuts deliberately leave text-input undo to the browser.
    await page.locator('#level-undo').focus();
    report.undoBefore = await page.evaluate(() => { const e = window.__wireTheHouse.levelEditor;
      return { focus: document.activeElement.tagName, index: e.historyIndex, labels: e.historyLabels,
        recent: e.history.slice(-4).map(doc => doc.assets.filter(a => a.id.endsWith(':column:5'))) }; });
    await page.keyboard.press('Control+z');
    report.undone = await state(page);
    assert(Math.abs(report.undone.columns[selectedIndex].yaw) < .001, 'Undo did not restore the column');
    await page.keyboard.press('Control+y');
    assert.deepEqual((await state(page)).columns, report.edited.columns, 'Redo did not restore the edited column');
    const editedDocument = await page.evaluate(() => window.__wireTheHouse.levelEditor.document());
    report.legacy = await page.evaluate(({ doc, legacyId }) => {
      const g = window.__wireTheHouse, e = g.levelEditor;
      doc.assets = doc.assets.filter(a => !a.id.startsWith(legacyId + ':column:'));
      const parent = doc.assets.find(a => a.id === legacyId);
      parent.position[0] += .75; parent.rotationY = .2; parent.scale = [1.1, 1, .9];
      doc.groups = [{ id: 'legacy-column-group', name: 'Saved columns', members: [legacyId, doc.walls[0].id] }];
      e.applyDocument(doc);
      const container = g.room.mansionWing.editableAssets.get(legacyId); container.updateWorldMatrix(true, true);
      const children = container.children.filter(c => c.userData.levelEditorDefaultPosition);
      return { selectable: e.editables().includes(container), groupMembers: e.groups.get('legacy-column-group').members,
        errors: children.map(c => ({ local: c.position.distanceTo(c.position.clone().fromArray(c.userData.levelEditorDefaultPosition)),
          world: c.getWorldPosition(c.position.clone()).distanceTo(c.position.clone().fromArray(c.userData.levelEditorDefaultPosition).applyMatrix4(container.matrixWorld)) })) };
    }, { doc: originalDocument, legacyId });
    assert.equal(report.legacy.selectable, false);
    assert.equal(report.legacy.groupMembers.length, 8);
    assert(report.legacy.errors.every(e => e.local < .00001 && e.world < .00001), 'Legacy transforms did not migrate');
    collidersFollow(await state(page));
    await page.evaluate(doc => window.__wireTheHouse.levelEditor.applyDocument(doc), editedDocument);
    await saveEditorLevel(page);
    await page.waitForFunction(() => new URL(location.href).searchParams.has('level'));
    await page.reload(); await page.waitForFunction(() => window.__wireTheHouse?.levelEditor.active, null, { timeout: 120000 });
    report.reloaded = await state(page);
    assert.deepEqual(report.reloaded.columns, report.edited.columns, 'Saved column edit changed on reload');
    collidersFollow(report.reloaded);
    await page.waitForTimeout(600);
    report.samples.reloaded = await measure(page);
    assert(report.samples.reloaded.shadowUpdates <= 1 && report.samples.reloaded.materialUpdates <= 1);
    const camera = await page.evaluate(() => window.__wireTheHouse.levelEditor.camera.position.toArray());
    await page.mouse.move(65, 140); await page.mouse.down(); await page.mouse.move(180, 200, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(600);
    assert.notDeepEqual(await page.evaluate(() => window.__wireTheHouse.levelEditor.camera.position.toArray()), camera);
    report.samples.orbitSettled = await measure(page);
    assert(report.samples.orbitSettled.shadowUpdates <= 1, 'Orbit unnecessarily regenerates static shadows');
    report.mutation = await page.evaluate(() => {
      const g = window.__wireTheHouse, e = g.levelEditor;
      e.setFloorIndex(0);
      const floor = g.room.sun.shadow.needsUpdate;
      g.room.sun.shadow.needsUpdate = false;
      const wall = [...g.room.mansionWing.editableWalls.values()][0]; wall.position.x += .1;
      e.recordHistory();
      const edit = g.room.sun.shadow.needsUpdate, material = g.renderer.materialsDirty;
      e.close();
      return { floor, edit, material, closed: !e.active, exitShadow: g.room.sun.shadow.needsUpdate, renderError: g.renderer.renderError };
    });
    assert(report.mutation.floor && report.mutation.edit && report.mutation.material && report.mutation.closed && report.mutation.exitShadow);
    assert.equal(report.mutation.renderError, '');
    await context.close();
    const touchContext = await session.browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    const touch = await setup(touchContext), tap = await aim(touch);
    await touch.waitForTimeout(350); await touch.touchscreen.tap(tap.x, tap.y);
    report.touch = await state(touch);
    assert.equal(report.touch.selected, report.initial.selected);
    assert(report.touch.size[0] < .5 && report.touch.size[2] < .5);
    await touch.screenshot({ path: `${out}/touch-column.png` });
    await touchContext.close();
    assert.deepEqual(report.errors, []);
  });
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify({ ...report, browser: session.report }, null, 2));
  console.log(JSON.stringify({ selected: report.initial?.selected, samples: report.samples,
    errors: report.errors, closed: session.report.closed, remainingPids: session.report.remainingPids }));
}
