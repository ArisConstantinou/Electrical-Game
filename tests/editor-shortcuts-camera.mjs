import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { openEditorBuild, openEditorDetails } from './editor-navigation.mjs';

const output = new URL('../artifacts/editor-shortcuts-camera/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&editor=1&renderer=webgl');
  await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 120_000 });
  const state = () => page.evaluate(() => {
    const game = window.__wireTheHouse;
    const editor = game.levelEditor;
    const added = [...game.room.mansionWing.editableWalls.values()].filter(wall => wall.name.startsWith('Editor brick-wall'));
    return { camera: editor.camera.position.toArray(), target: editor.orbit.target.toArray(), view: editor.panel.dataset.view,
      leftButton: editor.orbit.mouseButtons.LEFT, names: added.map(wall => wall.name), positions: added.map(wall => wall.position.toArray()),
      historyIndex: editor.historyIndex, historyLength: editor.history.length, renderError: game.renderer.renderError };
  });
  const initial = await state();
  assert.equal(initial.view, '3d');
  assert.equal(initial.leftButton, 0);
  await page.screenshot({ path: fileURLToPath(new URL('before-orbit.png', output)) });
  await page.mouse.move(980, 360);
  await page.mouse.down();
  await page.mouse.move(1120, 440, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const orbited = await state();
  assert(Math.hypot(...orbited.camera.map((value, index) => value - initial.camera[index])) > 2);
  assert.deepEqual(orbited.target, initial.target);
  await page.screenshot({ path: fileURLToPath(new URL('after-orbit.png', output)) });

  await openEditorBuild(page);
  await page.locator('#level-add-brick').click();
  const created = await state();
  assert.equal(created.names.length, 1);
  await openEditorDetails(page);
  assert(await page.locator('#level-copy').isEnabled());
  await page.locator('#level-copy').click();
  await page.locator('#level-paste').click();
  const pasted = await state();
  assert.equal(pasted.names.length, 2);
  assert.notEqual(pasted.names[0], pasted.names[1]);
  assert.equal(pasted.positions[1][0] - pasted.positions[0][0], .5);
  assert.equal(pasted.positions[1][2] - pasted.positions[0][2], .5);
  assert.equal(pasted.historyLength, created.historyLength + 1);
  assert((await page.locator('#level-history-list button').allTextContents()).some(item => item.includes('Duplicate 1 structure')));
  await page.keyboard.press('Control+z');
  assert.equal((await state()).names.length, 1);
  await page.keyboard.press('Control+Shift+z');
  assert.equal((await state()).names.length, 2);
  await page.keyboard.press('Delete');
  assert.equal((await state()).names.length, 1);
  await page.keyboard.press('Control+y');
  assert.equal((await state()).names.length, 1);
  await page.keyboard.press('Control+z');
  assert.equal((await state()).names.length, 2);
  await openEditorDetails(page);
  await page.locator('.level-editor__history-log summary').click();
  await page.locator('#level-history-list button').nth(created.historyIndex).click();
  assert.equal((await state()).names.length, 1);
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  assert.equal((await state()).names.length, 2);
  await page.keyboard.press('Control+z');
  assert.equal((await state()).names.length, 1);
  await openEditorDetails(page);
  await page.screenshot({ path: fileURLToPath(new URL('history-and-actions.png', output)) });
  assert.equal((await state()).renderError, '');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ pass: true, initialView: initial.view, cameraMoved: orbited.camera,
    created: created.names.length, pasted: pasted.names.length, history: pasted.historyLength, errors }));
  await page.close();
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  mobile.on('pageerror', error => errors.push(error.message));
  await mobile.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&editor=1&renderer=webgl');
  await mobile.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 120_000 });
  const mobileCameraBefore = await mobile.evaluate(() => window.__wireTheHouse.levelEditor.camera.position.toArray());
  const touch = await mobile.context().newCDPSession(mobile);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 320, y: 240, id: 1 }] });
  for (let step = 1; step <= 6; step++) await touch.send('Input.dispatchTouchEvent', {
    type: 'touchMove', touchPoints: [{ x: 320 - step * 7, y: 240 + step * 6, id: 1 }],
  });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await mobile.waitForTimeout(250);
  const mobileCameraAfter = await mobile.evaluate(() => window.__wireTheHouse.levelEditor.camera.position.toArray());
  assert(Math.hypot(...mobileCameraAfter.map((value, index) => value - mobileCameraBefore[index])) > .1,
    'Mobile one-finger drag must rotate the 3D camera');
  const mobileWallCount = () => mobile.evaluate(() => [...window.__wireTheHouse.room.mansionWing.editableWalls.keys()]
    .filter(name => name.startsWith('Editor brick-wall')).length);
  await openEditorBuild(mobile);
  await mobile.locator('#level-add-brick').tap();
  assert.equal(await mobileWallCount(), 1);
  await openEditorDetails(mobile);
  await mobile.locator('#level-copy').scrollIntoViewIfNeeded();
  assert(await mobile.locator('#level-copy').isVisible());
  assert(await mobile.locator('#level-paste').isVisible());
  assert(await mobile.locator('#level-delete').isVisible());
  await mobile.locator('#level-copy').tap();
  await mobile.locator('#level-paste').tap();
  assert.equal(await mobileWallCount(), 2);
  await openEditorDetails(mobile);
  await mobile.locator('#level-undo').tap();
  assert.equal(await mobileWallCount(), 1);
  await mobile.locator('#level-redo').tap();
  assert.equal(await mobileWallCount(), 2);
  await mobile.locator('#level-delete').tap();
  assert.equal(await mobileWallCount(), 1);
  await openEditorDetails(mobile);
  await mobile.locator('#level-undo').tap();
  assert.equal(await mobileWallCount(), 2);
  await mobile.locator('.level-editor__history-log summary').tap();
  await mobile.locator('#level-history-list button').nth(1).tap();
  assert.equal(await mobileWallCount(), 1);
  await openEditorDetails(mobile);
  await mobile.screenshot({ path: fileURLToPath(new URL('mobile-actions.png', output)) });
  assert.deepEqual(errors, []);
  await mobile.close();
} finally { await browser.close(); }
