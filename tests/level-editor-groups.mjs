import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';

const sidecar = '.studio/mansion-level.json';
const previous = await readFile(sidecar).catch(() => null);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
try {
  for (const [device, viewport, isMobile] of [
    ['mobile', { width: 390, height: 844 }, true],
    ['tablet', { width: 820, height: 1180 }, true],
    ['desktop', { width: 1440, height: 900 }, false],
  ]) {
    if (process.argv.includes('--mobile-only') && device !== 'mobile') continue;
    const context = await browser.newContext({ viewport, isMobile, hasTouch: isMobile });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(`${device}: ${error.message}`));
    await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&renderer=webgl', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 120_000 });
    await page.locator('#start-level-editor').click();
    if (isMobile) await page.locator('.level-editor__bottom-nav [data-editor-tab="build"]').click();
    await page.locator('#level-add-brick').click();
    if (isMobile) await page.locator('#level-details-toggle').click();
    const first = await page.evaluate(() => window.__wireTheHouse.levelEditor.gizmo.object.name);
    await page.locator('[data-axis="x"]').fill('11');
    await page.locator('[data-axis="x"]').dispatchEvent('change');
    await page.locator('[data-axis="z"]').fill('0');
    await page.locator('[data-axis="z"]').dispatchEvent('change');
    if (isMobile) await page.locator('.level-editor__bottom-nav [data-editor-tab="build"]').click();
    await page.locator('#level-add-concrete').click();
    if (isMobile) await page.locator('#level-details-toggle').click();
    const second = await page.evaluate(() => window.__wireTheHouse.levelEditor.gizmo.object.name);
    await page.locator('[data-axis="x"]').fill('13');
    await page.locator('[data-axis="x"]').dispatchEvent('change');
    await page.locator('[data-axis="z"]').fill('0');
    await page.locator('[data-axis="z"]').dispatchEvent('change');
    if (isMobile) await page.locator('.level-editor__bottom-nav [data-editor-tab="select"]').click();
    if (isMobile) await page.locator('#level-browser-toggle').click();
    await page.locator('#level-multi-toggle').click();
    await page.locator('#level-search').fill('Editor');
    await page.locator('#level-list button').filter({ hasText: 'Brick wall' }).last().click();
    assert.equal(await page.locator('#level-create-group').isEnabled(), true);
    assert.equal(await page.evaluate(() => window.__wireTheHouse.levelEditor.selectedObjects.size), 2);
    await page.locator('#level-create-group').click();
    if (isMobile) await page.locator('#level-details-toggle').click();
    assert.equal(await page.locator('#level-group-list button').count(), 1);
    assert.equal(await page.evaluate(() => window.__wireTheHouse.levelEditor.highlights.size), 2);
    await page.locator('#level-group-name').fill('Garage partitions');
    await page.locator('#level-group-name').dispatchEvent('change');
    const before = await page.evaluate(([a, b]) => {
      const wing = window.__wireTheHouse.room.mansionWing;
      return [wing.editableWalls.get(a).position.x, wing.editableWalls.get(b).position.x];
    }, [first, second]);
    const pivot = Number(await page.locator('[data-axis="x"]').inputValue());
    await page.locator('[data-axis="x"]').fill(String(pivot + 1));
    await page.locator('[data-axis="x"]').dispatchEvent('change');
    const moved = await page.evaluate(([a, b]) => {
      const wing = window.__wireTheHouse.room.mansionWing;
      return [wing.editableWalls.get(a).position.x, wing.editableWalls.get(b).position.x];
    }, [first, second]);
    assert(moved.every((x, index) => Math.abs(x - before[index] - 1) < .001), `Group move failed: ${before} -> ${moved}`);
    await page.locator('#level-yaw').fill('30');
    await page.locator('#level-yaw').dispatchEvent('change');
    const rotated = await page.evaluate(([a, b]) => {
      const wing = window.__wireTheHouse.room.mansionWing;
      return [wing.editableWalls.get(a).rotation.y, wing.editableWalls.get(b).rotation.y];
    }, [first, second]);
    assert(rotated.every(value => Math.abs(value) > .15), `Group rotate failed: ${rotated}`);
    if (isMobile) {
      await page.locator('#level-details-close').click();
      await page.locator('#level-scale').click();
      await page.locator('#level-details-toggle').click();
      await page.locator('#level-focus').click();
      await page.locator('#level-details-close').click();
      const point = await page.evaluate(id => {
        const editor = window.__wireTheHouse.levelEditor;
        const mesh = window.__wireTheHouse.room.mansionWing.editableWalls.get(id).children.find(child => child.isMesh);
        mesh.geometry.computeBoundingBox();
        const centre = mesh.geometry.boundingBox.min.clone().add(mesh.geometry.boundingBox.max).multiplyScalar(.5);
        mesh.localToWorld(centre); centre.project(editor.camera);
        const rect = window.__wireTheHouse.renderer.webgl.domElement.getBoundingClientRect();
        return { x: rect.left + (centre.x + 1) * rect.width / 2, y: rect.top + (1 - centre.y) * rect.height / 2 };
      }, first);
      const cdp = await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] });
      for (let step = 1; step <= 6; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y - step * 8, id: 1 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      const scales = await page.evaluate(([a, b]) => {
        const wing = window.__wireTheHouse.room.mansionWing;
        return [wing.editableWalls.get(a).scale.x, wing.editableWalls.get(b).scale.x];
      }, [first, second]);
      assert(scales.every(value => value > 1.1), `Group touch scale failed: ${scales}`);
    }
    await mkdir('artifacts/site-pro-04/review/level-editor', { recursive: true });
    await page.screenshot({ path: `artifacts/site-pro-04/review/level-editor/${device}-group.png`, fullPage: true });
    if (isMobile) await page.locator('.level-editor__bottom-nav [data-editor-tab="save"]').click();
    await page.locator(isMobile ? '#level-save-mobile' : '#level-save').click();
    await page.waitForFunction(() => document.querySelector('#level-status')?.textContent?.includes('saved separately'));
    const slotId = new URL(page.url()).searchParams.get('level');
    assert.match(slotId, /^[0-9a-f-]{36}$/i);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 120_000 });
    const saved = await page.evaluate(() => [...window.__wireTheHouse.levelEditor.groups.values()]);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].name, 'Garage partitions');
    assert.deepEqual([...saved[0].members].sort(), [first, second].sort());
    await page.locator('#start-level-editor').click();
    if (isMobile) { await page.locator('.level-editor__bottom-nav [data-editor-tab="select"]').click(); await page.locator('#level-browser-toggle').click(); }
    await page.locator('#level-group-list button').click();
    if (isMobile) await page.locator('#level-details-toggle').click();
    await page.locator('#level-ungroup').click();
    assert.equal(await page.evaluate(() => window.__wireTheHouse.levelEditor.groups.size), 0);
    await page.locator('#level-undo').click();
    assert.equal(await page.evaluate(() => window.__wireTheHouse.levelEditor.groups.size), 1);
    await page.locator('#level-redo').click();
    assert.equal(await page.evaluate(() => window.__wireTheHouse.levelEditor.groups.size), 0);
    assert.equal(errors.length, 0, errors.join('\n'));
    await context.close();
    await rm(`.studio/levels/${slotId}.json`, { force: true });
    console.log(`${device}: highlight, multi-select, group move/rotate${isMobile ? '/touch scale' : ''}, save/reload OK`);
    await rm(sidecar, { force: true });
  }
} finally {
  await browser.close();
  if (previous) await writeFile(sidecar, previous);
  else await rm(sidecar, { force: true });
}
