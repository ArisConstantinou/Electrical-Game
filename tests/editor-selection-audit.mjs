import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { blockPointerLock } from './browser-safety.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await blockPointerLock(context);
  const page = await context.newPage();
  page.on('pageerror', error => console.error(`pageerror: ${error.stack ?? error.message}`));
  page.on('console', message => { if (message.type() === 'error') console.error(`console: ${message.text()}`); });
  await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&editor=1&renderer=webgl');
  await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 30000 });
  const audit = await page.evaluate(() => {
    const room = window.__wireTheHouse.room, wing = room.mansionWing;
    const registered = new Set([...wing.editableWalls.values(), ...wing.editableSurfaces.values(), ...wing.editableAssets.values()]);
    const missing = new Map();
    room.traverseVisible(node => {
      if (!node.isMesh || node.userData.levelEditorHighlight) return;
      let current = node;
      while (current && current !== room && !registered.has(current)) current = current.parent;
      if (registered.has(current)) return;
      let owner = node;
      while (owner.parent && owner.parent !== room) owner = owner.parent;
      const entry = missing.get(owner.name) ?? { root: owner.name, meshes: 0, examples: [] };
      entry.meshes++;
      if (entry.examples.length < 4 && !entry.examples.includes(node.name)) entry.examples.push(node.name);
      missing.set(owner.name, entry);
    });
    return { registered: registered.size, unregisteredRoots: [...missing.values()].sort((a, b) => b.meshes - a.meshes) };
  });
  console.log(JSON.stringify(audit, null, 2));
  assert(audit.registered > 300, 'Every authored site part should be registered');
  assert(audit.unregisteredRoots.every(item => item.examples.every(name => /sky gradient/i.test(name))),
    'Only the background sky may remain outside the level selection registry');
  const mainWall = await page.evaluate(() => {
    const game = window.__wireTheHouse, editor = game.levelEditor;
    const target = [...game.room.mansionWing.editableAssets.values()]
      .find(item => item.userData.levelEditorLabel.startsWith('Brittle hollow clay masonry'));
    if (!target) throw new Error('Main gameplay masonry has no level-editor selection');
    editor.camera.position.set(0, 1.5, 2);
    editor.orbit.target.set(0, 1.5, -2.5);
    editor.camera.lookAt(editor.orbit.target);
    editor.orbit.update();
    return target.name;
  });
  const canvas = await page.locator('#game-canvas').boundingBox();
  assert(canvas);
  await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  const selected = await page.evaluate(() => ({ id: window.__wireTheHouse.levelEditor.selected?.name,
    locked: window.__wireTheHouse.levelEditor.selected?.userData.levelEditorLocked,
    gizmo: window.__wireTheHouse.levelEditor.gizmo.object?.name ?? null }));
  assert.equal(selected.id, mainWall, `Main gameplay masonry must select on click: ${JSON.stringify(selected)}`);
  assert.equal(selected.locked, true, 'Gameplay wall must remain protected from a visual-only transform');
  assert.equal(selected.gizmo, null, 'Locked gameplay wall must not offer a broken transform gizmo');
  await mkdir('artifacts/site-pro-04/review/level-editor-selection', { recursive: true });
  await page.screenshot({ path: 'artifacts/site-pro-04/review/level-editor-selection/main-gameplay-wall-selected.png' });
  console.log(JSON.stringify({ mainWall, selected }));
  const touchContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await blockPointerLock(touchContext);
  const touchPage = await touchContext.newPage();
  await touchPage.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&editor=1&renderer=webgl');
  await touchPage.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 30000 });
  await touchPage.evaluate(() => {
    const editor = window.__wireTheHouse.levelEditor;
    editor.camera.position.set(0, 1.5, 2);
    editor.orbit.target.set(0, 1.5, -2.5);
    editor.camera.lookAt(editor.orbit.target);
    editor.orbit.update();
  });
  const touchCanvas = await touchPage.locator('#game-canvas').boundingBox();
  assert(touchCanvas);
  await touchPage.touchscreen.tap(touchCanvas.x + touchCanvas.width / 2, touchCanvas.y + touchCanvas.height / 2);
  assert.equal(await touchPage.evaluate(() => window.__wireTheHouse.levelEditor.selected?.name), mainWall);
  const wallPosition = await touchPage.evaluate(() => window.__wireTheHouse.levelEditor.selected.position.toArray());
  const touchBlocked = await touchPage.evaluate(() => window.__wireTheHouse.levelEditor.beginTouchDrag(
    new PointerEvent('pointerdown', { pointerType: 'touch', isPrimary: true, pointerId: 23, clientX: innerWidth / 2, clientY: innerHeight / 2 })));
  assert.equal(touchBlocked, false, 'Touch must not move collision-linked wall without a gameplay transform');
  assert.deepEqual(await touchPage.evaluate(() => window.__wireTheHouse.levelEditor.selected.position.toArray()), wallPosition);
  await touchContext.close();
} finally { await browser.close(); }
