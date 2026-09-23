import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { blockPointerLock } from './browser-safety.mjs';
import { openEditorTab } from './editor-navigation.mjs';

const baseline = process.argv.includes('--baseline');
const deviceName = process.argv.find(arg => arg.startsWith('--device='))?.slice('--device='.length) ?? 'portrait';
const devices = {
  portrait: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  landscape: { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true },
  tablet: { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 } },
};
assert(devices[deviceName], `Unknown viewport: ${deviceName}`);
const output = new URL('../artifacts/site-pro-04/review/editor-hide-player-render/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext(devices[deviceName]);
  await blockPointerLock(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&editor=1&renderer=webgl');
  await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active && window.__wireTheHouse.workerBody.loaded,
    null, { timeout: 120000 });
  let startVisibility = '';
  for (let attempt = 0; attempt < 20; attempt++) {
    await page.waitForTimeout(250);
    startVisibility = await page.locator('#start-screen').evaluate(element => getComputedStyle(element).visibility);
    if (startVisibility === 'hidden') break;
  }
  assert.equal(startVisibility, 'hidden', 'Editor canvas must not remain covered by the start menu');
  // Recreate the old render configuration in the same scene for a controlled
  // comparison after the source change, without altering the saved level.
  if (baseline) await page.evaluate(() => {
    const game = window.__wireTheHouse;
    game.workerBody.visible = game.fpsRig.visible = true;
    game.levelEditor.editorFog = null;
    game.renderer.scene.fog.near = 22;
    game.renderer.scene.fog.far = 88;
  });
  const before = await page.evaluate(() => {
    const game = window.__wireTheHouse;
    game.renderer.render();
    const info = game.renderer.webgl.info.render;
    return { bodyVisible: game.workerBody.visible, rigVisible: game.fpsRig.visible,
      calls: info.calls, triangles: info.triangles, fogNear: game.renderer.scene.fog.near,
      fogFar: game.renderer.scene.fog.far,
      cameraDistance: game.levelEditor.camera.position.distanceTo(game.levelEditor.orbit.target) };
  });
  await page.screenshot({ path: fileURLToPath(new URL(baseline ? 'before.png' :
    deviceName === 'portrait' ? 'after.png' : `after-${deviceName}.png`, output)) });
  const baselineHidden = await page.evaluate(() => {
    const game = window.__wireTheHouse, body = game.workerBody.visible, rig = game.fpsRig.visible;
    game.workerBody.visible = game.fpsRig.visible = false;
    game.renderer.render();
    const info = game.renderer.webgl.info.render;
    const result = { calls: info.calls, triangles: info.triangles };
    game.workerBody.visible = body; game.fpsRig.visible = rig;
    return result;
  });
  if (baseline) assert(before.bodyVisible && before.rigVisible && before.fogFar === 88,
    'Reproduce player body, rig and gameplay fog rendered in the editor');
  else {
    assert(!before.bodyVisible && !before.rigVisible, 'Editor should hide player body and first-person rig');
    assert(before.fogFar > before.cameraDistance + 80,
      'Portrait overview must remain visible beyond the gameplay fog range');
    await openEditorTab(page, 'starts');
    await page.locator('#level-scene-exit').click();
    const closed = await page.evaluate(() => ({ body: window.__wireTheHouse.workerBody.visible,
      rig: window.__wireTheHouse.fpsRig.visible, fogNear: window.__wireTheHouse.renderer.scene.fog.near,
      fogFar: window.__wireTheHouse.renderer.scene.fog.far }));
    assert(closed.body && closed.rig && closed.fogNear === 22 && closed.fogFar === 88,
      'Closing editor must restore the original player visuals and gameplay fog');
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ device: deviceName, before, baselineHidden, errors }));
  await context.close();
} finally { await browser.close(); }
