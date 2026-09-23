import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { blockPointerLock } from './browser-safety.mjs';
import { openEditorBrowser, openEditorDetails, saveEditorLevel } from './editor-navigation.mjs';

const baseline = process.argv.includes('--baseline');
const output = new URL('../artifacts/site-pro-04/review/editor-original-column/', import.meta.url);
const sidecar = new URL('../.studio/mansion-level.json', import.meta.url);
const previous = await readFile(sidecar).catch(() => null);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let slotId = null;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await blockPointerLock(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&editor=1&renderer=webgl');
  await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 120000 });
  const before = await page.evaluate(() => {
    const game = window.__wireTheHouse, editor = game.levelEditor;
    const column = [...game.room.mansionWing.editableAssets.values()]
      .find(item => item.userData.levelEditorLabel === 'Structural concrete column');
    if (!column) throw new Error('Original column is not registered');
    const centre = column.getWorldPosition(new column.position.constructor());
    editor.orbit.target.copy(centre);
    editor.camera.position.copy(centre).add(new centre.constructor(0, .15, 1.2));
    editor.camera.lookAt(centre);
    editor.orbit.update();
    return { id: column.name, x: column.position.x,
      collider: game.room.mansionWing.obstaclesAt(0).find(item => item.id === column.name) ?? null };
  });
  await page.waitForTimeout(100);
  const rect = await page.locator('#game-canvas').boundingBox();
  assert(rect);
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
  const clicked = await page.evaluate(() => window.__wireTheHouse.levelEditor.selected?.name);
  if (baseline && clicked !== before.id) {
    await page.screenshot({ path: fileURLToPath(new URL('before-wrong-pick.png', output)) });
    await openEditorBrowser(page);
    await page.locator('#level-search').fill('Structural concrete column');
    await page.locator('#level-list button').first().click();
  } else assert.equal(clicked, before.id, 'Canvas click must reach the column');
  await openEditorDetails(page);
  const controls = {
    disabled: await page.locator('[data-axis="x"]').isDisabled(),
    kind: await page.locator('#level-kind').textContent(),
  };
  await page.screenshot({ path: fileURLToPath(new URL(baseline ? 'before.png' : 'after-selected.png', output)) });
  if (baseline) {
    assert.equal(controls.disabled, true);
    assert.equal(before.collider, null);
    console.log(JSON.stringify({ before, clicked, controls, errors }));
  } else {
    assert.equal(controls.disabled, false, 'Original column must be editable');
    assert(before.collider, 'Original column needs a linked player collider');
    await page.locator('[data-axis="x"]').fill(String(before.x + .55));
    await page.locator('[data-axis="x"]').dispatchEvent('change');
    const moved = await page.evaluate(id => {
      const game = window.__wireTheHouse, column = game.room.mansionWing.editableAssets.get(id);
      const collider = game.room.mansionWing.obstaclesAt(0).find(item => item.id === id);
      const originalCamera = game.player.camera.position.clone();
      game.player.wallWorkEnabled = false;
      game.player.camera.position.set((collider.minX + collider.maxX) / 2, game.player.eyeHeight,
        (collider.minZ + collider.maxZ) / 2);
      game.player.update(0);
      const contacts = [...game.player.collisionContacts];
      game.player.camera.position.copy(originalCamera);
      return { x: column.position.x, minX: collider.minX, maxX: collider.maxX, contacts };
    }, before.id);
    assert(Math.abs(moved.x - before.x - .55) < .011);
    assert(Math.abs(moved.minX - before.collider.minX - .55) < .02,
      'The player hitbox must follow the edited column');
    assert(moved.contacts.includes(before.id), 'The player must collide with the moved column');
    await page.screenshot({ path: fileURLToPath(new URL('after-moved.png', output)) });
    await page.locator('#level-undo').click();
    const undone = await page.evaluate(id => {
      const game = window.__wireTheHouse;
      return { x: game.room.mansionWing.editableAssets.get(id).position.x,
        minX: game.room.mansionWing.obstaclesAt(0).find(item => item.id === id)?.minX };
    }, before.id);
    assert(Math.abs(undone.x - before.x) < .011 && Math.abs(undone.minX - before.collider.minX) < .02);
    await openEditorDetails(page);
    await page.locator('#level-redo').click();
    const redoneX = await page.evaluate(id => window.__wireTheHouse.room.mansionWing.editableAssets.get(id).position.x, before.id);
    assert(Math.abs(redoneX - moved.x) < .011);
    await saveEditorLevel(page);
    await page.waitForFunction(() => new URL(location.href).searchParams.has('level'));
    slotId = new URL(page.url()).searchParams.get('level');
    await page.reload();
    await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 120000 });
    const restored = await page.evaluate(id => {
      const game = window.__wireTheHouse, column = game.room.mansionWing.editableAssets.get(id);
      const collider = game.room.mansionWing.obstaclesAt(0).find(item => item.id === id);
      return { x: column.position.x, minX: collider?.minX };
    }, before.id);
    assert(Math.abs(restored.x - moved.x) < .011 && Math.abs(restored.minX - moved.minX) < .02,
      'Visual and physical placement must survive save/reload');
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await blockPointerLock(mobile);
    const mobilePage = await mobile.newPage();
    mobilePage.on('pageerror', error => errors.push(`mobile: ${error.message}`));
    await mobilePage.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&editor=1&renderer=webgl');
    await mobilePage.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 120000 });
    await mobilePage.evaluate(id => {
      const game = window.__wireTheHouse, editor = game.levelEditor;
      const centre = game.room.mansionWing.editableAssets.get(id).getWorldPosition(editor.orbit.target);
      editor.camera.position.copy(centre).add(new centre.constructor(0, .15, 1.2));
      editor.camera.lookAt(centre);
      editor.orbit.update();
    }, before.id);
    await mobilePage.waitForTimeout(100);
    const mobileRect = await mobilePage.locator('#game-canvas').boundingBox();
    assert(mobileRect);
    await mobilePage.touchscreen.tap(mobileRect.x + mobileRect.width / 2, mobileRect.y + mobileRect.height / 2);
    assert.equal(await mobilePage.evaluate(() => window.__wireTheHouse.levelEditor.selected?.name), before.id,
      'Portrait tap must reach the column instead of the transparent dust');
    const mobileBefore = await mobilePage.evaluate(id => window.__wireTheHouse.room.mansionWing.editableAssets.get(id).position.x, before.id);
    const halo = await mobilePage.locator('#level-halo-handle').boundingBox();
    assert(halo, 'The selected column must have a touch handle');
    const cdp = await mobile.newCDPSession(mobilePage);
    const hx = halo.x + halo.width / 2, hy = halo.y + halo.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: hx, y: hy, id: 1 }] });
    for (let step = 1; step <= 6; step++)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: hx + step * 7, y: hy, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const mobileMoved = await mobilePage.evaluate(id => {
      const game = window.__wireTheHouse;
      return { x: game.room.mansionWing.editableAssets.get(id).position.x,
        colliderX: game.room.mansionWing.obstaclesAt(0).find(item => item.id === id)?.minX };
    }, before.id);
    assert(Math.abs(mobileMoved.x - mobileBefore) > .05, 'Portrait touch drag must move the original column');
    assert(Math.abs(mobileMoved.colliderX - before.collider.minX - (mobileMoved.x - mobileBefore)) < .03,
      'Portrait touch drag must also update the player collider');
    await mobilePage.screenshot({ path: fileURLToPath(new URL('after-mobile-drag.png', output)) });
    await mobile.close();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ before, moved, restored, mobileMoved, errors }));
  }
  await context.close();
} finally {
  await browser.close();
  if (slotId) await rm(new URL(`../.studio/levels/${slotId}.json`, import.meta.url), { force: true });
  if (previous === null) await rm(sidecar, { force: true });
  else await writeFile(sidecar, previous);
}
