import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { routeBuildingDist } from './building-qa-utils.mjs';
import { blockPointerLock } from './browser-safety.mjs';
import { saveEditorLevel } from './editor-navigation.mjs';

const { launchManagedBrowser, runManagedClient } = await import(pathToFileURL(path.join(os.homedir(),
  '.codex/skills/develop-web-game/scripts/browser_lifecycle.mjs')).href);
const renderer = process.env.QA_RENDERER ?? 'webgl';
const label = process.env.QA_LABEL ?? 'candidate';
const out = `output/editor-gizmo-drag/${label}-${renderer}`;
const base = process.env.QA_URL ?? 'http://127.0.0.1:5365/Electrical-Game/';
const url = `${base}?mansion=preview&editor=1&renderer=${renderer}`;
const report = { url, renderer, errors: [], modes: [] };
await mkdir(out, { recursive: true });
const session = await launchManagedBrowser(chromium, { channel: 'chrome', headless: true, screenshotDir: out });
async function snapshot(page, id) {
  return page.evaluate(id => {
    const g = window.__wireTheHouse, e = g.levelEditor, o = id ? g.room.mansionWing.editableAssets.get(id) : e.selected;
    return { name: o?.name, position: o?.position.toArray(), rotation: o?.rotation.toArray(), scale: o?.scale.toArray(),
      axis: e.gizmo.axis, dragging: e.gizmo.dragging, camera: e.camera.position.toArray(),
      webGPU: g.renderer.gpu.backend.isWebGPUBackend === true,
      columns: [...g.room.mansionWing.editableAssets.values()].filter(a => a.name.includes(':column:')).map(a =>
        ({ name: a.name, position: a.position.toArray(), rotation: a.rotation.toArray(), scale: a.scale.toArray() })) };
  }, id);
}
async function aimAndSelect(page) {
  const point = await page.evaluate(() => {
    const e = window.__wireTheHouse.levelEditor;
    e.setViewMode('3d'); e.setFloorIndex(-1);
    e.camera.position.set(3.8, 8.5, 28); e.orbit.target.set(13, 3.6, 11); e.orbit.update();
    e.camera.updateMatrixWorld();
    const v = e.camera.position.clone().set(9, 4.3, 16).project(e.camera);
    const r = document.querySelector('#game-canvas').getBoundingClientRect();
    return { x: r.x + (v.x + 1) * r.width / 2, y: r.y + (1 - v.y) * r.height / 2 };
  });
  await page.waitForTimeout(350); await page.mouse.click(point.x, point.y);
}
async function handlePoints(page, axis) {
  return page.evaluate(axis => {
    const e = window.__wireTheHouse.levelEditor, control = e.gizmo;
    const r = document.querySelector('#game-canvas').getBoundingClientRect();
    const points = [];
    // Read the visible geometry only. Updating the invisible picker's matrices
    // here would accidentally repair the regression that this test must catch.
    for (const h of control._gizmo.gizmo[control.mode].children) {
      if (!h.visible || h.name !== axis || !h.isMesh) continue;
      const a = h.geometry.attributes.position;
      for (let i = 0; i < a.count; i += Math.max(1, Math.floor(a.count / 24))) {
        const v = e.camera.position.clone().fromBufferAttribute(a, i).applyMatrix4(h.matrixWorld).project(e.camera);
        points.push({ x: r.x + (v.x + 1) * r.width / 2, y: r.y + (1 - v.y) * r.height / 2 });
      }
    }
    return points;
  }, axis);
}
try {
  await runManagedClient(session, 300000, async () => {
    const context = await session.browser.newContext({ viewport: { width: 1325, height: 1092 }, deviceScaleFactor: 1 });
    if (!process.env.QA_URL) await routeBuildingDist(context);
    await blockPointerLock(context);
    await context.route('**/__wire-house-mansion-level*', route => route.fulfill({ status: 200, contentType: 'application/json',
      body: route.request().method() === 'POST' ? '{}' : '[]' }));
    const page = await context.newPage();
    page.on('pageerror', e => report.errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 120000 });
    await page.waitForTimeout(1000); await aimAndSelect(page);
    report.initial = await snapshot(page);
    await page.screenshot({ path: `${out}/selection.png` });
    for (const [mode, axis, field] of [['translate', 'X', 'position'], ['rotate', 'Y', 'rotation'], ['scale', 'X', 'scale']]) {
      await page.locator(`#level-${mode}`).click(); await page.waitForTimeout(250);
      const before = await snapshot(page), points = await handlePoints(page, axis);
      let point;
      for (const p of points) {
        await page.mouse.move(p.x, p.y);
        if (await page.evaluate(axis => window.__wireTheHouse.levelEditor.gizmo.axis === axis, axis)) { point = p; break; }
      }
      const entry = { mode, axis, before, candidates: points.length, point };
      report.modes.push(entry);
      await page.screenshot({ path: `${out}/${mode}-before.png` });
      if (!point) { entry.failure = 'Visible handle cannot be hovered'; continue; }
      await page.mouse.down(); entry.down = await snapshot(page);
      await page.mouse.move(point.x + 72, point.y - 36, { steps: 16 });
      entry.during = await snapshot(page); await page.mouse.up(); await page.waitForTimeout(300);
      entry.after = await snapshot(page);
      await page.screenshot({ path: `${out}/${mode}-after.png` });
      assert(entry.down.dragging, `${mode}: native drag must begin`);
      assert.notDeepEqual(entry.after[field], before[field], `${mode}: native drag must change ${field}`);
      assert.deepEqual(entry.after.camera, before.camera, `${mode}: drag must not orbit the camera`);
      assert.equal(entry.after.name, before.name, `${mode}: drag must retain selection`);
      for (const other of before.columns.filter(c => c.name !== before.name))
        assert.deepEqual(entry.after.columns.find(c => c.name === other.name), other, `${mode}: another column changed`);
      await page.locator('#level-undo').focus(); await page.keyboard.press('Control+z');
      assert.deepEqual((await snapshot(page, before.name))[field], before[field], `${mode}: undo`);
      await page.keyboard.press('Control+Shift+z');
      assert.deepEqual((await snapshot(page, before.name))[field], entry.after[field], `${mode}: redo`);
      const selectionPoint = await page.evaluate(id => {
        const g = window.__wireTheHouse, e = g.levelEditor, o = g.room.mansionWing.editableAssets.get(id);
        const v = o.localToWorld(e.camera.position.clone().set(0, 1, 0)).project(e.camera);
        const r = document.querySelector('#game-canvas').getBoundingClientRect();
        return { x: r.x + (v.x + 1) * r.width / 2, y: r.y + (1 - v.y) * r.height / 2 };
      }, before.name);
      await page.mouse.click(selectionPoint.x, selectionPoint.y);
      assert.equal((await snapshot(page)).name, before.name, `${mode}: select the transformed column again`);
    }
    assert(report.modes.every(m => !m.failure), 'Every visible gizmo mode must accept native pointer input');
    const final = await snapshot(page); await saveEditorLevel(page);
    await page.reload(); await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 120000 });
    const saved = await page.evaluate(id => {
      const o = window.__wireTheHouse.room.mansionWing.editableAssets.get(id);
      return { position: o.position.toArray(), rotation: o.rotation.toArray(), scale: o.scale.toArray() };
    }, final.name);
    for (const field of ['position', 'rotation', 'scale']) assert.deepEqual(saved[field], final[field], `Reload ${field}`);
    report.saved = saved;
    assert.deepEqual(report.errors, []);
    console.log(JSON.stringify({ ok: true, out, renderer, modes: report.modes.map(m => m.mode), saved }));
  });
} finally { await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); }
