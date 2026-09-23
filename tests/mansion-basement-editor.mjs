import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const out = 'output/mansion-basement-editor';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { cases: [], errors: [], environment: 'Windows Chrome; mobile is touch viewport emulation' };
try {
  for (const device of [
    { name: 'mobile-portrait', viewport: { width: 390, height: 844 }, mobile: true },
    { name: 'desktop', viewport: { width: 1366, height: 768 }, mobile: false },
  ]) {
    const context = await browser.newContext({ viewport: device.viewport, deviceScaleFactor: 1,
      isMobile: device.mobile, hasTouch: device.mobile });
    await blockPointerLock(context);
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(`${device.name}: ${error.message}`));
    await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&renderer=webgl&editor=1');
    await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 120000 });
    await page.locator('.level-editor__bottom-nav [data-editor-tab="select"]').click();
    const floor = '#level-floor-quick';
    const cases = [];
    for (const [index, label, elevation] of [[5, 'B1', -3.4], [6, 'B2', -6.8]]) {
      await page.locator(floor).selectOption(String(index));
      await page.waitForTimeout(250);
      const state = await page.evaluate(() => {
        const game = window.__wireTheHouse;
        const wing = game.room.mansionWing;
        return { floor: game.levelEditor.floorIndex,
          cameraY: game.levelEditor.camera.position.y, targetY: game.levelEditor.orbit.target.y,
          visibleBasement: wing.children.filter(object => object.visible &&
            (object.name.startsWith('B1 ') || object.name.startsWith('B2 ') || object.userData.levelEditorFloor >= 5))
            .map(object => object.name),
          wrongBasement: wing.children.filter(object => object.visible &&
            (object.userData.levelEditorFloor === 5 || object.name.startsWith('B1 ')
              ? game.levelEditor.floorIndex !== 5
              : object.userData.levelEditorFloor === 6 || object.name.startsWith('B2 ')
                ? game.levelEditor.floorIndex !== 6 : false)).map(object => object.name),
          startMarkersVisible: game.levelEditor.playerMarker.visible || game.levelEditor.apprenticeMarker.visible,
          visibleUpper: wing.children.filter(object => object.visible && /^L[1-4] /.test(object.name)).length,
          roomVisible: game.room.children.filter(object => object !== wing && object !== game.room.exterior && object.visible).length,
          renderError: game.renderer.renderError };
      });
      assert.equal(state.floor, index);
      assert(Math.abs(state.targetY - elevation) < .01, `${device.name} ${label} target ${state.targetY}`);
      assert(state.visibleBasement.length > 10, `${device.name} ${label} missing basement geometry`);
      assert(state.visibleBasement.every(name => name.startsWith(`${label} `) || name.startsWith('site-asset:')),
        `${device.name} ${label} contains another basement`);
      assert.deepEqual(state.wrongBasement, [], `${device.name} ${label} shows another basement`);
      assert.equal(state.startMarkersVisible, false, `${device.name} ${label} shows another floor's start marker`);
      assert.equal(state.visibleUpper, 0);
      assert.equal(state.roomVisible, 0);
      assert.equal(state.renderError, '');
      await page.locator('.level-editor__bottom-nav [data-editor-tab="select"]').click();
      await page.screenshot({ path: `${out}/${device.name}-${label}-top.png` });
      await page.locator('.level-editor__bottom-nav [data-editor-tab="select"]').click();
      cases.push({ label, ...state });
    }
    report.cases.push({ device: device.name, floors: cases });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
} finally {
  await browser.close();
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
