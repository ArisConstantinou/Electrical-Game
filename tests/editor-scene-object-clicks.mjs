import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await blockPointerLock(context);
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&editor=1&renderer=webgl');
  await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 45000 });
  const canvas = await page.locator('#game-canvas').boundingBox();
  assert(canvas);
  const cases = [
    { name: 'neighbor roof', point: [-14.5, 2.52, 2.1], eyeHeight: 8, expected: 'Residence roof slab and parapet' },
    { name: 'courtyard olive', point: [13.35, 1.3, 11.35], eyeHeight: 9, expected: 'Existing olive tree retained in open mansion court' },
    { name: 'walking pads', point: [9.86, .025, 12.16], eyeHeight: 8, expected: 'Loose temporary walking pads across unpaved court' },
  ];
  for (const item of cases) {
    await page.evaluate(({ point, eyeHeight }) => {
      const editor = window.__wireTheHouse.levelEditor;
      editor.setViewMode('3d');
      editor.setFloorIndex(0);
      editor.camera.position.set(point[0], eyeHeight, point[2] + .01);
      editor.orbit.target.set(...point);
      editor.camera.lookAt(editor.orbit.target);
      editor.orbit.update();
    }, item);
    await page.waitForTimeout(100);
    await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    const selected = await page.evaluate(() => window.__wireTheHouse.levelEditor.selected?.userData.levelEditorLabel ?? null);
    console.log(JSON.stringify({ name: item.name, selected }));
    assert.equal(selected, item.expected, `${item.name} must select through the visible game canvas`);
  }
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await blockPointerLock(mobile);
  const touchPage = await mobile.newPage();
  await touchPage.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&editor=1&renderer=webgl');
  await touchPage.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 45000 });
  const touchCanvas = await touchPage.locator('#game-canvas').boundingBox();
  assert(touchCanvas);
  await mkdir('artifacts/site-pro-04/review/level-editor-selection', { recursive: true });
  for (const item of cases) {
    const mobileView = { ...item, eyeHeight: item.name === 'neighbor roof' ? 12 : item.eyeHeight };
    await touchPage.evaluate(({ point, eyeHeight }) => {
      const editor = window.__wireTheHouse.levelEditor;
      editor.setViewMode('3d');
      editor.setFloorIndex(0);
      editor.camera.position.set(point[0], eyeHeight, point[2] + .01);
      editor.orbit.target.set(...point);
      editor.camera.lookAt(editor.orbit.target);
      editor.orbit.update();
    }, mobileView);
    await touchPage.waitForTimeout(100);
    await touchPage.touchscreen.tap(touchCanvas.x + touchCanvas.width / 2, touchCanvas.y + touchCanvas.height / 2);
    const selected = await touchPage.evaluate(() => window.__wireTheHouse.levelEditor.selected?.userData.levelEditorLabel ?? null);
    console.log(JSON.stringify({ mobile: item.name, selected }));
    assert.equal(selected, item.expected, `${item.name} must select on portrait touch`);
    if (item.name !== 'walking pads')
      await touchPage.screenshot({ path: `artifacts/site-pro-04/review/level-editor-selection/${item.name === 'neighbor roof' ? 'roof' : 'olive'}-selected-mobile.png` });
    if (item.name === 'neighbor roof') {
      await touchPage.locator('#level-dock-toggle').click();
      await touchPage.screenshot({ path: 'artifacts/site-pro-04/review/level-editor-selection/roof-selected-mobile-clear-view.png' });
      await touchPage.locator('#level-dock-toggle').click();
    }
  }
  await mobile.close();
} finally { await browser.close(); }
