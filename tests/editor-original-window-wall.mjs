import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { blockPointerLock } from './browser-safety.mjs';
import { openEditorDetails, openEditorTab, saveEditorLevel } from './editor-navigation.mjs';

const baseline = process.argv.includes('--baseline');
const output = new URL('../artifacts/site-pro-04/review/editor-original-window-wall/', import.meta.url);
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
  await openEditorTab(page, 'select');
  await page.locator('#level-view-quick [data-level-view="3d"]').click();
  await page.locator('.level-editor__bottom-nav [data-editor-tab="select"]').click();
  const wall = await page.evaluate(() => {
    const game = window.__wireTheHouse, editor = game.levelEditor;
    const item = [...game.room.mansionWing.editableAssets.values()].find(asset => asset.userData.levelEditorLabel === 'Left concrete wall');
    if (!item) throw new Error('Window wall is absent from editor registry');
    const centre = item.getWorldPosition(new item.position.constructor());
    editor.orbit.target.copy(centre);
    editor.camera.position.copy(centre).add(new centre.constructor(1.6, .1, 0));
    editor.camera.lookAt(centre);
    editor.orbit.update();
    return { id: item.name, x: item.position.x };
  });
  await page.waitForTimeout(100);
  const rect = await page.locator('#game-canvas').boundingBox();
  assert(rect);
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
  assert.equal(await page.evaluate(() => window.__wireTheHouse.levelEditor.selected?.name), wall.id,
    'The window wall must select from its visible surface');
  await openEditorDetails(page);
  const disabled = await page.locator('[data-axis="x"]').isDisabled();
  const frameWall = async () => {
    await page.locator('#level-details-close').click();
    await page.evaluate(id => {
      const game = window.__wireTheHouse, editor = game.levelEditor;
      const item = game.room.mansionWing.editableAssets.get(id);
      const centre = item.getWorldPosition(new item.position.constructor());
      editor.orbit.target.copy(centre);
      editor.camera.position.copy(centre).add(new centre.constructor(6, 11, -9));
      editor.camera.lookAt(centre);
      editor.orbit.update();
    }, wall.id);
    await page.waitForTimeout(120);
  };
  await frameWall();
  await page.screenshot({ path: fileURLToPath(new URL(baseline ? 'before.png' : 'after-selected.png', output)) });
  if (baseline) {
    assert(disabled, 'The pre-change window wall should reproduce the edit lock');
    console.log(JSON.stringify({ wall, disabled, errors }));
  } else {
    assert.equal(disabled, false, 'Window wall position must be editable');
    const initial = await page.evaluate(id => window.__wireTheHouse.room.mansionWing.obstaclesAt(0).find(obstacle => obstacle.id === id), wall.id);
    assert(initial?.segments?.length === 1, 'The existing window sill needs a movable wall barrier');
    const originalContact = await page.evaluate(id => {
      const game = window.__wireTheHouse, previous = game.player.camera.position.clone();
      game.player.wallWorkEnabled = false;
      game.player.camera.position.set(-3.76, game.player.eyeHeight, 0);
      game.player.update(0);
      const result = { x: game.player.camera.position.x, contacts: [...game.player.collisionContacts] };
      game.player.camera.position.copy(previous);
      return result;
    }, wall.id);
    assert(originalContact.contacts.includes(wall.id) && originalContact.x > -3.5,
      'The original opening wall must still block walking through its sill');
    await openEditorDetails(page);
    await page.locator('[data-axis="x"]').fill(String(wall.x - .55));
    await page.locator('[data-axis="x"]').dispatchEvent('change');
    await page.locator('#level-yaw').fill('15');
    await page.locator('#level-yaw').dispatchEvent('change');
    const moved = await page.evaluate(id => {
      const game = window.__wireTheHouse, wing = game.room.mansionWing;
      const item = wing.editableAssets.get(id), obstacle = wing.obstaclesAt(0).find(part => part.id === id);
      const saved = game.player.camera.position.clone();
      const segment = obstacle.segments[0];
      game.player.wallWorkEnabled = false;
      game.player.camera.position.set((segment.ax + segment.bx) / 2 + .25, game.player.eyeHeight, (segment.az + segment.bz) / 2);
      game.player.update(0);
      const contacts = [...game.player.collisionContacts], playerX = game.player.camera.position.x;
      game.player.camera.position.copy(saved);
      return { x: item.position.x, yaw: item.rotation.y, obstacle: { minX: obstacle.minX, maxX: obstacle.maxX,
        segment: { ...segment } }, contacts, playerX };
    }, wall.id);
    assert(Math.abs(moved.x - wall.x + .55) < .011);
    assert(Math.abs(moved.obstacle.maxX - initial.maxX) > .1);
    assert(Math.abs(moved.obstacle.segment.ax - moved.obstacle.segment.bx) > .5);
    assert(moved.contacts.includes(wall.id), 'Player must contact the moved opening wall');
    assert(moved.playerX < -3.5, 'The old room clamp must not keep the player at the abandoned wall position');
    await frameWall();
    await page.screenshot({ path: fileURLToPath(new URL('after-moved.png', output)) });
    await saveEditorLevel(page);
    await page.waitForFunction(() => new URL(location.href).searchParams.has('level'));
    slotId = new URL(page.url()).searchParams.get('level');
    await page.reload();
    await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 120000 });
    const restored = await page.evaluate(id => {
      const wing = window.__wireTheHouse.room.mansionWing, item = wing.editableAssets.get(id);
      return { x: item.position.x, yaw: item.rotation.y, obstacle: wing.obstaclesAt(0).find(part => part.id === id) };
    }, wall.id);
    assert(Math.abs(restored.x - moved.x) < .011 && Math.abs(restored.yaw - moved.yaw) < .011);
    assert(Math.abs(restored.obstacle.maxX - moved.obstacle.maxX) < .02);
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await blockPointerLock(mobile);
    const mobilePage = await mobile.newPage();
    mobilePage.on('pageerror', error => errors.push(`mobile: ${error.message}`));
    await mobilePage.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&editor=1&renderer=webgl');
    await mobilePage.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 120000 });
    await openEditorTab(mobilePage, 'select');
    await mobilePage.locator('#level-view-quick [data-level-view="3d"]').click();
    await mobilePage.locator('.level-editor__bottom-nav [data-editor-tab="select"]').click();
    await mobilePage.evaluate(id => {
      const game = window.__wireTheHouse, editor = game.levelEditor;
      const centre = game.room.mansionWing.editableAssets.get(id).getWorldPosition(editor.orbit.target);
      editor.camera.position.copy(centre).add(new centre.constructor(1.6, .1, 0));
      editor.camera.lookAt(centre);
      editor.orbit.update();
    }, wall.id);
    await mobilePage.waitForTimeout(100);
    const mobileRect = await mobilePage.locator('#game-canvas').boundingBox();
    assert(mobileRect);
    await mobilePage.touchscreen.tap(mobileRect.x + mobileRect.width / 2, mobileRect.y + mobileRect.height / 2);
    assert.equal(await mobilePage.evaluate(() => window.__wireTheHouse.levelEditor.selected?.name), wall.id,
      'Portrait touch must select the original window wall');
    await mobilePage.evaluate(id => {
      const game = window.__wireTheHouse, editor = game.levelEditor;
      const item = game.room.mansionWing.editableAssets.get(id);
      const centre = item.getWorldPosition(new item.position.constructor());
      editor.orbit.target.copy(centre);
      editor.camera.position.copy(centre).add(new centre.constructor(5, 9, -7));
      editor.camera.lookAt(centre);
      editor.orbit.update();
    }, wall.id);
    await mobilePage.waitForTimeout(120);
    await mobilePage.screenshot({ path: fileURLToPath(new URL('after-mobile-tap.png', output)) });
    await mobile.close();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ wall, initial, originalContact, moved, restored, errors }));
  }
  await context.close();
} finally {
  await browser.close();
  if (slotId) await rm(new URL(`../.studio/levels/${slotId}.json`, import.meta.url), { force: true });
  if (previous === null) await rm(sidecar, { force: true });
  else await writeFile(sidecar, previous);
}
