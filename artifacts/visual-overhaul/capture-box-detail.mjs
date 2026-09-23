import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve('dist');
const output = path.resolve('artifacts/visual-overhaul');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1365, height: 768 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await page.route('http://127.0.0.1:5365/Electrical-Game/**', async route => {
  const relative = decodeURIComponent(new URL(route.request().url()).pathname)
    .slice('/Electrical-Game/'.length) || 'index.html';
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep)) return route.abort();
  try {
    const body = await fs.readFile(file);
    const extension = path.extname(file).toLowerCase();
    const contentType = ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
      '.json': 'application/json', '.webp': 'image/webp', '.jpg': 'image/jpeg',
      '.png': 'image/png', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream' })[extension]
      || 'application/octet-stream';
    await route.fulfill({ status: 200, contentType, body });
  } catch { await route.fulfill({ status: 404, body: `Missing isolated asset: ${relative}` }); }
});
try {
  await page.goto('http://127.0.0.1:5365/Electrical-Game/');
  await page.locator('#start-button').click({ timeout: 30000 });
  await page.waitForTimeout(3500);
  // Asset inspection uses a fixed work camera; gameplay collision is checked
  // separately and the shared server state is never changed.
  await page.evaluate(() => {
    const player = window.__wireTheHouse.player;
    window.__originalPlayerUpdate = player.update;
    player.update = () => {};
  });
  const captures = [];
  for (const id of ['B', 'C']) {
    const state = await page.evaluate(id => {
      const game = window.__wireTheHouse;
      const point = game.mission.points.find(item => item.definition.id === id);
      if (!point) throw new Error(`Missing installation point ${id}`);
      point.boxGroup.visible = true;
      const target = point.getWorldPosition(game.player.camera.position.clone());
      const camera = game.player.camera;
      camera.position.set(target.x, target.y, target.z + .28);
      game.player.yaw = 0;
      game.player.pitch = 0;
      camera.rotation.set(0, 0, 0);
      const details = [];
      point.boxGroup.traverse(object => {
        if (object.userData.visualBoxDetail) details.push(object);
      });
      const detailBoundsInside = point.boxGroup.boxes.every(box =>
        box.children.filter(object => object.userData.visualBoxDetail).every(object => {
          object.geometry.computeBoundingBox();
          const bounds = object.geometry.boundingBox;
          return bounds.min.x >= -box.width / 2 - .00601 && bounds.max.x <= box.width / 2 + .00601
            && bounds.min.y >= -box.height / 2 - .00601 && bounds.max.y <= box.height / 2 + .00601
            && bounds.min.z >= -box.depth - .00001 && bounds.max.z <= .00601;
        }));
      details.forEach(object => { object.visible = false; });
      return { id, boxes: point.boxGroup.boxes.length, details: details.length,
        detailBoundsInside,
        target: target.toArray(), camera: camera.position.toArray(),
        widthM: point.boxGroup.groupWidth, heightM: point.boxGroup.groupHeight };
    }, id);
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(output, `box-${id}-before.png`) });
    await page.evaluate(id => {
      const point = window.__wireTheHouse.mission.points.find(item => item.definition.id === id);
      point.boxGroup.traverse(object => {
        if (object.userData.visualBoxDetail) object.visible = true;
      });
    }, id);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(output, `box-${id}-after.png`) });
    captures.push(state);
  }
  const timing = await page.evaluate(async () => {
    const point = window.__wireTheHouse.mission.points.find(item => item.definition.id === 'C');
    const details = [];
    point.boxGroup.traverse(object => {
      if (object.userData.visualBoxDetail) details.push(object);
    });
    const sample = async visible => {
      details.forEach(object => { object.visible = visible; });
      await new Promise(resolve => setTimeout(resolve, 250));
      const intervals = [];
      await new Promise(resolve => {
        let last = performance.now();
        const frame = now => {
          intervals.push(now - last);
          last = now;
          if (intervals.length < 90) requestAnimationFrame(frame);
          else resolve();
        };
        requestAnimationFrame(frame);
      });
      intervals.sort((a, b) => a - b);
      return { visible, medianMs: intervals[45], p95Ms: intervals[85] };
    };
    return { before: await sample(false), after: await sample(true) };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(450);
  await page.screenshot({ path: path.join(output, 'box-C-mobile-viewport.png') });
  const held = await page.evaluate(() => {
    const game = window.__wireTheHouse;
    game.selectTool('fitting');
    game.boxAssembly.reset('2G');
    game.syncBoxAssembly();
    let visualDetails = 0;
    game.fpsRig.traverse(object => {
      if (object.userData.visualBoxDetail) visualDetails++;
    });
    return { visualDetails, selectedTool: game.selectedTool };
  });
  await page.evaluate(() => {
    const game = window.__wireTheHouse;
    game.player.update = window.__originalPlayerUpdate;
    game.selectTool('spray');
    const point = game.mission.points.find(item => item.definition.id === 'C');
    const target = point.getWorldPosition(game.player.camera.position.clone());
    game.player.camera.position.set(target.x, game.player.eyeHeight, target.z + .8);
    game.player.yaw = 0;
    game.player.pitch = Math.atan2(target.y - game.player.eyeHeight, .8);
    game.player.camera.rotation.set(game.player.pitch, 0, 0);
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(output, 'box-C-gameplay-mobile.png') });
  await fs.writeFile(path.join(output, 'box-detail-check.json'),
    JSON.stringify({ captures, timing, held, errors }, null, 2));
  if (errors.length || captures.some(capture =>
    capture.details !== capture.boxes * 3 || !capture.detailBoundsInside) ||
    held.visualDetails < 3 || held.selectedTool !== 'fitting') process.exitCode = 1;
} finally {
  await browser.close();
}
