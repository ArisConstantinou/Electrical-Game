import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const renderer = process.env.QA_RENDERER ?? 'webgl';
const url = `http://127.0.0.1:5365/Electrical-Game/?mansion=preview&renderer=${renderer}`;
const output = process.argv[2] ?? 'output/mansion-field-visual';
const isolatedRoot = process.env.QA_DIST_ROOT ? path.resolve(process.env.QA_DIST_ROOT) : null;
const pose = { x: 21.8, y: 1.72, z: 3.1, yaw: -Math.PI / 2, pitch: -.05 };
await mkdir(output, { recursive: true });
const report = { url, servedFrom: isolatedRoot ?? 'live 5365', pose, cases: [], errors: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const device of [
    { name: 'desktop', viewport: { width: 1366, height: 768 }, mobile: false },
    { name: 'portrait', viewport: { width: 390, height: 844 }, mobile: true },
  ]) {
    const context = await browser.newContext({ viewport: device.viewport, isMobile: device.mobile,
      hasTouch: device.mobile, deviceScaleFactor: 1 });
    await blockPointerLock(context);
    const page = await context.newPage();
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
    page.on('pageerror', error => report.errors.push(`${device.name}: ${error.message}`));
    await page.goto(url);
    await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 120000 });
    await page.locator('#apprentice-count').selectOption('0');
    await page.locator('#start-button')[device.mobile ? 'tap' : 'click']();
    if (isolatedRoot) await page.waitForFunction(() => {
      const group = window.__wireTheHouse?.room?.mansionWing?.surroundings
        ?.getObjectByName('Separate drought-tolerant field shrubs at varied depths');
      return group?.userData.photogrammetryReady || group?.userData.photogrammetryError;
    }, null, { timeout: 30000 });
    await page.evaluate(p => {
      const g = window.__wireTheHouse;
      g.step = () => {};
      g.fpsRig.visible = false;
      g.room.mansionWing.updateGameplayVisibility(p.x, p.z, 0);
      const camera = g.renderer.camera;
      camera.position.set(p.x, p.y, p.z);
      g.player.yaw = p.yaw; g.player.pitch = p.pitch;
      camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
      camera.updateMatrixWorld(true);
      g.renderer.render();
    }, pose);
    await page.waitForTimeout(500);
    const info = await page.evaluate(() => {
      const g = window.__wireTheHouse;
      g.renderer.render();
      const shrubs = g.room.mansionWing.surroundings.children.filter(o => /shrub|rooibos/i.test(o.name));
      const group = g.room.mansionWing.surroundings.getObjectByName('Separate drought-tolerant field shrubs at varied depths');
      return { shrubs: shrubs.map(o => ({ name: o.name, count: o.count, visible: o.visible })),
        scanned: group?.userData.photogrammetryReady ?? false, scanError: group?.userData.photogrammetryError ?? '',
        scanMeshes: group?.children.filter(o => o.isInstancedMesh).length ?? 0,
        studioPivot: group?.parent?.userData.studioEntityId ?? '',
        drawCalls: g.renderer.webgl.info.render.calls, triangles: g.renderer.webgl.info.render.triangles,
        error: g.renderer.renderError };
    });
    assert(!info.error && info.shrubs.length, `${device.name}: field unavailable: ${JSON.stringify(info)}`);
    if (isolatedRoot) assert(info.scanned && info.scanMeshes === 3 && !info.scanError &&
      info.studioPivot === 'mansion:site-asset:separate-drought-tolerant-field-shrubs-at-varied-depths:1',
      `${device.name}: scanned field failed: ${JSON.stringify(info)}`);
    const studioMotion = await page.evaluate(() => {
      const group = window.__wireTheHouse.room.mansionWing.surroundings
        .getObjectByName('Separate drought-tolerant field shrubs at varied depths');
      const pivot = group.parent, before = group.getWorldPosition(group.position.clone()).x;
      pivot.position.x += .25;
      pivot.updateWorldMatrix(true, true);
      const shifted = group.getWorldPosition(group.position.clone()).x;
      pivot.position.x -= .25;
      pivot.updateWorldMatrix(true, true);
      return shifted - before;
    });
    assert(Math.abs(studioMotion - .25) < .001, `${device.name}: Studio pivot lost live transform`);
    const profile = await page.evaluate(async () => {
      const g = window.__wireTheHouse, intervals = [], cpu = [];
      let previous = performance.now();
      for (let i = 0; i < 120; i++) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        const now = performance.now();
        if (i >= 20) intervals.push(now - previous);
        previous = now;
        const start = performance.now();
        g.renderer.render();
        if (i >= 20) cpu.push(performance.now() - start);
      }
      const percentile = (values, p) => values.sort((a, b) => a - b)[Math.floor((values.length - 1) * p)];
      return { frameP95Ms: percentile(intervals, .95), renderCpuP95Ms: percentile(cpu, .95),
        drawCalls: g.renderer.webgl.info.render.calls, triangles: g.renderer.webgl.info.render.triangles };
    });
    await page.screenshot({ path: `${output}/${device.name}.png` });
    report.cases.push({ device: device.name, info, studioMotion, profile });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
} finally {
  await browser.close();
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
