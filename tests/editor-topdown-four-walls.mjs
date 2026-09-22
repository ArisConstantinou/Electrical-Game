import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
await mkdir('output/editor-concept-01', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&template=blank&editor=1&renderer=webgl');
  await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 120000 });
  const walls = await page.evaluate(() => {
    const editor = window.__wireTheHouse.levelEditor;
    const wing = window.__wireTheHouse.room.mansionWing;
    let count = 0;
    for (const [label, x, z, yaw] of [['north', 8, 4, 0], ['south', 8, 10, 0], ['west', 5, 7, Math.PI / 2], ['east', 11, 7, Math.PI / 2]]) {
      const wall = wing.addEditorWall(crypto.randomUUID(), 'brick-wall', 6);
      wall.position.set(x, 0, z);
      wall.rotation.y = yaw;
      editor.added.add(wall.name);
      count++;
    }
    return count;
  });
  assert.equal(walls, 4);
  await page.locator('[data-editor-tab="select"]').first().tap();
  await page.locator('#level-view-quick [data-level-view="2d"]').tap();
  await page.evaluate(() => {
    const editor = window.__wireTheHouse.levelEditor;
    editor.orbit.target.set(8, 0, 7);
    editor.camera.position.set(8, 18, 7);
    editor.orbit.update();
  });
  await page.screenshot({ path: 'output/editor-concept-01/mobile-topdown-four-walls-open.png' });
  await page.locator('#level-dock-toggle').tap();
  await page.screenshot({ path: 'output/editor-concept-01/mobile-topdown-four-walls-clear.png' });
  const state = await page.evaluate(() => ({ camera: window.__wireTheHouse.renderer.viewCamera?.type,
    floor: window.__wireTheHouse.levelEditor.floorIndex,
    visible: [...window.__wireTheHouse.room.mansionWing.editableWalls.values()].filter(item => item.visible).length,
    offset: window.__wireTheHouse.levelEditor.camera.position.clone().sub(window.__wireTheHouse.levelEditor.orbit.target).toArray() }));
  assert.equal(state.camera, 'PerspectiveCamera');
  assert.equal(state.floor, 0);
  assert.equal(state.visible, 4);
  assert(Math.hypot(state.offset[0], state.offset[2]) < .02, 'TOP must start vertically above the live 3D room');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 45, y: 210, id: 1 }] });
  for (let step = 1; step <= 6; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 45 + step * 8, y: 210 - step * 8, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(250);
  const tilted = await page.evaluate(() => window.__wireTheHouse.levelEditor.camera.position.clone().sub(window.__wireTheHouse.levelEditor.orbit.target).toArray());
  assert(Math.hypot(tilted[0], tilted[2]) > .2, 'One-finger orbit must tilt TOP into an angled 3D view');
  state.tilted = tilted;
  await page.locator('#level-dock-toggle').tap();
  await page.locator('.level-editor__bottom-nav [data-editor-tab="select"]').tap();
  const offsets = {};
  for (const preset of ['front', 'back', 'left', 'right']) {
    await page.locator(`#level-view-quick [data-camera-preset="${preset}"]`).tap();
    offsets[preset] = await page.evaluate(() => window.__wireTheHouse.levelEditor.camera.position.clone().sub(window.__wireTheHouse.levelEditor.orbit.target).toArray());
    assert.equal(await page.locator(`#level-view-quick [data-camera-preset="${preset}"]`).getAttribute('aria-pressed'), 'true');
  }
  assert(offsets.front[2] > 5 && offsets.back[2] < -5 && offsets.left[0] < -5 && offsets.right[0] > 5,
    `Side presets must place the live 3D camera on the selected side: ${JSON.stringify(offsets)}`);
  await page.locator('#level-view-quick [data-level-view="2d"]').tap();
  await page.screenshot({ path: 'output/editor-concept-01/mobile-camera-presets.png' });
  state.sidePresets = offsets;
  console.log(JSON.stringify({ pass: true, state }));
} finally { await browser.close(); }
