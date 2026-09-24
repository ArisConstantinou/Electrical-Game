import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { blockPointerLock } from './browser-safety.mjs';

const baseline = process.argv.includes('--baseline');
const live = process.argv.includes('--live');
const root = resolve('dist');
const out = resolve('output/site-floor-debris', baseline ? 'before' : live ? 'live' : 'candidate');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { baseline, views: [], errors: [] };
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await blockPointerLock(context);
  if (!baseline && !live) await context.route('http://127.0.0.1:5365/Electrical-Game/**', async route => {
    const relative = decodeURIComponent(new URL(route.request().url()).pathname.slice('/Electrical-Game/'.length)) || 'index.html';
    const file = resolve(root, relative);
    if (!file.startsWith(root + sep)) return route.abort();
    try {
      if (!(await stat(file)).isFile()) return route.abort();
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp',
        '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary' };
      await route.fulfill({ status: 200, contentType: mime[extname(file)] ?? 'application/octet-stream', body: await readFile(file) });
    } catch { await route.abort(); }
  });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=basic&renderer=webgl');
  await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart &&
    !document.querySelector('#start-button')?.disabled, null, { timeout: 120000 });
  await page.locator('#apprentice-count').selectOption('0');
  await page.locator('#start-button').click();
  await page.waitForFunction(() => window.__wireTheHouse?.started &&
    document.querySelector('#start-screen')?.classList.contains('hidden'));
  await page.waitForTimeout(500);
  const views = [
    { name: 'front-floor', x: 0, z: -.75, yaw: 0, pitch: -.78 },
    { name: 'bench-floor', x: -1.40, z: 1.45, yaw: Math.PI / 2, pitch: -.60 },
    { name: 'rear-floor', x: 0, z: 1.30, yaw: Math.PI, pitch: -.70 },
  ];
  for (const device of [{ name: 'desktop', width: 1366, height: 768 }, { name: 'portrait', width: 390, height: 844 }]) {
    await page.setViewportSize({ width: device.width, height: device.height });
    for (const view of views) {
      const scene = await page.evaluate(pose => {
        const game = window.__wireTheHouse;
        game.step = () => {};
        game.fpsRig.visible = false;
        const camera = game.renderer.camera;
        camera.position.set(pose.x, 1.65, pose.z);
        camera.rotation.set(pose.pitch, pose.yaw, 0, 'YXZ');
        game.renderer.render();
        const scatter = game.room.children.find(item => item.userData.siteFloorDebris);
        return { present: !!scatter, counts: scatter?.children.filter(item => item.isInstancedMesh).map(item => item.count) ?? [],
          calls: game.renderer.webgl.info.render.calls, triangles: game.renderer.webgl.info.render.triangles,
          error: game.renderer.renderError };
      }, view);
      if (view.name === 'front-floor') scene.frames = await page.evaluate(async () => {
        const spans = [];
        await new Promise(resolve => {
          let last = performance.now();
          const sample = now => {
            spans.push(now - last);
            last = now;
            if (spans.length < 100) requestAnimationFrame(sample);
            else resolve();
          };
          requestAnimationFrame(sample);
        });
        spans.splice(0, 10);
        spans.sort((a, b) => a - b);
        return { medianMs: spans[45], p95Ms: spans[85] };
      });
      await page.locator('#game-canvas').screenshot({ path: resolve(out, `${device.name}-${view.name}.png`) });
      report.views.push({ device: device.name, name: view.name, scene });
    }
  }
  const editorPage = await context.newPage();
  editorPage.on('pageerror', error => report.errors.push(`editor: ${error.message}`));
  await editorPage.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&editor=1&renderer=webgl');
  await editorPage.waitForFunction(() => window.__wireTheHouse?.room?.mansionWing?.editableAssets?.size > 0,
    null, { timeout: 120000 });
  report.editor = await editorPage.evaluate(() => {
    const wing = window.__wireTheHouse.room.mansionWing;
    const asset = [...wing.editableAssets.values()].find(item => item.userData.levelEditorLabel === 'Brick rubble');
    const scatter = asset?.children[0];
    const pickable = scatter?.children.filter(item => item.isInstancedMesh).some(item => {
      const hits = [];
      item.raycast({}, hits);
      return hits.length > 0;
    });
    return { registered: !!asset, id: asset?.name, stableId: scatter?.userData.studioEntityId,
      counts: scatter?.children.filter(item => item.isInstancedMesh).map(item => item.count) ?? [], pickable };
  });
  await editorPage.close();
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  assert.deepEqual(report.errors, []);
  assert(report.views.every(view => !view.scene.error));
  if (baseline) assert(report.views.every(view => !view.scene.present));
  else {
    assert(report.views.every(view => view.scene.present &&
      view.scene.counts[0] === 88 && view.scene.counts[1] === 66 && view.scene.counts[2] === 6));
    assert.equal(report.editor.registered, true);
    assert.equal(report.editor.id, 'room-part:brick-rubble:1');
    assert.equal(report.editor.stableId, 'world:site-clay-rubble');
    assert.equal(report.editor.pickable, false);
  }
  console.log(JSON.stringify(report));
} finally { await browser.close(); }
