import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

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
  const expected = await page.evaluate(() => {
    const game = window.__wireTheHouse, editor = game.levelEditor, object = game.mixing.models.concreteMixer;
    editor.setFloorIndex(0);
    editor.setViewMode('2d');
    const origin = new object.position.constructor();
    const center = object.getWorldPosition(origin).add(new origin.constructor(0, 1, 0));
    editor.orbit.target.copy(center);
    editor.camera.position.copy(center).add(new center.constructor(0, 1.65, .01));
    editor.camera.lookAt(center);
    editor.orbit.update();
    return object.name;
  });
  const canvas = await page.locator('#game-canvas').boundingBox();
  assert(canvas);
  await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  const selected = await page.evaluate(() => window.__wireTheHouse.levelEditor.selected?.name ?? null);
  assert.equal(selected, expected, 'The concrete mixer must select from its visible model');
  const before = await page.evaluate(() => {
    const game = window.__wireTheHouse, object = game.mixing.models.concreteMixer;
    return { x: object.position.x, obstacle: game.mixing.collisionObstacles().find(item => item.id === 'concrete-mixer')?.minX };
  });
  assert(Number.isFinite(before.obstacle));
  await page.locator('[data-axis="x"]').fill(String(before.x + .5));
  await page.locator('[data-axis="x"]').dispatchEvent('change');
  const moved = await page.evaluate(() => {
    const game = window.__wireTheHouse, object = game.mixing.models.concreteMixer;
    return { x: object.position.x, obstacle: game.mixing.collisionObstacles().find(item => item.id === 'concrete-mixer')?.minX };
  });
  assert(Math.abs(moved.x - before.x - .5) < .011);
  assert(Math.abs(moved.obstacle - before.obstacle - .5) < .011, 'Mixer collision must follow the edit');
  const widthBefore = Number(await page.locator('[data-size="x"]').inputValue());
  await page.locator('[data-size="x"]').fill(String(widthBefore + .2));
  await page.locator('[data-size="x"]').dispatchEvent('change');
  const mirroredScale = await page.evaluate(() => window.__wireTheHouse.mixing.models.concreteMixer.scale.x);
  assert(mirroredScale < -1, 'Resizing the authored mirrored mixer must preserve its orientation');
  await page.locator('#level-save').click();
  await page.waitForFunction(() => new URL(location.href).searchParams.has('level'));
  slotId = new URL(page.url()).searchParams.get('level');
  await page.reload();
  await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 45000 });
  const restored = await page.evaluate(() => ({
    x: window.__wireTheHouse.mixing.models.concreteMixer.position.x,
    scaleX: window.__wireTheHouse.mixing.models.concreteMixer.scale.x,
  }));
  assert(Math.abs(restored.x - moved.x) < .011 && Math.abs(restored.scaleX - mirroredScale) < .011,
    'Mixer position and mirrored size must survive Save/Load');
  const wheelName = await page.evaluate(() => {
    const game = window.__wireTheHouse, editor = game.levelEditor, object = game.mixing.wheelbarrow.model.group;
    editor.setFloorIndex(0);
    editor.setViewMode('2d');
    const tray = object.getObjectByName('pressed-yellow-tray');
    if (!tray) throw new Error('Wheelbarrow tray missing');
    const center = tray.getWorldPosition(new object.position.constructor());
    editor.orbit.target.copy(center);
    editor.camera.position.copy(center).add(new center.constructor(0, 1.65, .01));
    editor.camera.lookAt(center);
    editor.orbit.update();
    return object.name;
  });
  const wheelTap = await page.evaluate(() => {
    const game = window.__wireTheHouse, editor = game.levelEditor, wheel = game.mixing.wheelbarrow.model.group;
    for (let yi = -4; yi <= 4; yi++) for (let xi = -4; xi <= 4; xi++) {
      const x = xi * .08, y = yi * .08;
      editor.raycaster.setFromCamera({ x, y }, editor.camera);
      const hit = editor.raycaster.intersectObject(wheel, true)[0];
      if (hit) return { x, y, name: hit.object.name };
    }
    return null;
  });
  assert(wheelTap, 'Wheelbarrow must expose a pickable visible mesh');
  await page.mouse.click(canvas.x + (wheelTap.x + 1) * canvas.width / 2,
    canvas.y + (1 - wheelTap.y) * canvas.height / 2);
  const wheelSelection = await page.evaluate(() => window.__wireTheHouse.levelEditor.selected?.name ?? null);
  assert.equal(wheelSelection, wheelName,
    'The wheelbarrow must select independently from the station');
  const wheelBefore = await page.evaluate(() => {
    const game = window.__wireTheHouse;
    return { x: game.mixing.wheelbarrow.model.group.position.x,
      obstacle: game.mixing.collisionObstacles().find(item => item.id === 'wheelbarrow')?.minX };
  });
  await page.locator('[data-axis="x"]').fill(String(wheelBefore.x + .25));
  await page.locator('[data-axis="x"]').dispatchEvent('change');
  const wheelMoved = await page.evaluate(() => {
    const game = window.__wireTheHouse;
    return { x: game.mixing.wheelbarrow.model.group.position.x,
      obstacle: game.mixing.collisionObstacles().find(item => item.id === 'wheelbarrow')?.minX };
  });
  assert(Math.abs(wheelMoved.x - wheelBefore.x - .25) < .011);
  assert(Math.abs(wheelMoved.obstacle - wheelBefore.obstacle - .25) < .011,
    'Wheelbarrow collision must follow the moved model');
  await page.locator('#level-yaw').fill('30');
  await page.locator('#level-yaw').dispatchEvent('change');
  await page.waitForTimeout(150);
  const wheelYaw = await page.evaluate(() => window.__wireTheHouse.mixing.wheelbarrow.model.group.rotation.y);
  assert(Math.abs(wheelYaw - Math.PI / 6) < .02, 'Wheelbarrow simulation must retain editor yaw');
  await page.locator('#level-save').click();
  await page.reload();
  await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 45000 });
  const wheelRestored = await page.evaluate(() => {
    const group = window.__wireTheHouse.mixing.wheelbarrow.model.group;
    return { x: group.position.x, yaw: group.rotation.y };
  });
  assert(Math.abs(wheelRestored.x - wheelMoved.x) < .011 && Math.abs(wheelRestored.yaw - Math.PI / 6) < .02,
    'Wheelbarrow move and rotation must survive Save/Load');
  const wheelYawAfterPhysics = await page.evaluate(() => {
    const wheel = window.__wireTheHouse.mixing.wheelbarrow;
    wheel.update(1 / 60);
    return wheel.model.group.rotation.y;
  });
  assert(Math.abs(wheelYawAfterPhysics - Math.PI / 6) < .02,
    'Physics must preserve the edited wheelbarrow direction');
  const toolBefore = await page.evaluate(() => {
    const game = window.__wireTheHouse;
    game.levelEditor.setSelection([game.mixing.models.mixer]);
    return game.mixing.models.mixer.position.x;
  });
  await page.locator('[data-axis="x"]').fill(String(toolBefore + .2));
  await page.locator('[data-axis="x"]').dispatchEvent('change');
  const toolAfterUpdate = await page.evaluate(() => {
    const game = window.__wireTheHouse;
    game.mixing.update(1 / 60);
    return game.mixing.models.mixer.position.x;
  });
  assert(Math.abs(toolAfterUpdate - toolBefore - .2) < .011,
    'The cordless mixer must retain its editor rest position during simulation');
  await page.locator('#level-save').click();
  await page.reload();
  await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 45000 });
  const toolRestored = await page.evaluate(() => {
    const game = window.__wireTheHouse;
    game.mixing.update(1 / 60);
    return game.mixing.models.mixer.position.x;
  });
  assert(Math.abs(toolRestored - toolAfterUpdate) < .011,
    'The cordless mixer rest position must survive Save/Load');
  const wheelBeforeScale = await page.evaluate(() => {
    const game = window.__wireTheHouse, wheel = game.mixing.wheelbarrow;
    game.levelEditor.setSelection([wheel.model.group]);
    const obstacle = game.mixing.collisionObstacles().find(item => item.id === 'wheelbarrow');
    return { scaleX: wheel.model.group.scale.x, width: obstacle.maxX - obstacle.minX };
  });
  const wheelWidth = Number(await page.locator('[data-size="x"]').inputValue());
  await page.locator('[data-size="x"]').fill(String(wheelWidth + .2));
  await page.locator('[data-size="x"]').dispatchEvent('change');
  const wheelAfterScale = await page.evaluate(() => {
    const game = window.__wireTheHouse, wheel = game.mixing.wheelbarrow;
    wheel.update(1 / 60);
    const obstacle = game.mixing.collisionObstacles().find(item => item.id === 'wheelbarrow');
    return { scaleX: wheel.model.group.scale.x, width: obstacle.maxX - obstacle.minX };
  });
  assert(wheelAfterScale.scaleX > wheelBeforeScale.scaleX && wheelAfterScale.width > wheelBeforeScale.width,
    'Resizing the wheelbarrow must expand its physical collision footprint');
  await page.locator('#level-save').click();
  await page.reload();
  await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 45000 });
  const wheelScaleRestored = await page.evaluate(() => {
    const wheel = window.__wireTheHouse.mixing.wheelbarrow;
    wheel.update(1 / 60);
    return wheel.model.group.scale.x;
  });
  assert(Math.abs(wheelScaleRestored - wheelAfterScale.scaleX) < .011,
    'Wheelbarrow size must survive Save/Load and simulation');
  const sandName = await page.evaluate(() => {
    const game = window.__wireTheHouse, editor = game.levelEditor, sand = game.mixing.models.sand;
    editor.setFloorIndex(0);
    editor.setViewMode('2d');
    const center = sand.getWorldPosition(new sand.position.constructor()).add(new sand.position.constructor(0, .2, 0));
    editor.orbit.target.copy(center);
    editor.camera.position.copy(center).add(new center.constructor(0, 1.65, .01));
    editor.camera.lookAt(center);
    editor.orbit.update();
    return sand.parent.name;
  });
  await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  assert.equal(await page.evaluate(() => window.__wireTheHouse.levelEditor.selected?.name), sandName,
    'The simulated sand pile must select by clicking its visible surface');
  const sandBefore = await page.evaluate(() => {
    const game = window.__wireTheHouse, root = game.mixing.models.sand.parent;
    return { x: root.position.x, obstacle: game.mixing.collisionObstacles().find(item => item.id === 'sand-pile')?.minX };
  });
  await page.locator('[data-axis="x"]').fill(String(sandBefore.x + .15));
  await page.locator('[data-axis="x"]').dispatchEvent('change');
  const sandAfter = await page.evaluate(() => {
    const game = window.__wireTheHouse, sand = game.mixing.models.sand;
    const beforeKg = sand.remainingKg;
    sand.scoop(0, 0, .5);
    return { x: sand.parent.position.x,
      obstacle: game.mixing.collisionObstacles().find(item => item.id === 'sand-pile')?.minX,
      scoopedKg: beforeKg - sand.remainingKg };
  });
  assert(Math.abs(sandAfter.x - sandBefore.x - .15) < .011 &&
    Math.abs(sandAfter.obstacle - sandBefore.obstacle - .15) < .011 && sandAfter.scoopedKg > 0,
    'Sand collision and shovel simulation must follow the editor placement');
  await page.locator('#level-yaw').fill('25');
  await page.locator('#level-yaw').dispatchEvent('change');
  const sandWidth = Number(await page.locator('[data-size="x"]').inputValue());
  await page.locator('[data-size="x"]').fill(String(sandWidth + .15));
  await page.locator('[data-size="x"]').dispatchEvent('change');
  const sandTransformed = await page.evaluate(() => {
    const game = window.__wireTheHouse, sand = game.mixing.models.sand;
    const obstacle = game.mixing.collisionObstacles().find(item => item.id === 'sand-pile');
    return { yaw: sand.parent.rotation.y, scaleX: sand.parent.scale.x,
      minX: obstacle?.minX, maxX: obstacle?.maxX };
  });
  assert(Math.abs(sandTransformed.yaw - 25 * Math.PI / 180) < .02 && sandTransformed.scaleX > 1 &&
    Number.isFinite(sandTransformed.minX) && Number.isFinite(sandTransformed.maxX),
    'Sand yaw and width must retain a finite physical footprint');
  await page.locator('#level-save').click();
  await page.reload();
  await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 45000 });
  const sandRestored = await page.evaluate(() => {
    const root = window.__wireTheHouse.mixing.models.sand.parent;
    return { x: root.position.x, yaw: root.rotation.y, scaleX: root.scale.x };
  });
  assert(Math.abs(sandRestored.x - sandAfter.x) < .011 &&
    Math.abs(sandRestored.yaw - sandTransformed.yaw) < .011 &&
    Math.abs(sandRestored.scaleX - sandTransformed.scaleX) < .011,
    'Sand pile position, rotation and size must survive Save/Load');
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await blockPointerLock(mobile);
  const touchPage = await mobile.newPage();
  await touchPage.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&editor=1&renderer=webgl');
  await touchPage.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 45000 });
  await touchPage.evaluate(() => {
    const game = window.__wireTheHouse, editor = game.levelEditor, object = game.mixing.models.concreteMixer;
    editor.setFloorIndex(0);
    editor.setViewMode('2d');
    const origin = new object.position.constructor();
    const center = object.getWorldPosition(origin).add(new origin.constructor(0, 1, 0));
    editor.orbit.target.copy(center);
    editor.camera.position.copy(center).add(new center.constructor(0, 1.65, .01));
    editor.camera.lookAt(center);
    editor.orbit.update();
  });
  const mobileCanvas = await touchPage.locator('#game-canvas').boundingBox();
  assert(mobileCanvas);
  await touchPage.touchscreen.tap(mobileCanvas.x + mobileCanvas.width / 2, mobileCanvas.y + mobileCanvas.height / 2);
  const mobileSelected = await touchPage.evaluate(() => window.__wireTheHouse.levelEditor.selected?.name ?? null);
  assert.equal(mobileSelected, expected, 'Portrait tap must select the concrete mixer');
  await touchPage.evaluate(() => {
    const game = window.__wireTheHouse, editor = game.levelEditor, object = game.mixing.models.concreteMixer;
    editor.setViewMode('3d');
    const center = object.getWorldPosition(new object.position.constructor()).add(new object.position.constructor(0, 1, 0));
    editor.orbit.target.copy(center);
    editor.camera.position.copy(center).add(new center.constructor(1.35, .9, -2.25));
    editor.camera.lookAt(center);
    editor.orbit.update();
  });
  await touchPage.waitForTimeout(100);
  const output = new URL('../artifacts/site-pro-04/review/level-editor-selection/', import.meta.url);
  await mkdir(output, { recursive: true });
  await touchPage.screenshot({ path: fileURLToPath(new URL('mixer-selected-mobile.png', output)) });
  await touchPage.evaluate(() => {
    const game = window.__wireTheHouse, editor = game.levelEditor, sand = game.mixing.models.sand;
    editor.setFloorIndex(0);
    editor.setViewMode('2d');
    const center = sand.getWorldPosition(new sand.position.constructor()).add(new sand.position.constructor(0, .2, 0));
    editor.orbit.target.copy(center);
    editor.camera.position.copy(center).add(new center.constructor(0, 1.65, .01));
    editor.camera.lookAt(center);
    editor.orbit.update();
  });
  await touchPage.touchscreen.tap(mobileCanvas.x + mobileCanvas.width / 2, mobileCanvas.y + mobileCanvas.height / 2);
  assert.equal(await touchPage.evaluate(() => window.__wireTheHouse.levelEditor.selected?.name), sandName,
    'Portrait tap must select the actual sand pile, not the ground below it');
  await touchPage.evaluate(() => {
    const game = window.__wireTheHouse, editor = game.levelEditor, sand = game.mixing.models.sand;
    editor.setViewMode('3d');
    const center = sand.getWorldPosition(new sand.position.constructor()).add(new sand.position.constructor(0, .2, 0));
    editor.orbit.target.copy(center);
    editor.camera.position.copy(center).add(new center.constructor(1.5, 1.2, -2.25));
    editor.camera.lookAt(center);
    editor.orbit.update();
  });
  await touchPage.waitForTimeout(100);
  await touchPage.screenshot({ path: fileURLToPath(new URL('sand-selected-mobile.png', output)) });
  await mobile.close();
  console.log(JSON.stringify({ selected, mobileSelected, before, moved, mirroredScale, restored,
    wheelName, wheelBefore, wheelMoved, wheelYaw, wheelRestored, wheelYawAfterPhysics,
    toolBefore, toolAfterUpdate, toolRestored, wheelBeforeScale, wheelAfterScale, wheelScaleRestored,
    sandName, sandBefore, sandAfter, sandTransformed, sandRestored }));
} finally {
  await browser.close();
  if (slotId) await rm(new URL(`../.studio/levels/${slotId}.json`, import.meta.url), { force: true });
  if (priorSidecar === null) await rm(sidecar, { force: true });
  else await writeFile(sidecar, priorSidecar);
}
