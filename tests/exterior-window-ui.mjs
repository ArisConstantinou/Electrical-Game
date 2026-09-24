import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { blockPointerLock } from './browser-safety.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5365/Electrical-Game/?renderer=webgl';
const out = process.argv[3] ?? 'output/exterior-window-ui';
const isolatedRoot = process.env.QA_DIST_ROOT ? path.resolve(process.env.QA_DIST_ROOT) : null;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { url, cases: [], errors: [], passed: false };
try {
  for (const device of [
    { name: 'portrait', width: 390, height: 844, touch: true },
    { name: 'landscape', width: 844, height: 390, touch: true },
    { name: 'tablet-portrait', width: 820, height: 1180, touch: true },
    { name: 'desktop', width: 1366, height: 768, touch: false },
  ]) {
    const context = await browser.newContext({ viewport: { width: device.width, height: device.height }, isMobile: device.touch, hasTouch: device.touch, deviceScaleFactor: 1 });
    await blockPointerLock(context);
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(`${device.name}: ${error.message}`));
    if (isolatedRoot) await page.route('http://127.0.0.1:5365/Electrical-Game/**', async route => {
      const relative = decodeURIComponent(new URL(route.request().url()).pathname).slice('/Electrical-Game/'.length) || 'index.html';
      const file = path.resolve(isolatedRoot, relative);
      if (!file.startsWith(isolatedRoot + path.sep)) return route.abort();
      try {
        const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
          '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.glb': 'model/gltf-binary',
          '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.svg': 'image/svg+xml' };
        await route.fulfill({ status: 200, body: await readFile(file),
          contentType: mime[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
      } catch { await route.fulfill({ status: 404, body: `Missing isolated asset: ${relative}` }); }
    });
    await page.goto(url);
    await page.waitForFunction(() => window.__wireTheHouse?.room?.exterior, undefined, { timeout: 120000 });
    await page.selectOption('#apprentice-count', '0');
    if (device.touch) await page.locator('#start-button').tap(); else await page.locator('#start-button').click();
    await page.locator('#start-screen').waitFor({ state: 'hidden' });
    const state = await page.evaluate(async () => {
      const game = window.__wireTheHouse, room = game.room, camera = game.renderer.camera;
      const left = room.referenceWalls.find(object => object.name === 'Left concrete wall');
      const parts = left?.children.map(part => part.name) ?? [];
      const pose = (x, z, yaw, pitch = -.04) => {
        camera.position.set(x, 1.65, z);
        camera.rotation.set(pitch, yaw, 0, 'YXZ');
        camera.updateMatrixWorld(true);
        game.player.yaw = yaw; game.player.pitch = pitch;
      };
      pose(-2.35, 2, Math.PI / 2, 0);
      game.heightMeasure.update(camera, true, () => true);
      const hole = game.heightMeasure.telemetry.mode;
      pose(-2.35, .25, Math.PI / 2, 0);
      game.heightMeasure.update(camera, true, () => true);
      const solid = game.heightMeasure.telemetry.mode;
      game.heightMeasure.update(camera, false, () => true);
      const tree = room.exterior.getObjectByName('Olive tree outside unfinished opening');
      const building = room.exterior.getObjectByName('Offset adjacent residential block');
      const firedClay = building.getObjectByName('Human-laid fired-clay infill around open neighbouring bays');
      const treePoint = tree.localToWorld(camera.position.clone().set(.04, 2.1, 0));
      const buildingPoint = building.localToWorld(camera.position.clone().set(-11.15, 2.1, 2.05));
      const screen = (x, z) => {
        pose(x, z, Math.PI / 2);
        return { tree: treePoint.clone().project(camera).x, building: buildingPoint.clone().project(camera).x };
      };
      const near = screen(-1.45, 1.62), shifted = screen(-1.45, 2.30);
      const canopy = tree.children.find(child => child.type === 'Group');
      const windAngles = [];
      for (let i = 0; i < 90; i++) { room.update(1 / 60); windAngles.push(canopy?.rotation.z ?? 0); }
      const windRange = Math.max(...windAngles) - Math.min(...windAngles);
      pose(-1.45, 2, Math.PI / 2);
      await game.renderer.waitForFrame();
      return { parts, hole, solid, near, shifted, windRange, firedClayCount: firedClay?.count ?? 0,
        renderError: game.renderer.renderError,
        outsideMeshes: room.exterior.children.length, hasGlass: room.exterior.getObjectByName('glass') !== undefined };
    });
    assert(state.parts.length >= 6 && state.parts.some(name => name.includes('sill')) && state.parts.some(name => name.includes('lintel')));
    assert.equal(state.hole, 'no-wall', `${device.name}: opening must not have an invisible solid panel`);
    assert.equal(state.solid, 'ready', `${device.name}: remaining concrete stays a work surface`);
    assert(Math.abs(state.near.tree - state.shifted.tree) > .02, `${device.name}: near olive tree has no camera parallax`);
    assert(state.windRange > .005, `${device.name}: courtyard foliage has no motion`);
    assert(state.outsideMeshes >= 6 && !state.hasGlass && state.renderError === '');
    assert(state.firedClayCount > 300, `${device.name}: exposed clay infill missing`);
    await page.screenshot({ path: `${out}/${device.name}-open-left-window.png` });
    report.cases.push({ device: device.name, state });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ passed: report.passed, cases: report.cases.map(entry => ({ device: entry.device, hole: entry.state.hole, solid: entry.state.solid })) }));
