import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { blockPointerLock } from './browser-safety.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const base = process.env.QA_BASE ?? 'http://127.0.0.1:5365/Electrical-Game/';
const installDistRoutes = async context => {
  if (!process.argv.includes('--dist')) return;
  const dist = resolve('dist');
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
    '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2' };
  await context.route('https://arisconstantinou.github.io/Electrical-Game/**', async route => {
    const path = resolve(dist, decodeURIComponent(new URL(route.request().url()).pathname.slice('/Electrical-Game/'.length)) || 'index.html');
    if (!path.startsWith(dist)) return route.abort();
    try {
      if (!(await stat(path)).isFile()) return route.abort();
      await route.fulfill({ status: 200, contentType: mime[extname(path)] ?? 'application/octet-stream', body: await readFile(path) });
    } catch { return route.abort(); }
  });
};
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await blockPointerLock(context);
  await installDistRoutes(context);
  const page = await context.newPage();
  await page.goto(`${base}?mansion=preview&editor=1&renderer=webgl`);
  await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 45000 });

  for (const floorIndex of [0, 1, 2, 3, 4]) {
    await page.evaluate(index => window.__wireTheHouse.levelEditor.setFloorIndex(index), floorIndex);
    const report = await page.evaluate(() => {
      const game = window.__wireTheHouse, editor = game.levelEditor, wing = game.room.mansionWing;
      const roots = [...wing.editableWalls.values(), ...wing.editableSurfaces.values(), ...wing.editableAssets.values()]
        .filter(root => editor.isSelectableVisible(root));
      const failures = [];
      let tested = 0;
      for (const root of roots) {
        const meshes = [];
        root.traverseVisible(node => {
          if (node.isMesh && !node.userData.levelEditorHighlight && !node.userData.levelEditorPickProxy) meshes.push(node);
        });
        if (!meshes.length) {
          failures.push({ name: root.name, why: 'visible list item has no visible mesh' });
          continue;
        }
        tested++;
        let found = false;
        for (const mesh of meshes.slice(0, 8)) {
          const positions = mesh.geometry?.getAttribute?.('position');
          if (!positions || positions.count < 3) continue;
          const index = mesh.geometry.index;
          const world = mesh.matrixWorld.clone();
          if (mesh.isInstancedMesh) {
            const instance = mesh.matrixWorld.clone().identity();
            mesh.getMatrixAt(0, instance);
            world.multiply(instance);
          }
          const vertex = n => new editor.camera.position.constructor()
            .fromBufferAttribute(positions, index ? index.getX(n) : n).applyMatrix4(world);
          // Sample across the complete surface. A simulated pile begins with
          // almost-flat edge triangles that deliberately ignore shovel rays.
          const triangleCount = Math.floor((index?.count ?? positions.count) / 3);
          const sampleCount = Math.min(triangleCount, 64);
          for (let sample = 0; sample < sampleCount; sample++) {
            const triangle = Math.floor((sample + .5) * triangleCount / sampleCount);
            const a = vertex(triangle * 3), b = vertex(triangle * 3 + 1), c = vertex(triangle * 3 + 2);
            const normal = b.clone().sub(a).cross(c.clone().sub(a));
            if (normal.lengthSq() < 1e-10) continue;
            normal.normalize();
            const centre = a.clone().add(b).add(c).divideScalar(3);
            for (const side of [1, -1]) {
              editor.raycaster.ray.origin.copy(centre).addScaledVector(normal, side * .2);
              editor.raycaster.ray.direction.copy(normal).multiplyScalar(-side);
              editor.raycaster.near = 0;
              editor.raycaster.far = 1;
              if (editor.raycaster.intersectObject(root, true).length) { found = true; break; }
            }
            if (found) break;
          }
          if (found) break;
        }
        if (!found) failures.push({ name: root.name, why: 'direct rays missed every visible mesh' });
      }
      return { visible: roots.length, tested, failures };
    });
    const listCount = Number((await page.locator('#level-count').textContent())?.split(' ')[0]);
    console.log(JSON.stringify({ floorIndex, ...report, listCount, failures: report.failures.slice(0, 10) }));
    assert.equal(report.failures.length, 0, 'Every visible level item needs a pickable surface');
    assert.equal(listCount, report.visible, 'Scene list must omit fully hidden geometry');
    if (floorIndex === 0) {
      await page.evaluate(() => {
        const editor = window.__wireTheHouse.levelEditor;
        editor.setViewMode('3d');
        editor.camera.position.set(2.25, .16, 0);
        editor.orbit.target.set(3.797, .16, 0);
        editor.camera.lookAt(editor.orbit.target);
        editor.orbit.update();
        editor.raycaster.near = 0;
        editor.raycaster.far = Infinity;
      });
      const canvas = await page.locator('#game-canvas').boundingBox();
      assert(canvas);
      await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
      const picked = await page.evaluate(() => window.__wireTheHouse.levelEditor.selected?.userData.levelEditorLabel);
      assert.equal(picked, 'Feathered construction dust at wall contacts', 'A direct canvas click must select the wall-contact detail');
      await page.evaluate(() => {
        const editor = window.__wireTheHouse.levelEditor;
        editor.camera.position.set(2.72, .16, -.8);
        editor.orbit.target.set(2.72, .16, -2.18);
        editor.camera.lookAt(editor.orbit.target);
        editor.orbit.update();
      });
      await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
      const column = await page.evaluate(() => window.__wireTheHouse.levelEditor.selected?.userData.levelEditorLabel);
      assert.equal(column, 'Structural concrete column · 2', 'The solid column must win where the dust overlaps its foot');
      await page.evaluate(() => window.__wireTheHouse.levelEditor.setViewMode('2d'));
    }
  }
  await context.close();
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await blockPointerLock(mobile);
  await installDistRoutes(mobile);
  const touchPage = await mobile.newPage();
  await touchPage.goto(`${base}?mansion=preview&editor=1&renderer=webgl`);
  await touchPage.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 45000 });
  await touchPage.evaluate(() => {
    const editor = window.__wireTheHouse.levelEditor;
    editor.setFloorIndex(0);
    editor.setViewMode('3d');
    editor.camera.position.set(2.25, .16, 0);
    editor.orbit.target.set(3.797, .16, 0);
    editor.camera.lookAt(editor.orbit.target);
    editor.orbit.update();
  });
  const canvas = await touchPage.locator('#game-canvas').boundingBox();
  assert(canvas);
  await touchPage.touchscreen.tap(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  const mobilePick = await touchPage.evaluate(() => window.__wireTheHouse.levelEditor.selected?.userData.levelEditorLabel);
  assert.equal(mobilePick, 'Feathered construction dust at wall contacts', 'A portrait touch must select the visible wall-contact detail');
  console.log(JSON.stringify({ mobilePortrait: true, picked: mobilePick }));
  await mobile.close();
} finally { await browser.close(); }
