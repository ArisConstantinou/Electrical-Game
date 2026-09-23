import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openEditorBrowser, openEditorBuild, openEditorDetails, openEditorScene, saveEditorLevel } from './editor-navigation.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const root = new URL('../artifacts/site-pro-04/review/level-editor/', import.meta.url);
const sidecar = new URL('../.studio/mansion-level.json', import.meta.url);
const priorSidecar = await readFile(sidecar).catch(() => null);
await mkdir(root, { recursive: true });
const errors = [];
const run = async (name, viewport, mobile) => {
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(`${name}: ${error.message}`));
  await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&renderer=webgl', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 120_000 });
  await page.locator('#start-level-editor').click();
  await page.waitForFunction(() => window.__wireTheHouse?.levelEditor.active);
  assert(await page.locator('#level-editor').isVisible());
  assert((await page.locator('#level-list button').count()) > 10);
  await openEditorBrowser(page);
  await page.locator('#level-filter').selectOption('floor');
  assert((await page.locator('#level-list button').allTextContents()).every(name => name.startsWith('Floor slab')));
  await page.locator('#level-filter').selectOption('all');
  await openEditorBuild(page);
  await page.locator('#level-add-brick').click();
  await openEditorDetails(page);
  await page.locator('[data-axis="x"]').fill('12.5');
  await page.locator('[data-axis="x"]').dispatchEvent('change');
  await page.locator('#level-undo').click();
  assert.notEqual(await page.locator('[data-axis="x"]').inputValue(), '12.50');
  await page.locator('#level-redo').click();
  assert.equal(await page.locator('[data-axis="x"]').inputValue(), '12.50');
  await openEditorBrowser(page);
  const builtInBefore = await page.evaluate(() => {
    const wing = window.__wireTheHouse.room.mansionWing;
    return wing.obstaclesAt(0).find(item => item.id === 'Passage west fired-clay partition').minX;
  });
  await page.locator('#level-list button').first().click();
  await openEditorDetails(page);
  await page.locator('#level-focus').click();
  const focused = await page.evaluate(() => {
    const editor = window.__wireTheHouse.levelEditor;
    return { target: editor.orbit.target.toArray(), selected: editor.gizmo.object?.position.toArray() };
  });
  assert(focused.selected && Math.abs(focused.target[0] - focused.selected[0]) < .001 && Math.abs(focused.target[2] - focused.selected[2]) < .001);
  const builtInX = Number(await page.locator('[data-axis="x"]').inputValue());
  await page.locator('[data-axis="x"]').fill(String(builtInX + .5));
  await page.locator('[data-axis="x"]').dispatchEvent('change');
  const builtInAfter = await page.evaluate(() => window.__wireTheHouse.room.mansionWing.obstaclesAt(0).find(item => item.id === 'Passage west fired-clay partition').minX);
  assert(Math.abs(builtInAfter - builtInBefore - .5) < .001);
  await openEditorBuild(page);
  await page.locator('#level-add-floor').click();
  await openEditorDetails(page);
  await page.locator('[data-axis="x"]').fill('20');
  await page.locator('[data-axis="x"]').dispatchEvent('change');
  await page.locator('[data-axis="z"]').fill('2');
  await page.locator('[data-axis="z"]').dispatchEvent('change');
  await openEditorBuild(page);
  await page.locator('#level-add-stair').click();
  await openEditorDetails(page);
  await page.locator('[data-axis="x"]').fill('20');
  await page.locator('[data-axis="x"]').dispatchEvent('change');
  await page.locator('[data-axis="z"]').fill('10');
  await page.locator('[data-axis="z"]').dispatchEvent('change');
  await openEditorScene(page);
  await page.locator('#level-player').click();
  await openEditorDetails(page);
  await page.locator('[data-axis="x"]').fill('-1.5');
  await page.locator('[data-axis="x"]').dispatchEvent('change');
  await openEditorScene(page);
  await page.locator('#level-apprentice-index').selectOption('3');
  await page.locator('#level-apprentice').click();
  await openEditorDetails(page);
  await page.locator('[data-axis="x"]').fill('3.3');
  await page.locator('[data-axis="x"]').dispatchEvent('change');
  await page.locator('#level-yaw').fill('90');
  await page.locator('#level-yaw').dispatchEvent('change');
  if (mobile) await page.screenshot({ path: fileURLToPath(new URL(`${name}-edit.png`, root)), fullPage: true });
  await saveEditorLevel(page);
  await page.waitForFunction(() => document.querySelector('#level-status')?.textContent?.includes('saved separately'));
  const slotId = new URL(page.url()).searchParams.get('level');
  assert.match(slotId, /^[0-9a-f-]{36}$/i);
  const before = await page.evaluate(() => {
    const game = window.__wireTheHouse;
    const wall = [...game.room.mansionWing.editableWalls.values()].filter(item => item.name.startsWith('Editor brick-wall')).at(-1);
    return { name: wall.name, x: wall.position.x, hit: game.room.mansionWing.obstaclesAt(0).find(item => item.id === wall.name),
      floors: game.room.mansionWing.editableSurfaces.size, floorHeight: game.room.mansionWing.surfaceHeight(20, 2, 3.3), stairHeight: game.room.mansionWing.surfaceHeight(20, 8.6, 0),
      playerX: game.renderer.camera.position.x, apprentice3X: game.apprentice.editorStart(3).x, apprentice3Yaw: game.apprentice.editorStartYaw(3), builtInX: game.room.mansionWing.obstaclesAt(0).find(item => item.id === 'Passage west fired-clay partition').minX, saved: Boolean(localStorage.getItem('wirehouse:level-editor:slot:' + new URL(location.href).searchParams.get('level'))), renderError: game.renderer.renderError };
  });
  assert.equal(before.x, 12.5);
  assert(before.hit.minX > 10 && before.hit.maxX > 12.5);
  assert(before.floors >= 2);
  assert.equal(before.floorHeight, 0);
  assert(before.stairHeight > 0 && before.stairHeight < .4);
  assert.equal(before.playerX, -1.5);
  assert.equal(before.apprentice3X, 3.3);
  assert(Math.abs(before.apprentice3Yaw - Math.PI / 2) < .001);
  assert(before.saved);
  assert.equal(before.renderError, '');
  await page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, root)), fullPage: true });
  if (mobile) {
    await page.locator('.level-editor__bottom-nav [data-editor-tab="starts"]').click();
    await page.locator('#level-scene-settings').click();
    await page.locator('#level-nav-mode').selectOption('wheel');
    assert(await page.locator('#level-wheel-toggle').isVisible());
    assert(!(await page.locator('.level-editor__bottom-nav').isVisible()));
    await page.locator('#level-wheel-toggle').click();
    await page.locator('.level-editor__wheel [data-editor-tab="select"]').click();
    assert.equal(await page.locator('#level-editor').getAttribute('data-tab'), 'select');
    await page.locator('#level-nav-mode').selectOption('bottom');
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 120_000 });
  const after = await page.evaluate(() => {
    const game = window.__wireTheHouse;
    const wall = [...game.room.mansionWing.editableWalls.values()].filter(item => item.name.startsWith('Editor brick-wall')).at(-1);
    return { name: wall?.name, x: wall?.position.x, collision: game.room.mansionWing.obstaclesAt(0).find(item => item.id === wall?.name),
      floors: game.room.mansionWing.editableSurfaces.size, floorHeight: game.room.mansionWing.surfaceHeight(20, 2, 3.3), stairHeight: game.room.mansionWing.surfaceHeight(20, 8.6, 0), playerX: game.renderer.camera.position.x, apprentice3X: game.apprentice.editorStart(3).x, apprentice3Yaw: game.apprentice.editorStartYaw(3), builtInX: game.room.mansionWing.obstaclesAt(0).find(item => item.id === 'Passage west fired-clay partition').minX, renderError: game.renderer.renderError };
  });
  assert.equal(after.name, before.name);
  assert.equal(after.x, 12.5);
  assert(after.collision);
  assert.equal(after.floors, before.floors);
  assert.equal(after.floorHeight, before.floorHeight);
  assert(before.stairHeight === after.stairHeight);
  assert.equal(after.playerX, -1.5);
  assert.equal(after.apprentice3X, 3.3);
  assert(Math.abs(after.apprentice3Yaw - Math.PI / 2) < .001);
  assert.equal(after.builtInX, before.builtInX);
  assert.equal(after.renderError, '');
  await context.close();
  await rm(new URL(`../.studio/levels/${slotId}.json`, import.meta.url), { force: true });
  return { name, wall: before.name, initialCollision: before.hit, restoredCollision: after.collision };
};

try {
  const layouts = [['desktop', { width: 1440, height: 900 }, false], ['mobile-portrait', { width: 390, height: 844 }, true], ['tablet-portrait', { width: 820, height: 1180 }, true]];
  const results = [];
  for (const [name, viewport, mobile] of layouts) if (!process.env.QA_PLATFORM || process.env.QA_PLATFORM === name) results.push(await run(name, viewport, mobile));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ pass: true, results, errors }, null, 2));
} finally {
  await browser.close();
  if (priorSidecar === null) await rm(sidecar, { force: true });
  else await writeFile(sidecar, priorSidecar);
}
