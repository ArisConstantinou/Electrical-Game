import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';
import { openEditorTab } from './editor-navigation.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const [device, viewport, touch] of [
    ['desktop', { width: 1440, height: 900 }, false],
    ['mobile-portrait', { width: 390, height: 844 }, true],
  ]) {
    const context = await browser.newContext({ viewport, isMobile: touch, hasTouch: touch });
    await blockPointerLock(context);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&editor=1&renderer=webgl');
    await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 120000 });
    await openEditorTab(page, 'select');
    await page.locator('#level-view-quick [data-level-view="3d"]').click();
    await page.locator('.level-editor__bottom-nav [data-editor-tab="select"]').click();
    for (const label of [
      'Residence roof slab and parapet',
      'Existing olive tree retained in open mansion court',
      'Loose temporary walking pads across unpaved court',
    ]) {
      const point = await page.evaluate(label => {
        const game = window.__wireTheHouse, editor = game.levelEditor;
        const target = [...game.room.mansionWing.editableAssets.values()].find(item => item.userData.levelEditorLabel === label);
        if (!target) return { error: 'not registered', label };
        const centre = target.getWorldPosition(new target.position.constructor());
        editor.orbit.target.copy(centre);
        editor.camera.position.copy(centre).add(new centre.constructor(0, 18, .01));
        editor.camera.lookAt(centre);
        editor.orbit.update();
        editor.camera.updateMatrixWorld(true);
        const candidates = editor.editables().filter(item => editor.isSelectableVisible(item));
        for (let radius = 0; radius <= 10; radius++) {
          for (let yi = -radius; yi <= radius; yi++) for (let xi = -radius; xi <= radius; xi++) {
            if (Math.max(Math.abs(xi), Math.abs(yi)) !== radius) continue;
            const x = xi / 45, y = yi / 45;
            editor.raycaster.setFromCamera({ x, y }, editor.camera);
            const hit = editor.raycaster.intersectObjects(candidates, true).find(item => !item.object.isPoints && editor.isHitVisible(item.object));
            let owner = hit?.object;
            while (owner && owner !== target && owner !== game.renderer.scene) owner = owner.parent;
            if (owner === target) return { x, y, id: target.name, label };
          }
        }
        return { error: 'no frontmost visible point', label, id: target.name };
      }, label);
      assert(!point.error, JSON.stringify(point));
      const rect = await page.locator('#game-canvas').boundingBox();
      assert(rect);
      const x = rect.x + (point.x + 1) * rect.width / 2;
      const y = rect.y + (1 - point.y) * rect.height / 2;
      if (touch) await page.touchscreen.tap(x, y);
      else await page.mouse.click(x, y);
      assert.equal(await page.evaluate(() => window.__wireTheHouse.levelEditor.selected?.name), point.id,
        `${device}: click must select ${label}`);
    }
    assert.deepEqual(errors, []);
    console.log(`${device}: roof, olive tree and courtyard pads select by canvas click`);
    await context.close();
  }
} finally { await browser.close(); }
