import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const url = `http://127.0.0.1:5365/Electrical-Game/?mansion=preview&renderer=${process.env.QA_RENDERER ?? 'webgl'}`;
const output = process.argv[2] ?? 'output/courtyard-tree';
const isolatedRoot = process.env.QA_DIST_ROOT ? path.resolve(process.env.QA_DIST_ROOT) : null;
const views = [
  { name: 'court', position: [10.2, 1.68, 13.8], target: [13.35, 2.5, 11.35] },
  { name: 'close', position: [12.1, 1.68, 13.0], target: [13.35, 2.2, 11.35] },
];
await mkdir(output, { recursive: true });
const report = { url, source: isolatedRoot ?? 'live 5365', cases: [], errors: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const device of [
    { name: 'desktop', width: 1366, height: 768, touch: false },
    { name: 'portrait', width: 390, height: 844, touch: true },
  ].filter(entry => !process.env.QA_DEVICE || entry.name === process.env.QA_DEVICE)) {
    const context = await browser.newContext({ viewport: { width: device.width, height: device.height },
      isMobile: device.touch, hasTouch: device.touch, deviceScaleFactor: 1 });
    await blockPointerLock(context);
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(`${device.name}: ${error.message}`));
    if (isolatedRoot) await page.route('http://127.0.0.1:5365/Electrical-Game/**', async route => {
      const relative = decodeURIComponent(new URL(route.request().url()).pathname).slice('/Electrical-Game/'.length) || 'index.html';
      const file = path.resolve(isolatedRoot, relative);
      if (!file.startsWith(isolatedRoot + path.sep)) return route.abort();
      try {
        const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
          '.webp':'image/webp', '.jpg':'image/jpeg', '.png':'image/png', '.glb':'model/gltf-binary',
          '.gltf':'model/gltf+json', '.bin':'application/octet-stream', '.svg':'image/svg+xml' };
        await route.fulfill({ status: 200, body: await readFile(file),
          contentType: mime[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
      } catch { await route.fulfill({ status: 404, body: `Missing isolated asset: ${relative}` }); }
    });
    await page.goto(url);
    await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 120000 });
    await page.locator('#apprentice-count').selectOption('0');
    await page.locator('#start-button')[device.touch ? 'tap' : 'click']();
    await page.locator('#start-screen').waitFor({ state: 'hidden' });
    if (isolatedRoot) await page.waitForFunction(() => {
      const tree = window.__wireTheHouse?.room?.mansionWing?.courtyard?.tree;
      return tree?.userData.scannedReady || tree?.userData.scannedError;
    }, null, { timeout: 45000 });
    await page.evaluate(() => { window.__wireTheHouse.step = () => {}; window.__wireTheHouse.fpsRig.visible = false; });
    for (const view of views) {
      await page.evaluate(({ position, target }) => {
        const g = window.__wireTheHouse, camera = g.renderer.camera;
        g.room.mansionWing.updateGameplayVisibility(position[0], position[2], 0);
        camera.position.set(...position);
        camera.lookAt(...target);
        camera.updateMatrixWorld(true);
        g.room.update(0, camera);
        g.renderer.render();
      }, view);
      await page.waitForTimeout(700);
      const info = await page.evaluate(async () => {
        const g = window.__wireTheHouse, tree = g.room.mansionWing.courtyard.tree;
        const obstacle = g.room.mansionWing.courtyard.obstacles.find(o => o.id === 'retained-olive-trunk');
        const intervals = [];
        let previous = performance.now();
        for (let i = 0; i < 105; i++) {
          await new Promise(resolve => requestAnimationFrame(resolve));
          const now = performance.now();
          if (i >= 15) intervals.push(now - previous);
          previous = now;
        }
        intervals.sort((a,b) => a-b);
        g.renderer.render();
        return { treeName: tree.name, childNames: tree.children.map(o => o.name),
          scanned: tree.userData.scannedReady ?? false, scannedError: tree.userData.scannedError ?? '',
          scannedTriangles: tree.userData.scannedTriangles ?? 0,
          scannedLoadMs: tree.userData.scannedLoadMs ?? null,
          studioPivot: tree.parent?.userData.studioEntityId ?? '',
          position: tree.getWorldPosition(tree.position.clone()).toArray(), scale: tree.scale.toArray(), obstacle,
          calls: g.renderer.webgl.info.render.calls, triangles: g.renderer.webgl.info.render.triangles,
          frameP95Ms: intervals[Math.floor((intervals.length - 1) * .95)], error: g.renderer.renderError };
      });
      assert(info.obstacle && Math.abs(info.position[0] - 13.35) < .001 &&
        Math.abs(info.position[2] - 11.35) < .001 && !info.error, JSON.stringify(info));
      if (isolatedRoot) assert(info.scanned && !info.scannedError && info.scannedTriangles < 150000,
        JSON.stringify(info));
      if (isolatedRoot) {
        assert(info.obstacle.maxX - info.obstacle.minX > .9 &&
          info.studioPivot === 'mansion:site-asset:existing-olive-tree-retained-in-open-mansion-court:1',
          JSON.stringify(info));
        const colliderMove = await page.evaluate(() => {
          const wing = window.__wireTheHouse.room.mansionWing;
          const tree = wing.courtyard.tree, pivot = tree.parent;
          const obstacle = wing.obstacles.find(o => o.id === 'retained-olive-trunk');
          const before = obstacle.minX;
          pivot.position.x += .25;
          wing.obstaclesAt(0);
          const shifted = obstacle.minX;
          pivot.position.x -= .25;
          wing.obstaclesAt(0);
          return { delta: shifted - before, restored: Math.abs(obstacle.minX - before) < .001 };
        });
        assert(Math.abs(colliderMove.delta - .25) < .001 && colliderMove.restored,
          `${device.name}: Studio trunk collision did not follow the tree: ${JSON.stringify(colliderMove)}`);
      }
      await page.screenshot({ path: `${output}/${device.name}-${view.name}.png` });
      report.cases.push({ device: device.name, view: view.name, info });
    }
    if (isolatedRoot) {
      const bodyContact = await page.evaluate(() => {
        const g = window.__wireTheHouse, wing = g.room.mansionWing;
        const obstacle = wing.obstaclesAt(0).find(o => o.id === 'retained-olive-trunk');
        g.player.camera.position.set((obstacle.minX + obstacle.maxX) / 2, 1.65,
          (obstacle.minZ + obstacle.maxZ) / 2);
        g.player.setObstacleProvider(() => wing.obstaclesAt(0));
        g.player.update(0);
        return { contacts: g.player.collisionContacts,
          position: g.player.camera.position.toArray(), obstacle };
      });
      assert(bodyContact.contacts.includes('retained-olive-trunk'),
        `${device.name}: player passed through the tree: ${JSON.stringify(bodyContact)}`);
    }
    await context.close();
  }
  assert.deepEqual(report.errors, []);
} finally {
  await browser.close();
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report.cases.map(c => ({ device: c.device, view: c.view, calls: c.info.calls,
  triangles: c.info.triangles, p95: c.info.frameP95Ms }))));
