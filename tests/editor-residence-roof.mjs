import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';
import { openEditorDetails, saveEditorLevel } from './editor-navigation.mjs';

const sidecar = new URL('../.studio/mansion-level.json', import.meta.url);
const priorSidecar = await readFile(sidecar).catch(() => null);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let slotId = null;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await blockPointerLock(context);
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&editor=1&renderer=webgl');
  await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 45000 });
  await page.evaluate(() => {
    const editor = window.__wireTheHouse.levelEditor;
    editor.setViewMode('3d');
    editor.setFloorIndex(0);
    editor.camera.position.set(-14.5, 8, 2.11);
    editor.orbit.target.set(-14.5, 2.52, 2.1);
    editor.camera.lookAt(editor.orbit.target);
    editor.orbit.update();
  });
  const canvas = await page.locator('#game-canvas').boundingBox();
  assert(canvas);
  await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  const state = async () => page.evaluate(() => {
    const wing = window.__wireTheHouse.room.mansionWing;
    const roof = [...wing.editableAssets.values()].find(item => item.userData.levelEditorLabel === 'Residence roof slab and parapet');
    const house = [...wing.editableAssets.values()].find(item => item.userData.levelEditorLabel === 'Residence beyond courtyard boundary');
    const wall = house.children[0].children.find(item => item.isMesh);
    return { selected: window.__wireTheHouse.levelEditor.selected?.name ?? null,
      roofId: roof.name, roofX: roof.position.x, houseX: house.position.x,
      wallWorldX: wall.getWorldPosition(wall.position.clone()).x };
  });
  const before = await state();
  assert.equal(before.selected, before.roofId, 'The roof must be the selected edit target');
  await openEditorDetails(page);
  const field = page.locator('[data-axis="x"]');
  const fieldBefore = Number(await field.inputValue());
  await field.fill(String(fieldBefore + .5));
  await field.dispatchEvent('change');
  const moved = await state();
  assert(Math.abs(moved.roofX - before.roofX - .5) < .011, 'Roof must translate independently');
  assert.equal(moved.houseX, before.houseX, 'Residence parent must not move with its roof');
  assert(Math.abs(moved.wallWorldX - before.wallWorldX) < .001, 'Residence walls must stay in place');
  await page.locator('#level-undo').click();
  assert(Math.abs((await state()).roofX - before.roofX) < .011, 'Undo must restore the roof alone');
  await page.locator('#level-redo').click();
  assert(Math.abs((await state()).roofX - moved.roofX) < .011, 'Redo must restore the roof edit');
  await saveEditorLevel(page);
  await page.waitForFunction(() => new URL(location.href).searchParams.has('level'));
  slotId = new URL(page.url()).searchParams.get('level');
  await page.reload();
  await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 45000 });
  const restored = await state();
  assert(Math.abs(restored.roofX - moved.roofX) < .011, 'Roof translation must survive save/reload');
  assert.equal(restored.houseX, before.houseX);
  assert(Math.abs(restored.wallWorldX - before.wallWorldX) < .001);
  console.log(JSON.stringify({ before, moved, restored }));
} finally {
  await browser.close();
  if (slotId) await rm(new URL(`../.studio/levels/${slotId}.json`, import.meta.url), { force: true });
  if (priorSidecar === null) await rm(sidecar, { force: true });
  else await writeFile(sidecar, priorSidecar);
}
