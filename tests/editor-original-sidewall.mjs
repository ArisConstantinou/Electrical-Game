import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { blockPointerLock } from './browser-safety.mjs';
import { openEditorBrowser, openEditorDetails, openEditorTab, saveEditorLevel } from './editor-navigation.mjs';

const baseline = process.argv.includes('--baseline');
const output = new URL('../artifacts/site-pro-04/review/editor-original-sidewall/', import.meta.url);
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
  const before = await page.evaluate(() => {
    const game = window.__wireTheHouse, editor = game.levelEditor, wing = game.room.mansionWing;
    const wall = [...wing.editableAssets.values()].find(item => item.userData.levelEditorLabel === 'Right concrete wall');
    if (!wall) throw new Error('Original right wall is not registered');
    const centre = wall.getWorldPosition(new wall.position.constructor());
    editor.orbit.target.copy(centre);
    editor.camera.position.copy(centre).add(new centre.constructor(-1.6, .1, 0));
    editor.camera.lookAt(centre);
    editor.orbit.update();
    return { id: wall.name, x: wall.position.x, centre: centre.toArray(),
      oldObstacle: wing.obstacles.find(item => item.id === 'mansion-room-east') ?? null };
  });
  await page.waitForTimeout(100);
  const rect = await page.locator('#game-canvas').boundingBox();
  assert(rect);
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
  const clicked = await page.evaluate(() => window.__wireTheHouse.levelEditor.selected?.name);
  if (baseline && clicked !== before.id) {
    await openEditorBrowser(page);
    await page.locator('#level-search').fill('Right concrete wall');
    await page.locator('#level-list button').first().click();
  } else assert.equal(clicked, before.id, 'Canvas click must select the original room side wall');
  await openEditorDetails(page);
  const disabled = await page.locator('[data-axis="x"]').isDisabled();
  const showWall = async () => {
    await page.locator('#level-details-close').click();
    await page.evaluate(id => {
      const game = window.__wireTheHouse, editor = game.levelEditor;
      const wall = game.room.mansionWing.editableAssets.get(id);
      const centre = wall.getWorldPosition(new wall.position.constructor());
      editor.orbit.target.copy(centre);
      editor.camera.position.copy(centre).add(new centre.constructor(-6, 11, -9));
      editor.camera.lookAt(centre);
      editor.orbit.update();
    }, before.id);
    await page.waitForTimeout(120);
  };
  await showWall();
  await page.screenshot({ path: fileURLToPath(new URL(baseline ? 'before.png' : 'after-selected.png', output)) });
  if (baseline) {
    assert(disabled && before.oldObstacle);
    console.log(JSON.stringify({ before, clicked, disabled, errors }));
  } else {
    assert.equal(disabled, false, 'Original side wall must be editable');
    assert.equal(before.oldObstacle, null, 'The old static collider must be replaced');
    const initial = await page.evaluate(id => window.__wireTheHouse.room.mansionWing.obstaclesAt(0).find(item => item.id === id), before.id);
    assert(initial?.segments?.length === 1, 'The wall needs a narrow rotated physical segment');
    await openEditorDetails(page);
    await page.locator('[data-axis="x"]').fill(String(before.x + .55));
    await page.locator('[data-axis="x"]').dispatchEvent('change');
    await page.locator('#level-yaw').fill('20');
    await page.locator('#level-yaw').dispatchEvent('change');
    const moved = await page.evaluate(id => {
      const game = window.__wireTheHouse, wing = game.room.mansionWing;
      const wall = wing.editableAssets.get(id), obstacle = wing.obstaclesAt(0).find(item => item.id === id);
      const camera = game.player.camera.position.clone();
      game.player.wallWorkEnabled = false;
      const segment = obstacle.segments[0];
      game.player.camera.position.set((segment.ax + segment.bx) / 2, game.player.eyeHeight,
        (segment.az + segment.bz) / 2);
      game.player.update(0);
      const contacts = [...game.player.collisionContacts];
      game.player.camera.position.copy(camera);
      return { x: wall.position.x, yaw: wall.rotation.y, obstacle: {
        minX: obstacle.minX, maxX: obstacle.maxX, minZ: obstacle.minZ, maxZ: obstacle.maxZ,
        segment: { ...segment } }, contacts };
    }, before.id);
    assert(Math.abs(moved.x - before.x - .55) < .011);
    assert(Math.abs(moved.obstacle.minX - initial.minX) > .1, 'Wall obstacle must move with geometry');
    assert(Math.abs(moved.obstacle.segment.ax - moved.obstacle.segment.bx) > .5,
      'Narrow-phase collider must rotate with the wall');
    assert(moved.contacts.includes(before.id), 'Player must collide with the moved, rotated wall');
    await showWall();
    await page.screenshot({ path: fileURLToPath(new URL('after-moved.png', output)) });
    await saveEditorLevel(page);
    await page.waitForFunction(() => new URL(location.href).searchParams.has('level'));
    slotId = new URL(page.url()).searchParams.get('level');
    await page.reload();
    await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 120000 });
    const restored = await page.evaluate(id => {
      const wing = window.__wireTheHouse.room.mansionWing, wall = wing.editableAssets.get(id);
      const obstacle = wing.obstaclesAt(0).find(item => item.id === id);
      return { x: wall.position.x, yaw: wall.rotation.y, minX: obstacle?.minX,
        segment: obstacle?.segments?.[0] };
    }, before.id);
    assert(Math.abs(restored.x - moved.x) < .011 && Math.abs(restored.yaw - moved.yaw) < .011);
    assert(Math.abs(restored.minX - moved.obstacle.minX) < .02 && restored.segment,
      'Rotated physical wall must survive save/reload');
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
      editor.camera.position.copy(centre).add(new centre.constructor(-1.6, .1, 0));
      editor.camera.lookAt(centre);
      editor.orbit.update();
    }, before.id);
    await mobilePage.waitForTimeout(100);
    const mobileRect = await mobilePage.locator('#game-canvas').boundingBox();
    assert(mobileRect);
    await mobilePage.touchscreen.tap(mobileRect.x + mobileRect.width / 2, mobileRect.y + mobileRect.height / 2);
    assert.equal(await mobilePage.evaluate(() => window.__wireTheHouse.levelEditor.selected?.name), before.id,
      'Portrait tap must reach the original side wall');
    await mobilePage.evaluate(id => {
      const game = window.__wireTheHouse, editor = game.levelEditor;
      const wall = game.room.mansionWing.editableAssets.get(id);
      const centre = wall.getWorldPosition(new wall.position.constructor());
      editor.orbit.target.copy(centre);
      editor.camera.position.copy(centre).add(new centre.constructor(-5, 9, -7));
      editor.camera.lookAt(centre);
      editor.orbit.update();
    }, before.id);
    await mobilePage.waitForTimeout(120);
    await mobilePage.screenshot({ path: fileURLToPath(new URL('after-mobile-tap.png', output)) });
    await mobile.close();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ before, initial, moved, restored, errors }));
  }
  await context.close();
} finally {
  await browser.close();
  if (slotId) await rm(new URL(`../.studio/levels/${slotId}.json`, import.meta.url), { force: true });
  if (previous === null) await rm(sidecar, { force: true });
  else await writeFile(sidecar, previous);
}
