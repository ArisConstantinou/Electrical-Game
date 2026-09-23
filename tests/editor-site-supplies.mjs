import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const url = 'http://127.0.0.1:5365/Electrical-Game/?mansion=preview&editor=1&renderer=webgl';
const names = ['Open mortar bucket', 'Coiled water hose'];
const sidecar = new URL('../.studio/mansion-level.json', import.meta.url);
const priorSidecar = await readFile(sidecar).catch(() => null);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let slotId;

async function pickSupply(page, name, touch = false) {
  const point = await page.evaluate(label => {
    const game = window.__wireTheHouse, editor = game.levelEditor, wing = game.room.mansionWing;
    editor.setFloorIndex(0);
    editor.setViewMode('3d');
    const entry = [...wing.editableAssets.values()].find(item => item.userData.levelEditorLabel === label);
    if (!entry) return { error: 'not registered' };
    const center = entry.getWorldPosition(new entry.position.constructor());
    editor.orbit.target.copy(center);
    editor.camera.position.copy(center).add(new center.constructor(0, .55, -1.35));
    editor.camera.lookAt(center);
    editor.orbit.update();
    editor.camera.updateMatrixWorld(true);
    for (let yi = -45; yi <= 45; yi++) for (let xi = -45; xi <= 45; xi++) {
      const x = xi / 150, y = yi / 150;
      editor.raycaster.setFromCamera({ x, y }, editor.camera);
      const hit = editor.raycaster.intersectObjects(editor.editables().filter(item => editor.isSelectableVisible(item)), true)
        .find(item => !item.object.isPoints && editor.isHitVisible(item.object));
      let owner = hit?.object;
      while (owner && owner !== entry && owner !== game.renderer.scene) owner = owner.parent;
      if (owner === entry) return { x, y, id: entry.name, position: entry.position.toArray() };
    }
    return { error: 'not canvas-pickable', id: entry.name, center: center.toArray() };
  }, name);
  assert(!point.error, `${name}: ${JSON.stringify(point)}`);
  const box = await page.locator('#game-canvas').boundingBox();
  assert(box);
  const x = box.x + (point.x + 1) * box.width / 2;
  const y = box.y + (1 - point.y) * box.height / 2;
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
  assert.equal(await page.evaluate(() => window.__wireTheHouse.levelEditor.selected?.name), point.id);
  assert.equal(await page.locator('[data-axis="x"]').isDisabled(), false,
    `${name} should be moveable, not merely selectable`);
  return point;
}

try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await blockPointerLock(desktop);
  const page = await desktop.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 45000 });
  assert.equal(await page.evaluate(() => window.__wireTheHouse.room.getObjectByName('Spare rigid PVC lengths').visible), false);
  const desktopPicks = [];
  for (const name of names) desktopPicks.push(await pickSupply(page, name));
  const bucket = await pickSupply(page, names[0]);
  await page.locator('[data-axis="x"]').fill(String(bucket.position[0] + .35));
  await page.locator('[data-axis="x"]').dispatchEvent('change');
  await page.locator('#level-yaw').fill('25');
  await page.locator('#level-yaw').dispatchEvent('change');
  const moved = await page.evaluate(id => {
    const object = window.__wireTheHouse.room.mansionWing.editableAssets.get(id);
    return { x: object.position.x, yaw: object.rotation.y };
  }, bucket.id);
  assert(Math.abs(moved.x - bucket.position[0] - .35) < .011);
  assert(Math.abs(moved.yaw - 25 * Math.PI / 180) < .02);
  await page.locator('#level-save').click();
  await page.waitForFunction(() => new URL(location.href).searchParams.has('level'));
  slotId = new URL(page.url()).searchParams.get('level');
  await page.reload();
  await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 45000 });
  const restored = await page.evaluate(id => {
    const object = window.__wireTheHouse.room.mansionWing.editableAssets.get(id);
    return { x: object.position.x, yaw: object.rotation.y };
  }, bucket.id);
  assert(Math.abs(restored.x - moved.x) < .011 && Math.abs(restored.yaw - moved.yaw) < .011);
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await blockPointerLock(mobile);
  const touchPage = await mobile.newPage();
  touchPage.on('pageerror', error => errors.push(error.message));
  await touchPage.goto(url);
  await touchPage.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 45000 });
  const mobilePicks = [];
  for (const name of names) mobilePicks.push(await pickSupply(touchPage, name, true));
  const shot = new URL('../artifacts/site-pro-04/review/level-editor-selection/site-supplies-selected-mobile.png', import.meta.url);
  await mkdir(new URL('./', shot), { recursive: true });
  await touchPage.screenshot({ path: fileURLToPath(shot) });
  console.log(JSON.stringify({ desktopPicks, mobilePicks, moved, restored, errors }));
  await mobile.close();
  assert.deepEqual(errors, []);
  await desktop.close();
} finally {
  await browser.close();
  if (slotId) await rm(new URL(`../.studio/levels/${slotId}.json`, import.meta.url), { force: true });
  if (priorSidecar === null) await rm(sidecar, { force: true });
  else await writeFile(sidecar, priorSidecar);
}
