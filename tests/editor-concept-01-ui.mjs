import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
await mkdir('output/editor-concept-01', { recursive: true });
try {
  for (const [label, viewport] of [['mobile', { width: 390, height: 844 }], ['tablet', { width: 820, height: 1180 }]]) {
    if (process.argv[2] && process.argv[2] !== label) continue;
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&renderer=webgl');
    await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 120000 });
    await page.locator('#start-level-editor').tap();
    await page.waitForFunction(() => window.__wireTheHouse?.levelEditor.active);
    const editor = page.locator('#level-editor');
    assert(!(await editor.evaluate(node => node.classList.contains('sheet-open'))));
    assert(await page.locator('.level-editor__bottom-nav').isVisible());
    assert(!(await page.locator('#level-editor header').isVisible()));
    await page.screenshot({ path: `output/editor-concept-01/${label}-dock.png` });
    await page.locator('[data-editor-tab="build"]').first().tap();
    assert(await page.locator('#level-add-brick').isVisible());
    assert(await page.locator('#level-add-stair').isVisible());
    await page.screenshot({ path: `output/editor-concept-01/${label}-build.png` });
    await page.locator('[data-editor-tab="build"]').first().tap();
    assert(!(await page.locator('#level-add-brick').isVisible()));
    await page.locator('#level-dock-toggle').tap();
    assert(await editor.evaluate(node => node.classList.contains('dock-collapsed')));
    assert(!(await page.locator('[data-editor-tab="build"]').first().isVisible()));
    await page.screenshot({ path: `output/editor-concept-01/${label}-collapsed.png` });
    await page.locator('#level-dock-toggle').tap();
    assert(await page.locator('[data-editor-tab="select"]').first().isVisible());
    await page.locator('[data-editor-tab="select"]').first().tap();
    assert(await page.locator('#level-view-quick').isVisible());
    await page.locator('#level-view-quick [data-level-view="2d"]').tap();
    assert.equal(await page.evaluate(() => window.__wireTheHouse.renderer.viewCamera?.type), 'PerspectiveCamera');
    await page.screenshot({ path: `output/editor-concept-01/${label}-view-top-ground.png` });
    await page.locator('#level-floor-quick').selectOption('1');
    assert.equal(await page.locator('#level-floor').inputValue(), '1');
    await page.screenshot({ path: `output/editor-concept-01/${label}-view-top.png` });
    await page.locator('#level-view-quick [data-level-view="3d"]').tap();
    await page.locator('#level-floor-quick').selectOption('-1');
    await page.locator('[data-editor-tab="starts"]').first().tap();
    assert(await page.locator('#level-player').isVisible());
    assert(await page.locator('#level-scene-exit').isVisible());
    await page.locator('[data-editor-tab="build"]').first().tap();
    await page.locator('#level-add-brick').tap();
    const wallVolume = await page.evaluate(() => {
      const editor = window.__wireTheHouse.levelEditor;
      const wall = editor.gizmo.object;
      const bricks = wall.children.find(item => item.isInstancedMesh);
      editor.orbit.target.set(wall.position.x, wall.position.y + 1.5, wall.position.z);
      editor.camera.position.set(wall.position.x + 2.3, wall.position.y + 1.9, wall.position.z + 4.2);
      editor.orbit.update();
      return { brickCount: bricks?.count, geometry: bricks?.geometry.type,
        brickDepth: bricks?.instanceMatrix.array[10],
        collider: window.__wireTheHouse.room.mansionWing.obstaclesAt(wall.position.y).find(item => item.id === wall.name) };
    });
    assert(wallVolume.brickCount > 100 && wallVolume.geometry === 'BoxGeometry');
    assert(wallVolume.brickDepth > .2);
    assert(wallVolume.collider.maxZ - wallVolume.collider.minZ > .2);
    await page.locator('#level-halo-handle').waitFor({ state: 'visible' });
    assert(!(await page.evaluate(() => window.__wireTheHouse.levelEditor.gizmo.getHelper().visible)));
    await page.screenshot({ path: `output/editor-concept-01/${label}-orbit-halo.png` });
    await page.evaluate(() => { for (const overlay of window.__wireTheHouse.levelEditor.highlights.values()) overlay.visible = false; });
    await page.screenshot({ path: `output/editor-concept-01/${label}-brick-without-highlight.png` });
    await page.evaluate(() => { for (const overlay of window.__wireTheHouse.levelEditor.highlights.values()) overlay.visible = true; });
    const beforeX = await page.evaluate(() => window.__wireTheHouse.levelEditor.gizmo.object.position.x);
    const handle = await page.locator('#level-halo-handle').boundingBox();
    assert(handle);
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + 48, handle.y + handle.height / 2, { steps: 5 });
    await page.mouse.up();
    const afterX = await page.evaluate(() => window.__wireTheHouse.levelEditor.gizmo.object.position.x);
    assert(Math.abs(afterX - beforeX) > .1, `Orbit Halo must move selected wall: ${beforeX} → ${afterX}`);
    await page.locator('[data-editor-tab="starts"]').first().tap();
    await page.locator('#level-scene-exit').tap();
    assert(!(await page.evaluate(() => window.__wireTheHouse.levelEditor.active)));
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`${label} dock/build/collapse/view/scene/brick-volume pass`);
  }
} finally { await browser.close(); }
