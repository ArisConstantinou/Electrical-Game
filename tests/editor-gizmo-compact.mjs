import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { blockPointerLock } from './browser-safety.mjs';
import { openEditorBuild } from './editor-navigation.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const output = 'artifacts/site-pro-04/review/editor-gizmo-compact';
await mkdir(output, { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await blockPointerLock(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&template=blank&editor=1&renderer=webgl');
  await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 120000 });
  await openEditorBuild(page);
  await page.locator('#level-add-brick').click();
  await page.evaluate(() => {
    const editor = window.__wireTheHouse.levelEditor;
    editor.setViewMode('2d');
    editor.selected.scale.x = .2;
    const centre = editor.selected.getWorldPosition(editor.orbit.target);
    editor.camera.position.set(centre.x, centre.y + 23, centre.z + .01);
    editor.orbit.target.copy(centre);
    editor.orbit.update();
  });
  await page.waitForTimeout(300);
  const state = await page.evaluate(() => {
    const editor = window.__wireTheHouse.levelEditor;
    return { gizmoSize: editor.gizmo.size, selected: editor.selected?.name,
      endpointsHidden: document.querySelector('#level-wall-endpoints').hidden,
      badgeCount: document.querySelectorAll('#level-halo-badge').length,
      highlights: editor.highlights.size };
  });
  assert.match(state.selected, /^Editor brick-wall /);
  assert(state.gizmoSize <= .22, `Small piece must get a compact gizmo: ${JSON.stringify(state)}`);
  assert.equal(state.endpointsHidden, true);
  assert.equal(state.badgeCount, 0);
  assert.equal(state.highlights, 1);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: `${output}/desktop-small-wall-top.png` });
  console.log(JSON.stringify(state));
} finally { await browser.close(); }
