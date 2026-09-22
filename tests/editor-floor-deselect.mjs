import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext(mobile
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
      : { viewport: { width: 1440, height: 900 } });
    await blockPointerLock(context);
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&editor=1&renderer=webgl');
    await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 45000 });
    const target = await page.evaluate(() => {
      const game = window.__wireTheHouse, editor = game.levelEditor, wing = game.room.mansionWing;
      editor.setFloorIndex(1);
      editor.setViewMode('2d');
      const floor = [...wing.editableAssets.values()].find(item => item.userData.levelEditorLabel === 'L1 unfinished first room structural floor');
      const wall = [...wing.editableWalls.values()].find(item => item.visible && item.position.y >= 3.2);
      if (!floor || !wall) throw new Error('Missing L1 floor or wall');
      editor.setSelection([wall]);
      editor.orbit.target.set(9.5, 3.2, 2.25);
      editor.camera.position.set(9.5, 12, 2.26);
      editor.camera.lookAt(editor.orbit.target);
      editor.orbit.update();
      return floor.name;
    });
    const rect = await page.locator('#game-canvas').boundingBox();
    assert(rect);
    const tapFloor = async () => {
      const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
      if (mobile) await page.touchscreen.tap(x, y);
      else await page.mouse.click(x, y);
      return page.evaluate(() => window.__wireTheHouse.levelEditor.selected?.name ?? null);
    };
    assert.equal(await tapFloor(), null, 'First tap on another floor clears the old wall selection');
    assert.equal(await tapFloor(), target, 'Second tap selects the floor for editing');
    if (mobile) {
      const output = new URL('../artifacts/site-pro-04/review/level-editor-selection/', import.meta.url);
      await mkdir(output, { recursive: true });
      await page.screenshot({ path: fileURLToPath(new URL('l1-floor-selected-mobile.png', output)) });
    }
    console.log(JSON.stringify({ mobile, target, clickAwayCleared: true, floorSelected: true }));
    await context.close();
  }
} finally { await browser.close(); }
