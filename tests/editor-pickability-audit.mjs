import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await blockPointerLock(context);
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&editor=1&renderer=webgl');
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
  }
} finally { await browser.close(); }
