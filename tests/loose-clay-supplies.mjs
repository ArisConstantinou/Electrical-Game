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
        '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
      await route.fulfill({ status: 200, body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
    } catch { await route.abort(); }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://arisconstantinou.github.io/Electrical-Game/?mansion=preview&editor=1&renderer=webgl');
  await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 120000 });
  const result = await page.evaluate(() => {
    const game = window.__wireTheHouse, wing = game.room.mansionWing;
    const find = label => [...wing.editableAssets.values()].find(asset => asset.userData.levelEditorLabel === label);
    const summarize = label => {
      const asset = find(label);
      if (!asset) throw new Error(`Missing Studio asset: ${label}`);
      const batches = [];
      asset.traverse(child => { if (child.isInstancedMesh) batches.push(child); });
      return { id: asset.name, units: batches.reduce((total, batch) => total + batch.count, 0),
        batches: batches.length, first: batches[0]?.geometry };
    };
    const garage = summarize('Separate stacked clay units awaiting garage partition work');
    const courtyard = summarize('Pallet stack of unlaid clay units in courtyard');
    const pallet = find('Raised pallet under staged unfitted masonry supplies');
    const geometry = garage.first;
    const pos = geometry.getAttribute('position');
    const triangleContains = (px, py, ax, ay, bx, by, cx, cy) => {
      const cross = (ux, uy, vx, vy) => ux * vy - uy * vx;
      const d1 = cross(bx - ax, by - ay, px - ax, py - ay);
      const d2 = cross(cx - bx, cy - by, px - bx, py - by);
      const d3 = cross(ax - cx, ay - cy, px - cx, py - cy);
      return (d1 >= -1e-5 && d2 >= -1e-5 && d3 >= -1e-5) ||
        (d1 <= 1e-5 && d2 <= 1e-5 && d3 <= 1e-5);
    };
    const endSolidAt = (y, z) => {
      for (let i = 0; i < pos.count; i += 3) {
        if ([0, 1, 2].some(j => Math.abs(pos.getX(i + j) - .5) > .001)) continue;
        if (triangleContains(y, z, pos.getY(i), pos.getZ(i), pos.getY(i + 1), pos.getZ(i + 1),
          pos.getY(i + 2), pos.getZ(i + 2))) return true;
      }
      return false;
    };
    const bores = [-.25, .25].flatMap(y => [-.25, .25].map(z => endSolidAt(y, z)));
    const solidWeb = endSolidAt(0, 0);
    const obstacle = wing.obstaclesAt(0).find(item => item.id === garage.id);
    return { garage: { id: garage.id, units: garage.units, batches: garage.batches },
      courtyard: { id: courtyard.id, units: courtyard.units, batches: courtyard.batches },
      pallet: { id: pallet?.name, boardMeshes: pallet?.children[0]?.children?.length },
      bores, solidWeb, obstacle: !!obstacle };
  });
  assert.equal(result.garage.units, 28);
  assert.equal(result.courtyard.units, 48);
  assert(result.garage.batches <= 3 && result.courtyard.batches <= 3);
  assert(result.pallet.id?.startsWith('site-asset:'));
  assert.equal(result.pallet.boardMeshes, 1, 'The timber boards should share one render mesh');
  assert.deepEqual(result.bores, [false, false, false, false], 'All four bores must be open geometry');
  assert.equal(result.solidWeb, true, 'The clay between bores must remain solid');
  assert(result.obstacle, 'The garage stack must retain its player obstacle');
  const aimedId = await page.evaluate(() => {
    const editor = window.__wireTheHouse.levelEditor;
    const asset = [...window.__wireTheHouse.room.mansionWing.editableAssets.values()]
      .find(item => item.userData.levelEditorLabel === 'Separate stacked clay units awaiting garage partition work');
    const center = asset.getWorldPosition(asset.position.clone());
    editor.camera.position.copy(center).add(new center.constructor(0, 1.2, 1.4));
    editor.orbit.target.copy(center);
    editor.camera.lookAt(center);
    editor.orbit.update();
    return asset.name;
  });
  const canvas = await page.locator('#game-canvas').boundingBox();
  assert(canvas);
  await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  const selected = await page.evaluate(() => window.__wireTheHouse.levelEditor.selected?.name ??
    window.__wireTheHouse.levelEditor.gizmo.object?.name ?? null);
  assert.equal(selected, aimedId, 'The new brick group must remain selectable by a Studio canvas click');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ...result, selected }));
} finally { await browser.close(); }
