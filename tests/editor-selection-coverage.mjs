import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { blockPointerLock } from './browser-safety.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const output = new URL('../artifacts/site-pro-04/review/level-editor-selection/', import.meta.url);
const sidecar = new URL('../.studio/mansion-level.json', import.meta.url);
const priorSidecar = await readFile(sidecar).catch(() => null);
let slotId = null;
await mkdir(output, { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await blockPointerLock(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&editor=1&renderer=webgl');
  await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 120000 });
  const aimAt = async (name, category) => page.evaluate(({ name, category }) => {
    const game = window.__wireTheHouse, editor = game.levelEditor, wing = game.room.mansionWing;
    const target = category === 'wall' ? wing.editableWalls.get(name)
      : [...wing.editableAssets.values()].find(child => child.userData.levelEditorLabel === name);
    if (!target) throw new Error(`Missing ${category}: ${name}`);
    const center = target.getWorldPosition(new target.position.constructor());
    editor.camera.position.copy(center).add(category === 'wall' ? new center.constructor(-3, 1, -7) : new center.constructor(0, 1.2, 1.4));
    editor.orbit.target.copy(center);
    editor.camera.lookAt(center);
    editor.orbit.update();
    return { target: target.name, selectedBefore: editor.gizmo.object?.name ?? null,
      registered: wing.editableWalls.has(target.name) || wing.editableSurfaces.has(target.name) || wing.editableAssets.has(target.name) };
  }, { name, category });
  const clickCenter = async () => {
    const rect = await page.locator('#game-canvas').boundingBox();
    assert(rect);
    await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return page.evaluate(() => window.__wireTheHouse.levelEditor.selected?.name ?? window.__wireTheHouse.levelEditor.gizmo.object?.name ?? null);
  };
  const wall = await aimAt('Courtyard east solid pier C', 'wall');
  await page.waitForTimeout(100);
  const wallSelection = await clickCenter();
  assert.equal(wallSelection, wall.target, `Registered masonry must select by canvas click: ${JSON.stringify({ wall, wallSelection })}`);
  await page.locator('#level-wall-continue').click();
  const wallsBeforeSwitch = await page.evaluate(() => window.__wireTheHouse.room.mansionWing.editableWalls.size);
  const otherWall = await aimAt('Courtyard east solid pier B', 'wall');
  await page.waitForTimeout(100);
  const switchedWall = await clickCenter();
  const pathSwitch = await page.evaluate(() => ({ pathActive: window.__wireTheHouse.levelEditor.wallPathActive,
    walls: window.__wireTheHouse.room.mansionWing.editableWalls.size,
    isWall: window.__wireTheHouse.room.mansionWing.editableWalls.has(window.__wireTheHouse.levelEditor.gizmo.object?.name) }));
  assert.notEqual(switchedWall, wall.target, 'A click away from the wall must switch selection during Continue');
  assert(pathSwitch.isWall, 'The frontmost clicked wall must be selected');
  assert.equal(pathSwitch.pathActive, false, 'Changing selection must leave wall continuation');
  assert.equal(pathSwitch.walls, wallsBeforeSwitch, 'Selecting another wall must not create an accidental section');
  const column = await aimAt('Separate stacked clay units awaiting garage partition work', 'asset');
  await page.waitForTimeout(100);
  await page.screenshot({ path: fileURLToPath(new URL('column-before.png', output)) });
  const columnSelection = await clickCenter();
  await page.screenshot({ path: fileURLToPath(new URL('asset-selected.png', output)) });
  const inventory = await page.evaluate(() => {
    const wing = window.__wireTheHouse.room.mansionWing;
    return { direct: wing.children.length, walls: wing.editableWalls.size, surfaces: wing.editableSurfaces.size, assets: wing.editableAssets.size,
      unregistered: wing.children.filter(item => item.visible && !wing.editableWalls.has(item.name) && !wing.editableSurfaces.has(item.name) && !wing.editableAssets.has(item.name))
        .map(item => ({ name: item.name, type: item.type })).slice(0, 30) };
  });
  console.log(JSON.stringify({ wall, wallSelection, column, columnSelection, inventory, errors }, null, 2));
  assert.deepEqual(errors, []);
  assert.equal(columnSelection, column.target, 'Visible site asset must select by canvas click');
  assert(inventory.assets > 175 && inventory.unregistered.every(item => /courtyard|terrain/.test(item.name.toLowerCase())));
  const before = await page.evaluate(id => window.__wireTheHouse.room.mansionWing.editableAssets.get(id).position.x, column.target);
  const hitBefore = await page.evaluate(id => window.__wireTheHouse.room.mansionWing.obstaclesAt(0).find(item => item.id === id)?.minX, column.target);
  assert(Number.isFinite(hitBefore), 'The staged masonry must have a player obstacle');
  await page.locator('[data-axis="x"]').fill(String(before + .5));
  await page.locator('[data-axis="x"]').dispatchEvent('change');
  await page.locator('#level-yaw').fill('30');
  await page.locator('#level-yaw').dispatchEvent('change');
  const changed = await page.evaluate(id => {
    const item = window.__wireTheHouse.room.mansionWing.editableAssets.get(id);
    return { x: item.position.x, yaw: item.rotation.y };
  }, column.target);
  assert(Math.abs(changed.x - before - .5) < .001 && Math.abs(changed.yaw - Math.PI / 6) < .001);
  const hitAfter = await page.evaluate(id => window.__wireTheHouse.room.mansionWing.obstaclesAt(0).find(item => item.id === id)?.minX, column.target);
  assert(Math.abs(hitAfter - hitBefore) > .05, 'The staged masonry hitbox must follow its live edit');
  await page.locator('#level-save').click();
  await page.waitForFunction(() => new URL(location.href).searchParams.has('level'));
  slotId = new URL(page.url()).searchParams.get('level');
  await page.reload();
  await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 120000 });
  const restored = await page.evaluate(id => {
    const item = window.__wireTheHouse.room.mansionWing.editableAssets.get(id);
    return { x: item.position.x, yaw: item.rotation.y };
  }, column.target);
  assert(Math.abs(restored.x - changed.x) < .001 && Math.abs(restored.yaw - changed.yaw) < .001);
  let roomFloorAfter = null;
  for (const [label, point, height, file] of [
    ['Rough unfinished concrete floor', [2.5, 0, 2.5], 1.5, 'room-floor-selected.png'],
    ['Concrete slab ceiling', [0, 3.4, 0], 7, 'room-ceiling-selected.png'],
  ]) {
    await page.evaluate(({ point, height }) => {
      const editor = window.__wireTheHouse.levelEditor;
      editor.orbit.target.set(...point);
      editor.camera.position.set(point[0], point[1] + height, point[2] + .01);
      editor.camera.lookAt(editor.orbit.target);
      editor.orbit.update();
    }, { point, height });
    await page.waitForTimeout(80);
    const picked = await clickCenter();
    const pickedLabel = await page.evaluate(id => window.__wireTheHouse.room.mansionWing.editableAssets.get(id)?.userData.levelEditorLabel, picked);
    assert.equal(pickedLabel, label, `Original room surface must select on canvas: ${label}; got ${pickedLabel}`);
    await page.screenshot({ path: fileURLToPath(new URL(file, output)) });
    if (label === 'Rough unfinished concrete floor') {
      const floorBefore = await page.evaluate(() => ({
        pivotY: window.__wireTheHouse.levelEditor.selected.position.y,
        walkY: window.__wireTheHouse.room.mansionWing.surfaceHeight(2.5, 2.5, 0),
      }));
      await page.locator('[data-axis="y"]').fill(String(floorBefore.pivotY + .12));
      await page.locator('[data-axis="y"]').dispatchEvent('change');
      roomFloorAfter = await page.evaluate(() => window.__wireTheHouse.room.mansionWing.surfaceHeight(2.5, 2.5, 0));
      assert(Math.abs(roomFloorAfter - floorBefore.walkY - .12) < .011, 'Original room floor collision height must follow its visual edit');
    }
  }
  const siteParts = [
    ['Ground foyer slab', [3.8, 0, 10.1], 1.5],
    ['Nine-by-ten-metre open ground within courtyard and shaded veranda zone', [16, 0, 8], 9],
    ['Rising subdivided ground and distant ridge beyond the construction site', [22, 0, -10], 12],
  ];
  for (const [label, point, height] of siteParts) {
    await page.evaluate(({ point, height }) => {
      const editor = window.__wireTheHouse.levelEditor;
      editor.orbit.target.set(...point);
      editor.camera.position.set(point[0], point[1] + height, point[2] + .01);
      editor.camera.lookAt(editor.orbit.target);
      editor.orbit.update();
    }, { point, height });
    await page.waitForTimeout(80);
    const picked = await clickCenter();
    const pickedLabel = await page.evaluate(id => window.__wireTheHouse.room.mansionWing.editableAssets.get(id)?.userData.levelEditorLabel, picked);
    assert.equal(pickedLabel, label, `Click must select visible floor or terrain: ${label}; got ${pickedLabel}`);
    await page.screenshot({ path: fileURLToPath(new URL(label === siteParts[2][0] ? 'terrain-selected.png' : label === siteParts[1][0] ? 'courtyard-selected.png' : 'floor-selected.png', output)) });
  }
  const terrainBefore = await page.evaluate(() => ({
    id: window.__wireTheHouse.levelEditor.selected.name,
    x: window.__wireTheHouse.levelEditor.selected.position.x,
    handleX: window.__wireTheHouse.levelEditor.gizmo.object.position.x,
  }));
  await page.locator('[data-axis="x"]').fill(String(terrainBefore.x + .5));
  await page.locator('[data-axis="x"]').dispatchEvent('change');
  const terrainAfter = await page.evaluate(() => ({
    x: window.__wireTheHouse.levelEditor.selected.position.x,
    handleX: window.__wireTheHouse.levelEditor.gizmo.object.position.x,
  }));
  assert(Math.abs(terrainAfter.x - terrainBefore.x - .5) < .001, 'Terrain must move through live editor dimensions');
  assert(Math.abs(terrainAfter.handleX - terrainBefore.handleX - .5) < .001, 'The terrain gizmo must follow the moved edit point');
  await page.evaluate(() => {
    const editor = window.__wireTheHouse.levelEditor;
    editor.orbit.target.set(20, 25, -10);
    editor.camera.position.set(20, 15, 0);
    editor.camera.lookAt(editor.orbit.target);
    editor.orbit.update();
  });
  await page.waitForTimeout(80);
  assert.equal(await clickCenter(), null, 'Clicking empty sky must clear selection');
  assert.equal(await page.evaluate(() => window.__wireTheHouse.levelEditor.highlights.size), 0, 'Deselect must remove the highlight');
  assert.equal(await page.locator('#level-halo-badge').count(), 0, 'No floating selected label may obscure the scene');
  await page.locator('#level-save').click();
  await page.reload();
  await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 120000 });
  const terrainRestored = await page.evaluate(id => window.__wireTheHouse.room.mansionWing.editableAssets.get(id).position.x, terrainBefore.id);
  assert(Math.abs(terrainRestored - terrainAfter.x) < .011, `Terrain translation must survive save and reload at the UI's centimetre precision: ${JSON.stringify({ terrainBefore, terrainAfter, terrainRestored })}`);
  const roomFloorRestored = await page.evaluate(() => window.__wireTheHouse.room.mansionWing.surfaceHeight(2.5, 2.5, 0));
  assert(Math.abs(roomFloorRestored - roomFloorAfter) < .011, 'Edited room floor height must survive save and reload');
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await blockPointerLock(mobileContext);
  const mobilePage = await mobileContext.newPage();
  mobilePage.on('pageerror', error => errors.push(`mobile: ${error.message}`));
  await mobilePage.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&editor=1&renderer=webgl');
  await mobilePage.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 120000 });
  await mobilePage.evaluate(id => {
    const editor = window.__wireTheHouse.levelEditor;
    const center = window.__wireTheHouse.room.mansionWing.editableAssets.get(id).getWorldPosition(editor.orbit.target);
    editor.camera.position.copy(center).add(new center.constructor(0, 1.2, 1.4));
    editor.orbit.target.copy(center);
    editor.orbit.update();
  }, column.target);
  await mobilePage.waitForTimeout(100);
  const mobileRect = await mobilePage.locator('#game-canvas').boundingBox();
  assert(mobileRect);
  await mobilePage.touchscreen.tap(mobileRect.x + mobileRect.width / 2, mobileRect.y + mobileRect.height / 2);
  const mobileSelected = await mobilePage.evaluate(() => window.__wireTheHouse.levelEditor.gizmo.object?.name ?? null);
  assert.equal(mobileSelected, column.target, 'Portrait touch must select the same visible site asset');
  await mobilePage.screenshot({ path: fileURLToPath(new URL('mobile-asset-selected.png', output)) });
  await mobilePage.evaluate(() => {
    const editor = window.__wireTheHouse.levelEditor;
    editor.orbit.target.set(22, 0, -10);
    editor.camera.position.set(22, 12, -9.99);
    editor.camera.lookAt(editor.orbit.target);
    editor.orbit.update();
  });
  await mobilePage.waitForTimeout(100);
  await mobilePage.touchscreen.tap(mobileRect.x + mobileRect.width / 2, mobileRect.y + mobileRect.height / 2);
  const mobileTerrain = await mobilePage.evaluate(() => ({
    label: window.__wireTheHouse.levelEditor.selected?.userData.levelEditorLabel,
    anchor: window.__wireTheHouse.levelEditor.gizmo.object?.name,
  }));
  assert.equal(mobileTerrain.label, siteParts[2][0], 'Portrait touch must select the actual terrain');
  assert.equal(mobileTerrain.anchor, 'Editor selection centre', 'Large terrain must keep its transform handle at the tap');
  await mobilePage.screenshot({ path: fileURLToPath(new URL('mobile-terrain-selected.png', output)) });
  const mobileTerrainBefore = await mobilePage.evaluate(() => ({
    x: window.__wireTheHouse.levelEditor.selected.position.x,
    handleX: window.__wireTheHouse.levelEditor.gizmo.object.position.x,
  }));
  const halo = await mobilePage.locator('#level-halo-handle').boundingBox();
  assert(halo);
  await mobilePage.mouse.move(halo.x + halo.width / 2, halo.y + halo.height / 2);
  await mobilePage.mouse.down();
  await mobilePage.mouse.move(halo.x + halo.width / 2 + 40, halo.y + halo.height / 2, { steps: 5 });
  await mobilePage.mouse.up();
  const mobileTerrainAfter = await mobilePage.evaluate(() => ({
    x: window.__wireTheHouse.levelEditor.selected.position.x,
    handleX: window.__wireTheHouse.levelEditor.gizmo.object.position.x,
  }));
  const surfaceDelta = mobileTerrainAfter.x - mobileTerrainBefore.x;
  const handleDelta = mobileTerrainAfter.handleX - mobileTerrainBefore.handleX;
  assert(Math.abs(surfaceDelta) > .1 && Math.abs(surfaceDelta) < 3, `Mobile terrain drag must move smoothly, without a pivot jump: ${JSON.stringify({ mobileTerrainBefore, mobileTerrainAfter })}`);
  assert(Math.abs(surfaceDelta - handleDelta) < .02, 'The mobile handle must follow the moved terrain');
  await mobileContext.close();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ assetMoveSaveReload: true, terrainMoveSaveReload: true, mobileTerrainDrag: surfaceDelta, mobileSelected, mobileTerrain, before, changed, restored }));
} finally {
  await browser.close();
  if (slotId) await rm(new URL(`../.studio/levels/${slotId}.json`, import.meta.url), { force: true });
  if (priorSidecar === null) await rm(sidecar, { force: true });
  else await writeFile(sidecar, priorSidecar);
}
