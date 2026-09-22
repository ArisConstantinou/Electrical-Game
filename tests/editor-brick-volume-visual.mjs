import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
await mkdir('output/editor-concept-01', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&template=blank&editor=1&renderer=webgl');
  await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 120000 });
  await page.locator('[data-editor-tab="build"]').first().tap();
  await page.locator('#level-add-brick').tap();
  const geometry = await page.evaluate(() => {
    const editor = window.__wireTheHouse.levelEditor;
    const wall = editor.gizmo.object;
    editor.orbit.target.set(wall.position.x, wall.position.y + 1.5, wall.position.z);
    editor.camera.position.set(wall.position.x + 2.8, wall.position.y + 4.4, wall.position.z + 5.6);
    editor.orbit.update();
    const bricks = wall.children.find(item => item.isInstancedMesh);
    return { count: bricks.count, unitDepth: bricks.instanceMatrix.array[10],
      bounds: window.__wireTheHouse.room.mansionWing.obstaclesAt(0).find(item => item.id === wall.name) };
  });
  await page.locator('[data-editor-tab="transform"]').first().tap();
  await page.screenshot({ path: 'output/editor-concept-01/mobile-brick-3d-selected.png' });
  await page.locator('#level-dock-toggle').tap();
  await page.screenshot({ path: 'output/editor-concept-01/mobile-brick-3d-clear.png' });
  assert(geometry.count > 100 && geometry.unitDepth > .2);
  assert(geometry.bounds.maxZ - geometry.bounds.minZ > .2);
  console.log(JSON.stringify({ pass: true, geometry }));
} finally { await browser.close(); }
