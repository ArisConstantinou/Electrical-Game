import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const dist = resolve('dist');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await blockPointerLock(context);
  await context.route('https://arisconstantinou.github.io/Electrical-Game/**', async route => {
    const relative = decodeURIComponent(new URL(route.request().url()).pathname.slice('/Electrical-Game/'.length)) || 'index.html';
    const file = resolve(dist, relative);
    if (!file.startsWith(`${dist}${sep}`)) return route.abort();
    try {
      if (!(await stat(file)).isFile()) return route.abort();
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
        '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
      await route.fulfill({ status: 200, body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
    } catch { await route.abort(); }
  });
  const basic = await context.newPage(), basicStoneRequests = [];
  basic.on('request', request => { if (request.url().includes('coral-stone-wall-')) basicStoneRequests.push(request.url()); });
  await basic.goto('https://arisconstantinou.github.io/Electrical-Game/?mansion=basic&renderer=webgl');
  await basic.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 120000 });
  assert.deepEqual(basicStoneRequests, [], 'The basic workroom should not fetch mansion fieldstone textures');
  await basic.close();
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://arisconstantinou.github.io/Electrical-Game/?mansion=preview&editor=1&renderer=webgl');
  await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 120000 });
  const summary = await page.evaluate(() => {
    const game = window.__wireTheHouse, editor = game.levelEditor;
    const asset = [...game.room.mansionWing.editableAssets.values()].find(item =>
      item.userData.levelEditorLabel === 'Low weathered limestone boundary beside the Cypriot construction site');
    if (!asset) throw new Error('Fieldstone boundary is absent from Studio assets');
    const face = asset.getObjectByName('Irregular individual field-boundary stones');
    const back = asset.getObjectByName('Irregular outer fieldstone face');
    const crown = asset.getObjectByName('Continuous exposed upper faces between irregular cap stones');
    const coping = asset.getObjectByName('Uneven individually placed fieldstone coping');
    if (!face || !back || !crown || !coping) throw new Error('Fieldstone boundary lacks physical faces or coping');
    face.geometry.computeBoundingBox();
    const bounds = face.geometry.boundingBox;
    const center = asset.getWorldPosition(asset.position.clone());
    editor.camera.position.copy(center).add(new center.constructor(-2.5, 1.2, 1.4));
    editor.orbit.target.copy(center);
    editor.camera.lookAt(center);
    editor.orbit.update();
    return { id: asset.name, faceVertices: face.geometry.getAttribute('position').count,
      length: bounds.max.z - bounds.min.z, copingStones: coping.count,
      textured: !!face.material.map?.image?.width, normalMapped: !!face.material.normalMap?.image?.width,
      displaced: !!face.material.displacementMap?.image?.width };
  });
  assert(summary.faceVertices >= 4000 && Math.abs(summary.length - 60) < .01);
  assert.equal(summary.copingStones, 108);
  assert(summary.textured && summary.normalMapped && summary.displaced);
  const canvas = await page.locator('#game-canvas').boundingBox();
  assert(canvas);
  await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  const selected = await page.evaluate(() => window.__wireTheHouse.levelEditor.selected?.name ??
    window.__wireTheHouse.levelEditor.gizmo.object?.name ?? null);
  assert.equal(selected, summary.id, 'The stone wall must remain selectable in Studio');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ...summary, selected }));
} finally { await browser.close(); }
