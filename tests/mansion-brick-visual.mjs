import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const renderer = process.env.QA_RENDERER ?? 'webgl';
const url = `http://127.0.0.1:5365/Electrical-Game/?mansion=preview&renderer=${renderer}`;
const output = process.argv[2] ?? 'output/mansion-brick-visual';
const isolatedRoot = process.env.QA_DIST_ROOT ? path.resolve(process.env.QA_DIST_ROOT) : null;
const devices = [
  { name: 'desktop', width: 1366, height: 768, mobile: false },
  { name: 'mobile', width: 390, height: 844, mobile: true },
];
const poses = [
  { name: 'courtyard', wall: 'Courtyard north fired-clay enclosure', x: 15.3, y: 1.65, z: 15, yaw: Math.PI },
  { name: 'recessed', wall: 'recessed-room-back-9', x: 20, y: 1.65, z: 9, yaw: -Math.PI / 2 },
];
await mkdir(output, { recursive: true });
const report = { url, servedFrom: isolatedRoot ?? 'live 5365', cases: [], errors: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const device of devices) {
    const context = await browser.newContext({ viewport: { width: device.width, height: device.height },
      isMobile: device.mobile, hasTouch: device.mobile, deviceScaleFactor: 1 });
    await blockPointerLock(context);
    const page = await context.newPage();
    if (isolatedRoot) await page.route('http://127.0.0.1:5365/Electrical-Game/**', async route => {
      const relative = decodeURIComponent(new URL(route.request().url()).pathname).slice('/Electrical-Game/'.length) || 'index.html';
      const file = path.resolve(isolatedRoot, relative);
      if (!file.startsWith(isolatedRoot + path.sep)) return route.abort();
      try {
        const ext = path.extname(file).toLowerCase();
        const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
          '.webp':'image/webp', '.jpg':'image/jpeg', '.png':'image/png', '.glb':'model/gltf-binary', '.svg':'image/svg+xml' };
        await route.fulfill({ status: 200, body: await readFile(file), contentType: mime[ext] ?? 'application/octet-stream' });
      } catch { await route.fulfill({ status: 404, body: `Missing isolated asset: ${relative}` }); }
    });
    page.on('pageerror', error => report.errors.push(`${device.name}: ${error.message}`));
    await page.goto(url);
    await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 120000 });
    await page.locator('#apprentice-count').selectOption('0');
    await page.locator('#start-button')[device.mobile ? 'tap' : 'click']();
    await page.evaluate(() => { window.__wireTheHouse.step = () => {}; window.__wireTheHouse.fpsRig.visible = false; });
    for (const pose of poses) {
      const pristine = await page.evaluate(p => {
        const g = window.__wireTheHouse, camera = g.renderer.camera;
        g.room.mansionWing.updateGameplayVisibility(p.x, p.z, p.y - 1.65);
        camera.position.set(p.x, p.y, p.z);
        g.player.yaw = p.yaw; g.player.pitch = 0;
        camera.rotation.set(0, p.yaw, 0);
        camera.updateMatrixWorld(true);
        const target = g.room.mansionWing.masonryDemolition.get(p.wall).aim(camera);
        g.renderer.render();
        return { target: target?.index ?? null, error: g.renderer.renderError };
      }, pose);
      assert(Number.isInteger(pristine.target) && !pristine.error,
        `${device.name}/${pose.name}: wall unavailable or render failed: ${JSON.stringify(pristine)}`);
      await page.screenshot({ path: `${output}/${device.name}-${pose.name}-pristine.png` });
      const damaged = await page.evaluate(p => {
        const g = window.__wireTheHouse, wall = g.room.mansionWing.masonryDemolition.get(p.wall);
        const camera = g.renderer.camera, index = wall.aim(camera)?.index;
        if (index === undefined) return { accepted: false };
        const accepted = [wall.strikeAt(index, camera), wall.strikeAt(index, camera), wall.strikeAt(index, camera)].every(Boolean);
        g.renderer.render();
        const entry = wall.broken.get(index);
        return { accepted, partial: wall.partialDamageCount, removed: wall.removedIndices().length,
          localUv: Boolean(entry?.mesh.geometry.getAttribute('brickLocalUv')),
          error: g.renderer.renderError };
      }, pose);
      assert(damaged.accepted && damaged.partial > 0 && damaged.removed === 0 && !damaged.error,
        `${device.name}/${pose.name}: hammer damage failed: ${JSON.stringify(damaged)}`);
      await page.screenshot({ path: `${output}/${device.name}-${pose.name}-damaged.png` });
      report.cases.push({ device: device.name, pose: pose.name, pristine, damaged });
      await page.evaluate(name => window.__wireTheHouse.room.mansionWing.masonryDemolition.get(name).reset(), pose.wall);
    }
    await context.close();
  }
  assert.deepEqual(report.errors, []);
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report));
