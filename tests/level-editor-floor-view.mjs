import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&renderer=webgl', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 120_000 });
  await page.locator('#start-level-editor').tap();
  const state = () => page.evaluate(() => {
    const game = window.__wireTheHouse;
    const wing = game.room.mansionWing;
    return {
      view: game.levelEditor.viewMode,
      floor: game.levelEditor.floorIndex,
      camera: game.renderer.viewCamera?.type,
      renderedCamera: game.renderer.activeRenderCamera?.type,
      visible: wing.children.filter(child => child.visible).length,
      total: wing.children.length,
      roomVisible: game.room.children.filter(child => child !== wing && child !== game.room.exterior && child.visible).length,
      gizmo: game.levelEditor.gizmo.object?.name ?? null,
      gizmoVisible: game.levelEditor.gizmo.getHelper().visible,
      renderError: game.renderer.renderError,
    };
  });
  const ground = await state();
  assert.equal(ground.view, '2d');
  assert.equal(ground.camera, 'PerspectiveCamera');
  assert.equal(ground.renderedCamera, 'PerspectiveCamera');
  assert.equal(ground.floor, 0);
  assert(ground.visible < ground.total);
  assert(ground.visible > 0);
  await page.locator('.level-editor__bottom-nav [data-editor-tab="select"]').tap();
  const cutaway = await page.evaluate(() => {
    const wing = window.__wireTheHouse.room.mansionWing;
    const roof = wing.children.find(item => item.name === 'Clay infill under existing L1 structural floor above garage');
    const wall = wing.children.find(item => item.name === 'Garage east fired-clay perimeter');
    return { roofHidden: roof?.children.filter(item => item.isMesh).every(item => !item.visible), wallVisible: wall?.visible };
  });
  assert(cutaway.roofHidden && cutaway.wallVisible, '2D cutaway must expose the real ground-floor walls');
  await page.locator('#level-floor-quick').selectOption('1');
  await page.waitForTimeout(300);
  const first = await state();
  assert.equal(first.floor, 1);
  assert(first.visible > 0 && first.visible < ground.total);
  assert.equal(first.roomVisible, 0);
  assert.equal(first.renderError, '');
  const floorCounts = { L1: first.visible };
  for (const index of [2, 3, 4]) {
    await page.locator('#level-floor-quick').selectOption(String(index));
    const level = await state();
    assert.equal(level.floor, index);
    assert(level.visible > 0 && level.visible < ground.total);
    floorCounts[`L${index}`] = level.visible;
  }
  await page.locator('#level-floor-quick').selectOption('1');
  await page.screenshot({ path: 'output/level-editor-floor-l1-2d.png' });
  await page.locator('.level-editor__bottom-nav [data-editor-tab="select"]').tap();
  await page.screenshot({ path: 'output/level-editor-floor-l1-2d-clean.png' });
  const cdp = await page.context().newCDPSession(page);
  await page.locator('.level-editor__bottom-nav [data-editor-tab="select"]').tap();
  await page.locator('#level-camera-mobile').tap();
  await page.locator('.level-editor__bottom-nav [data-editor-tab="select"]').tap();
  const beforePan = await page.evaluate(() => window.__wireTheHouse.levelEditor.orbit.target.toArray());
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 160, y: 440, id: 1 }] });
  for (let i = 1; i <= 5; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 160 + i * 10, y: 440, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(200);
  const afterPan = await page.evaluate(() => window.__wireTheHouse.levelEditor.orbit.target.toArray());
  assert(Math.hypot(...afterPan.map((value, i) => value - beforePan[i])) > .1, 'One-finger 2D pan must move the target');
  assert(Math.abs(afterPan[1] - 3.3) < .001, '2D pan must stay on the selected floor');
  const beforeZoom = await page.evaluate(() => window.__wireTheHouse.levelEditor.camera.position.distanceTo(window.__wireTheHouse.levelEditor.orbit.target));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 130, y: 440, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 130, y: 440, id: 1 }, { x: 260, y: 440, id: 2 }] });
  for (let i = 1; i <= 5; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 130 - i * 7, y: 440, id: 1 }, { x: 260 + i * 7, y: 440, id: 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(200);
  const afterZoom = await page.evaluate(() => window.__wireTheHouse.levelEditor.camera.position.distanceTo(window.__wireTheHouse.levelEditor.orbit.target));
  assert(Math.abs(afterZoom - beforeZoom) > .05, 'Pinch must zoom the live perspective floor view');
  await page.locator('.level-editor__bottom-nav [data-editor-tab="build"]').tap();
  await page.locator('#level-add-brick').tap();
  const newWall = await page.evaluate(() => ({ y: window.__wireTheHouse.levelEditor.gizmo.object.position.y, visible: window.__wireTheHouse.levelEditor.gizmo.object.visible }));
  assert.equal(newWall.y, 3.3);
  assert(newWall.visible);
  await page.locator('.level-editor__bottom-nav [data-editor-tab="select"]').tap();
  await page.locator('#level-view-quick [data-level-view="3d"]').tap();
  await page.waitForTimeout(200);
  const first3d = await state();
  assert.equal(first3d.camera, 'PerspectiveCamera');
  assert.equal(first3d.floor, 1);
  await page.locator('#level-floor-quick').selectOption('-1');
  const restored = await state();
  assert.equal(restored.visible, ground.total + 1);
  assert(restored.roomVisible > 0);
  await page.locator('.level-editor__bottom-nav [data-editor-tab="starts"]').tap();
  await page.locator('#level-scene-exit').tap();
  assert.equal(await page.evaluate(() => window.__wireTheHouse.renderer.viewCamera), null);
  assert.deepEqual(errors, []);
  const layouts = [];
  for (const [name, viewport] of [['mobile-landscape', { width: 844, height: 390 }], ['tablet-landscape', { width: 1024, height: 768 }]]) {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    const layoutPage = await context.newPage();
    layoutPage.on('pageerror', error => errors.push(`${name}: ${error.message}`));
    await layoutPage.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&renderer=webgl', { waitUntil: 'domcontentloaded' });
    await layoutPage.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 120_000 });
    await layoutPage.locator('#start-level-editor').tap();
    await layoutPage.locator('.level-editor__bottom-nav [data-editor-tab="select"]').tap();
    await layoutPage.locator('#level-view-quick [data-level-view="2d"]').tap();
    await layoutPage.locator('#level-floor-quick').selectOption('4');
    await layoutPage.locator('.level-editor__bottom-nav [data-editor-tab="select"]').tap();
    const result = await layoutPage.evaluate(() => ({ floor: window.__wireTheHouse.levelEditor.floorIndex,
      camera: window.__wireTheHouse.renderer.viewCamera?.type,
      overflow: document.documentElement.scrollWidth > innerWidth,
      visible: window.__wireTheHouse.room.mansionWing.children.filter(child => child.visible).length }));
    assert.equal(result.floor, 4);
    assert.equal(result.camera, 'PerspectiveCamera');
    assert(!result.overflow && result.visible > 0);
    await layoutPage.screenshot({ path: `output/level-editor-floor-l4-${name}.png` });
    layouts.push({ name, ...result });
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ pass: true, ground, first, floorCounts, first3d, restored, beforePan, afterPan, beforeZoom, afterZoom, newWall, layouts, errors }));
} finally { await browser.close(); }
