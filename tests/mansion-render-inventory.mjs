import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { blockPointerLock } from './browser-safety.mjs';

const isolatedRoot = process.env.QA_DIST_ROOT ? path.resolve(process.env.QA_DIST_ROOT) : null;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  await blockPointerLock(context);
  const page = await context.newPage();
  if (isolatedRoot) await page.route('http://127.0.0.1:5365/Electrical-Game/**', async route => {
    const relative = decodeURIComponent(new URL(route.request().url()).pathname).slice('/Electrical-Game/'.length) || 'index.html';
    const file = path.resolve(isolatedRoot, relative);
    if (!file.startsWith(isolatedRoot + path.sep)) return route.abort();
    try {
      const extension = path.extname(file).toLowerCase();
      await route.fulfill({ status: 200, body: await readFile(file), contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.svg': 'image/svg+xml' })[extension] || 'application/octet-stream' });
    } catch { await route.fulfill({ status: 404, body: `Missing isolated asset: ${relative}` }); }
  });
  await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&renderer=webgl&editor=1');
  await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 120000 });
  const result = await page.evaluate(async () => {
    const game = window.__wireTheHouse, room = game.room, renderer = game.renderer;
    await renderer.waitForFrame();
    renderer.render();
    const groups = new Map(), largest = [];
    const category = node => {
      for (let parent = node; parent; parent = parent.parent) {
        if (parent === room.mansionWing.courtyard) return 'Mansion courtyard';
        if (parent === room.mansionWing.surroundings) return 'Mansion surroundings';
        if (parent === room.mansionWing) return 'Mansion authored wing';
        if (parent === room.exterior) return 'Original exterior';
        if (parent === room) return 'Original work room';
      }
      return 'Other scene systems';
    };
    renderer.scene.traverseVisible(node => {
      if (!node.isMesh || !node.geometry?.getAttribute) return;
      const indexed = node.geometry.index?.count ?? node.geometry.getAttribute('position')?.count ?? 0;
      const triangles = Math.round(indexed / 3) * (node.isInstancedMesh ? node.count : 1);
      const key = category(node), row = groups.get(key) ?? { meshes: 0, instanced: 0, triangles: 0 };
      row.meshes++;
      row.instanced += node.isInstancedMesh ? node.count : 0;
      row.triangles += triangles;
      groups.set(key, row);
      largest.push({ name: node.name || '(unnamed)', category: key, triangles,
        instanced: node.isInstancedMesh ? node.count : 0, geometry: node.geometry.type });
    });
    return { camera: renderer.renderCamera.type,
      actualRender: { calls: renderer.webgl.info.render.calls, triangles: renderer.webgl.info.render.triangles },
      groups: Object.fromEntries(groups), largest: largest.sort((a, b) => b.triangles - a.triangles).slice(0, 24) };
  });
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
