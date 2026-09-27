import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { routeBuildingDist } from './building-qa-utils.mjs';
import { blockPointerLock } from './browser-safety.mjs';
import { openEditorBuild, openEditorTab } from './editor-navigation.mjs';

const baseline = process.argv.includes('--baseline');
const baseURL = process.env.QA_EDITOR_URL ?? 'http://127.0.0.1:5365/Electrical-Game/';
const output = path.resolve(process.env.QA_EDITOR_OUTPUT ?? 'output/editor-menu-return');
await mkdir(output, { recursive: true });
const { launchManagedBrowser, runManagedClient } = await import(pathToFileURL(path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'), 'skills/develop-web-game/scripts/browser_lifecycle.mjs')));
const session = await launchManagedBrowser(chromium, { channel: 'chrome', headless: true, screenshotDir: output });
const result = { baseline, cases: [], errors: [] };
await runManagedClient(session, 360000, async () => {
  const context = await session.browser.newContext({ viewport: { width: 1440, height: 900 } });
  await routeBuildingDist(context);
  await blockPointerLock(context);
  // Keep all QA saves inside this browser; never write a test level into the shared project.
  let saveDelay = 0;
  await context.route('**/__wire-house-mansion-level**', async route => {
    if (route.request().method() === 'POST' && saveDelay) await new Promise(resolve => setTimeout(resolve, saveDelay));
    await route.fulfill({ status: 404, body: 'Published browser storage mode' });
  });
  const page = await context.newPage();
  page.on('pageerror', error => result.errors.push(error.message));
  const open = async (query = '') => {
    await page.goto(baseURL + '?mansion=preview&editor=1&renderer=webgl' + query);
    await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 120000 });
    await page.waitForTimeout(350);
  };
  const addWall = async () => { await openEditorBuild(page); await page.locator('#level-add-brick').click(); };
  const menu = async () => {
    await page.waitForURL(url => url.searchParams.get('editor') !== '1');
    await page.waitForFunction(() => window.__wireTheHouse?.loopReady && !window.__wireTheHouse.levelEditor.active, null, { timeout: 120000 });
    await page.locator('#start-screen').waitFor({ state: 'visible' });
  };
  await open();
  result.source = { url: page.url(), scripts: await page.locator('script[src]').evaluateAll(scripts => scripts.map(script => script.src)), environment: 'Chrome on Windows; mobile cases use touch viewport emulation' };
  await page.screenshot({ path: path.join(output, baseline ? 'desktop-before.png' : 'desktop-after.png') });
  await addWall();
  if (baseline) {
    result.missingVisibleBackButton = !await page.locator('#level-close').isVisible();
    await openEditorTab(page, 'starts');
    await page.locator('#level-scene-exit').click();
    result.missingUnsavedPrompt = !await page.locator('#level-exit-dialog').count();
    result.editorClosedWithoutWarning = await page.evaluate(() => !window.__wireTheHouse.levelEditor.active);
    await writeFile(path.join(output, 'baseline.json'), JSON.stringify(result, null, 2));
    assert(result.missingVisibleBackButton && result.missingUnsavedPrompt && result.editorClosedWithoutWarning);
    await context.close();
    return;
  }
  await page.locator('#level-close').click();
  await page.locator('#level-exit-dialog').waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(output, 'desktop-unsaved.png') });
  // Native modal focus and all editor shortcuts must stay inside the prompt.
  await page.keyboard.press('Delete');
  await page.keyboard.press('Control+z');
  assert.equal(await page.evaluate(() => [...window.__wireTheHouse.room.mansionWing.editableWalls.keys()].filter(n => n.startsWith('Editor brick-wall')).length), 1);
  await page.locator('#level-exit-cancel').click();
  assert(await page.locator('#level-editor').isVisible());
  assert.equal(await page.evaluate(() => document.activeElement.id), 'level-close');
  const cameraBefore = await page.evaluate(() => window.__wireTheHouse.levelEditor.camera.position.toArray());
  await page.mouse.move(1200, 180); await page.mouse.down(); await page.mouse.move(1280, 250, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(150);
  const cameraAfter = await page.evaluate(() => window.__wireTheHouse.levelEditor.camera.position.toArray());
  assert(Math.hypot(...cameraAfter.map((value, index) => value - cameraBefore[index])) > .1, 'Camera orbit resumes after cancelling the prompt');
  result.promptCost = await page.evaluate(() => {
    const game = window.__wireTheHouse, editor = game.levelEditor;
    const before = game.renderer.webgl.info.memory.geometries, times = [];
    // Same scene and document: isolate the native prompt from GPU/frame time.
    for (let index = 0; index < 20; index++) {
      const start = performance.now(); editor.requestMainMenu(); times.push(performance.now() - start); editor.cancelMainMenu();
    }
    times.sort((a, b) => a - b);
    return { method: '20 repeated synchronous prompt requests; excludes GPU and compositor timing', p95Ms: times[18], maxMs: times[19], geometriesBefore: before, geometriesAfter: game.renderer.webgl.info.memory.geometries, dialogs: document.querySelectorAll('#level-exit-dialog').length, cameraEnabled: editor.orbit.enabled };
  });
  assert.equal(result.promptCost.geometriesBefore, result.promptCost.geometriesAfter);
  assert.equal(result.promptCost.dialogs, 1);
  assert(result.promptCost.cameraEnabled);
  result.cases.push('unsaved-cancel-preserves-wall-and-focus');

  await page.keyboard.press('Escape');
  await page.locator('#level-exit-dialog').waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  assert(!await page.locator('#level-exit-dialog').isVisible());
  result.cases.push('escape-exit-and-cancel');

  await page.locator('#level-close').click();
  await page.locator('#level-exit-discard').click();
  await menu();
  assert.equal(await page.evaluate(() => [...window.__wireTheHouse.room.mansionWing.editableWalls.keys()].filter(n => n.startsWith('Editor brick-wall')).length), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('wirehouse:level-editor:slots:v1')), null);
  result.cases.push('discard-reloads-main-menu-without-changing-storage');

  await open('&template=blank');
  await page.locator('#level-close').click();
  await page.locator('#level-exit-dialog').waitFor({ state: 'visible' });
  await page.locator('#level-exit-cancel').click();
  await addWall();
  await page.locator('#level-close').click();
  const originalSetItem = await page.evaluate(() => {
    window.__originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('wirehouse:level-editor:')) throw new DOMException('Test storage is full', 'QuotaExceededError');
      return window.__originalSetItem.call(this, key, value);
    };
    return true;
  });
  assert(originalSetItem);
  await page.locator('#level-exit-save').click();
  await page.locator('#level-exit-error').waitFor({ state: 'visible' });
  assert(await page.locator('#level-exit-dialog').isVisible());
  assert.equal(await page.evaluate(() => window.__wireTheHouse.levelEditor.active), true);
  await page.screenshot({ path: path.join(output, 'save-failed.png') });
  await page.evaluate(() => { Storage.prototype.setItem = window.__originalSetItem; });
  result.cases.push('failed-save-keeps-editor-and-shows-error');
  saveDelay = 600;
  await page.locator('#level-exit-save').click();
  await page.waitForFunction(() => window.__wireTheHouse.levelEditor.navigationState.saving);
  await page.keyboard.press('Escape');
  assert(await page.locator('#level-exit-dialog').isVisible());
  assert(await page.locator('#level-exit-save').isDisabled());
  await menu();
  saveDelay = 0;
  result.cases.push('save-in-progress-blocks-duplicate-exit');
  const savedId = new URL(page.url()).searchParams.get('level');
  assert(savedId);
  const saved = await page.evaluate(id => JSON.parse(localStorage.getItem('wirehouse:level-editor:slot:' + id)), savedId);
  assert.equal(saved.template, 'blank');
  assert(saved.walls.some(w => w.id.startsWith('Editor brick-wall')));
  await page.waitForFunction(() => !document.querySelector('#start-level-editor').disabled, null, { timeout: 120000 });
  await page.locator('#start-level-editor').click();
  await page.waitForFunction(() => window.__wireTheHouse.levelEditor.active);
  // Changing a name is persistent even though it is not a history entry.
  await page.evaluate(() => { document.querySelector('#level-slot-name').value = 'Renamed unsaved level'; });
  await page.locator('#level-close').click();
  await page.locator('#level-exit-dialog').waitFor({ state: 'visible' });
  await page.locator('#level-exit-discard').click();
  await menu();
  assert.equal(await page.evaluate(id => JSON.parse(localStorage.getItem('wirehouse:level-editor:slot:' + id)).name, savedId), saved.name);
  result.cases.push('save-persists-new-level-and-discard-preserves-saved-version');

  await page.waitForFunction(() => !document.querySelector('#start-level-editor').disabled, null, { timeout: 120000 });
  await page.locator('#start-level-editor').click();
  await page.waitForFunction(() => window.__wireTheHouse.levelEditor.active);
  await addWall();
  await page.keyboard.press('Control+z');
  await page.locator('#level-close').click();
  await menu();
  result.cases.push('undo-to-saved-state-exits-without-warning');

  // A pristine Basic editor also goes straight back to the menu.
  await open();
  await page.locator('#level-close').click();
  await menu();
  result.cases.push('unchanged-basic-exits-directly');
  await context.close();

  for (const [name, viewport] of Object.entries({ portrait: { width: 390, height: 844 }, landscape: { width: 844, height: 390 } })) {
    const mobile = await session.browser.newContext({ viewport, isMobile: true, hasTouch: true });
    await routeBuildingDist(mobile);
    await blockPointerLock(mobile);
    await mobile.route('**/__wire-house-mansion-level**', route => route.fulfill({ status: 404, body: '' }));
    const phone = await mobile.newPage();
    phone.on('pageerror', error => result.errors.push(error.message));
    await phone.goto(baseURL + '?mansion=preview&editor=1&template=blank&renderer=webgl');
    await phone.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 120000 });
    await phone.screenshot({ path: path.join(output, name + '-editor.png') });
    const box = await phone.locator('#level-close').boundingBox();
    assert(box.width >= 44 && box.height >= 44 && box.x + box.width <= viewport.width);
    await phone.locator('#level-close').tap();
    await phone.locator('#level-exit-dialog').waitFor({ state: 'visible' });
    const dialog = await phone.locator('#level-exit-dialog').boundingBox();
    assert(dialog.x >= 0 && dialog.y >= 0 && dialog.x + dialog.width <= viewport.width + 1 && dialog.y + dialog.height <= viewport.height + 1);
    for (const id of ['save', 'discard', 'cancel']) {
      const button = await phone.locator('#level-exit-' + id).boundingBox();
      assert(button.height >= 44 && button.x + button.width <= viewport.width);
    }
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await phone.screenshot({ path: path.join(output, name + '-unsaved.png') });
    await phone.locator('#level-exit-cancel').tap();
    assert(await phone.locator('#level-editor').isVisible());
    assert.equal(await phone.evaluate(() => window.__wireTheHouse.levelEditor.orbit.enabled), true);
    result.cases.push(name + '-touch-targets-modal-fit-and-cancel');
    await mobile.close();
  }
  assert.deepEqual(result.errors, []);
  result.passed = true;
  await writeFile(path.join(output, 'report.json'), JSON.stringify(result, null, 2));
});
console.log(JSON.stringify(result));
