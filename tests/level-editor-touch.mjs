import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const tablet = process.argv.includes('--tablet');
const device = tablet ? 'tablet' : 'mobile';
try {
  const context = await browser.newContext({ viewport: tablet ? { width: 820, height: 1180 } : { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&renderer=webgl', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 120_000 });
  await page.locator('#start-level-editor').tap();
  await page.locator('.level-editor__bottom-nav [data-editor-tab="build"]').tap();
  await page.locator('#level-add-brick').tap();
  assert(await page.evaluate(() => window.__wireTheHouse.levelEditor.gizmo.object.children.some(child => child.userData.levelEditorHighlight)), 'Selected wall must have a visible world highlight');
  await page.locator('#level-details-toggle').tap();
  await page.locator('#level-focus').tap();
  await page.locator('[data-fields-tab="size"]').tap();
  assert(await page.locator('[data-size="x"]').isVisible());
  assert(!(await page.locator('[data-axis="x"]').isVisible()));
  await mkdir('artifacts/site-pro-04/review/level-editor', { recursive: true });
  await page.screenshot({ path: `artifacts/site-pro-04/review/level-editor/${device}-dimensions.png`, fullPage: true });
  await page.locator('[data-fields-tab="position"]').tap();
  await page.locator('#level-details-close').tap();
  await page.locator('#level-snap').uncheck();
  const cdp = await context.newCDPSession(page);
  const point = async () => page.evaluate(() => {
    const halo = document.querySelector('#level-halo-handle');
    if (halo && halo.offsetParent) {
      const bounds = halo.getBoundingClientRect();
      return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    }
    const editor = window.__wireTheHouse.levelEditor;
    const group = editor.gizmo.object;
    const mesh = group.children.find(child => child.isMesh);
    mesh.geometry.computeBoundingBox();
    const center = mesh.geometry.boundingBox.min.clone().add(mesh.geometry.boundingBox.max).multiplyScalar(.5);
    mesh.localToWorld(center);
    center.project(editor.camera);
    const bounds = window.__wireTheHouse.renderer.webgl.domElement.getBoundingClientRect();
    return { x: bounds.left + (center.x + 1) * bounds.width / 2, y: bounds.top + (1 - center.y) * bounds.height / 2 };
  });
  const drag = async (dx, dy) => {
    const start = await point();
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    await touch('touchStart', start.x, start.y);
    for (let step = 1; step <= 6; step++) await touch('touchMove', start.x + dx * step / 6, start.y + dy * step / 6);
    await touch('touchEnd', start.x + dx, start.y + dy);
    await page.waitForTimeout(120);
  };
  const transform = () => page.evaluate(() => {
    const object = window.__wireTheHouse.levelEditor.gizmo.object;
    return { position: object.position.toArray(), rotationY: object.rotation.y, scale: object.scale.toArray() };
  });
  const before = await transform();
  await page.locator('#level-rotate').tap();
  await drag(65, 0);
  const rotated = await transform();
  assert(Math.abs(rotated.rotationY - before.rotationY) > .15, `Rotate gesture did not affect wall: ${JSON.stringify({ before, rotated })}`);
  await page.locator('#level-scale').tap();
  await page.waitForFunction(() => window.__wireTheHouse.levelEditor.gizmo.mode === 'scale');
  await drag(0, -55);
  const scaled = await transform();
  assert(scaled.scale[0] > rotated.scale[0] * 1.1, `Scale gesture did not affect wall: ${JSON.stringify({ rotated, scaled })}`);
  await page.locator('#level-translate').tap();
  await drag(50, 0);
  const moved = await transform();
  assert(Math.hypot(moved.position[0] - scaled.position[0], moved.position[2] - scaled.position[2]) > .1,
    `Move gesture did not affect wall: ${JSON.stringify({ scaled, moved })}`);
  const colliderCenter = await page.evaluate(() => {
    const game = window.__wireTheHouse;
    const obstacle = game.room.mansionWing.obstaclesAt(0).find(item => item.id === game.levelEditor.gizmo.object.name);
    return (obstacle.minX + obstacle.maxX) / 2;
  });
  assert(Math.abs(colliderCenter - moved.position[0]) < .02, `Touch move did not update collision: ${colliderCenter} vs ${moved.position[0]}`);
  const cameraState = () => page.evaluate(() => {
    const editor = window.__wireTheHouse.levelEditor;
    return { position: editor.camera.position.toArray(), distance: editor.camera.position.distanceTo(editor.orbit.target) };
  });
  const cameraBefore = await cameraState();
  const orbitPoint = await page.evaluate(() => {
    const e = window.__wireTheHouse.levelEditor;
    for (const [x, y] of [[330, 470], [330, 300], [35, 460], [280, 500]]) {
      if (document.elementFromPoint(x, y)?.id !== 'game-canvas') continue;
      e.pointerRay({ clientX: x, clientY: y });
      if (!e.raycaster.intersectObjects([e.gizmo.object], true).length) return { x, y };
    }
    throw new Error('No uncovered empty canvas point available for orbit gesture');
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...orbitPoint, id: 1 }] });
  // TOP begins exactly above the floor. A diagonal orbit gesture introduces
  // polar tilt and yaw together; horizontal-only yaw is visually undefined
  // at that pole and must not be mistaken for a failed touch gesture.
  for (let step = 1; step <= 6; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: orbitPoint.x + step * 7, y: orbitPoint.y + step * 7, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(300);
  const cameraAfterOrbit = await cameraState();
  assert(Math.hypot(...cameraAfterOrbit.position.map((value, index) => value - cameraBefore.position[index])) > .05,
    `Empty-space touch orbit did not move camera: ${JSON.stringify({ cameraBefore, cameraAfterOrbit })}`);
  const pinchStart = await page.evaluate(() => {
    const rect = document.querySelector('#level-halo-handle').getBoundingClientRect();
    const first = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const second = [[first.x + 110, first.y], [first.x - 110, first.y], [260, 350]]
      .map(([x, y]) => ({ x, y })).find(point => document.elementFromPoint(point.x, point.y)?.id === 'game-canvas');
    if (!second || !document.elementFromPoint(first.x, first.y)?.closest('#level-halo-handle')) throw new Error('Pinch test needs one finger on Halo and one on canvas');
    return { first, second };
  });
  const { first, second } = pinchStart;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...first, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...first, id: 1 }, { ...second, id: 2 }] });
  const outward = Math.sign(second.x - first.x) || 1;
  for (let step = 1; step <= 5; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [
    { x: first.x - outward * step * 7, y: first.y, id: 1 },
    { x: second.x + outward * step * 7, y: second.y, id: 2 },
  ] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(300);
  const cameraAfterPinch = await cameraState();
  assert(Math.abs(cameraAfterPinch.distance - cameraAfterOrbit.distance) > .05,
    `Pinch did not zoom camera: ${JSON.stringify({ cameraAfterOrbit, cameraAfterPinch })}`);
  const panBefore = await page.evaluate(() => window.__wireTheHouse.levelEditor.orbit.target.toArray());
  await page.locator('.level-editor__bottom-nav [data-editor-tab="select"]').tap();
  await page.locator('#level-camera-mobile').tap();
  assert.equal(await page.locator('#level-camera-mobile').getAttribute('aria-pressed'), 'true');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 45, y: 210, id: 1 }] });
  for (let step = 1; step <= 6; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 45 + step * 9, y: 210, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(300);
  const panAfter = await page.evaluate(() => window.__wireTheHouse.levelEditor.orbit.target.toArray());
  assert(Math.hypot(...panAfter.map((value, index) => value - panBefore[index])) > .05,
    `One-finger camera pan did not move target: ${JSON.stringify({ panBefore, panAfter })}`);
  await mkdir('artifacts/site-pro-04/review/level-editor', { recursive: true });
  await page.screenshot({ path: `artifacts/site-pro-04/review/level-editor/${device}-touch.png`, fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ pass: true, before, rotated, scaled, moved, cameraBefore, cameraAfterOrbit, cameraAfterPinch, panBefore, panAfter, errors }));
} finally { await browser.close(); }
