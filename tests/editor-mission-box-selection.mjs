import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

await mkdir('output/editor-mission-box-selection', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const [name, viewport, mobile] of [
    ['desktop', { width: 1440, height: 900 }, false],
    ['mobile', { width: 390, height: 844 }, true],
  ]) {
    const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
    await blockPointerLock(context);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&editor=1&renderer=webgl');
    await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 120000 });
    const rect = await page.locator('#game-canvas').boundingBox();
    assert(rect);
    const targets = [];
    for (const index of [0, 1, 2]) {
      const target = await page.evaluate(index => {
        const game = window.__wireTheHouse, editor = game.levelEditor;
        const point = game.mission.points[index];
        if (!point?.boxGroup.visible) throw new Error(`Mission box ${index} is not visible`);
        editor.setViewMode('3d');
        const centre = point.boxGroup.getWorldPosition(point.position.clone());
        editor.camera.position.copy(centre).add(centre.clone().set(0, .35, 2));
        editor.orbit.target.copy(centre);
        editor.camera.lookAt(centre);
        editor.orbit.update();
        editor.camera.updateMatrixWorld(true);
        return { id: point.name, registered: game.room.mansionWing.editableAssets.has(point.name) };
      }, index);
      assert(target.registered, `${name}: installed mission box ${index} needs an editor entry`);
      await page.waitForTimeout(150);
      if (mobile) await page.touchscreen.tap(rect.x + rect.width / 2, rect.y + rect.height / 2);
      else await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
      const selected = await page.evaluate(() => window.__wireTheHouse.levelEditor.selected?.name);
      assert.equal(selected, target.id, `${name}: canvas click must select mission box ${index}`);
      assert(await page.locator('[data-axis="x"]').isDisabled(), `${name}: mission box is selection-only until gameplay placement is linked`);
      targets.push(target.id);
    }
    await page.screenshot({ path: `output/editor-mission-box-selection/${name}.png` });
    const visibility = await page.evaluate(() => {
      const game = window.__wireTheHouse, editor = game.levelEditor;
      editor.setFloorIndex(1);
      const upper = game.mission.root.visible;
      editor.setFloorIndex(0);
      const ground = game.mission.root.visible;
      editor.setTemplateMode('blank');
      const blank = game.mission.root.visible;
      editor.setTemplateMode('mansion');
      const restoredTemplate = game.mission.root.visible;
      editor.close();
      const gameplay = game.mission.root.visible;
      return { upper, ground, blank, restoredTemplate, gameplay };
    });
    assert.deepEqual(visibility, { upper: false, ground: true, blank: false, restoredTemplate: true, gameplay: true },
      `${name}: ground mission boxes should disappear on upper floors and restore in gameplay`);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ name, targets, visibility }));
    await context.close();
  }
} finally { await browser.close(); }
