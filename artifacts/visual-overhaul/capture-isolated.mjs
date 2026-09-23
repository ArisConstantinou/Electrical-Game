import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

// Serve this checkout's production build through Playwright interception. The
// browser retains the project's sole 5365 origin without replacing its listener.
const root = path.resolve('dist');
const output = path.resolve('artifacts/visual-overhaul');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1365, height: 768 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await page.route('http://127.0.0.1:5365/Electrical-Game/**', async route => {
  const requestPath = decodeURIComponent(new URL(route.request().url()).pathname);
  const relative = requestPath.slice('/Electrical-Game/'.length) || 'index.html';
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep)) return route.abort();
  try {
    const body = await fs.readFile(file);
    const extension = path.extname(file).toLowerCase();
    const contentType = ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
      '.json': 'application/json', '.webp': 'image/webp', '.jpg': 'image/jpeg',
      '.png': 'image/png', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary',
      '.wav': 'audio/wav' })[extension] || 'application/octet-stream';
    await route.fulfill({ status: 200, contentType, body });
  } catch { await route.fulfill({ status: 404, body: `Missing isolated asset: ${relative}` }); }
});
try {
  for (const mode of ['default', 'mansion']) {
    await page.goto(`http://127.0.0.1:5365/Electrical-Game/${mode === 'mansion' ? '?mansion=preview' : ''}`);
    await page.locator('#start-button').click({ timeout: 30000 });
    await page.waitForTimeout(3500);
    await page.evaluate(() => {
      const game = window.__wireTheHouse;
      game.player.camera.position.set(0, game.player.eyeHeight, 1.2);
      game.player.yaw = 0;
      game.player.pitch = -.68;
      game.player.camera.rotation.set(game.player.pitch, game.player.yaw, 0);
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(output, `isolated-${mode}.png`) });
    const state = await page.evaluate(() => window.render_game_to_text?.() ?? null);
    await fs.writeFile(path.join(output, `isolated-${mode}.json`), state ?? 'null');
    if (mode === 'default') {
      await page.evaluate(() => {
        const game = window.__wireTheHouse;
        game.player.camera.position.set(0, game.player.eyeHeight, 1.77);
        game.player.yaw = Math.PI / 2;
        game.player.pitch = -.23;
        game.player.camera.rotation.set(game.player.pitch, game.player.yaw, 0);
      });
      await page.waitForTimeout(500);
      const benchInfo = await page.evaluate(() => {
        const bench = window.__wireTheHouse.room.getObjectByName('Temporary timber electrician workbench');
        const meshes = [];
        bench?.traverse(object => { if (object.isMesh) meshes.push(object); });
        bench.visible = false;
        return { meshes: meshes.length, triangles: meshes.reduce((sum, mesh) =>
          sum + ((mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3)
            * (mesh.isInstancedMesh ? mesh.count : 1), 0) };
      });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(output, 'isolated-workbench-before.png') });
      await page.evaluate(() => { window.__wireTheHouse.room.getObjectByName('Temporary timber electrician workbench').visible = true; });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(output, 'isolated-workbench.png') });
      await fs.writeFile(path.join(output, 'workbench-inventory.json'), JSON.stringify(benchInfo, null, 2));
      const benchTiming = await page.evaluate(async () => {
        const game = window.__wireTheHouse;
        const bench = game.room.getObjectByName('Temporary timber electrician workbench');
        const sample = async visible => {
          bench.visible = visible;
          await new Promise(resolve => setTimeout(resolve, 250));
          const times = [];
          await new Promise(resolve => {
            let last = performance.now();
            const frame = now => {
              times.push(now - last);
              last = now;
              if (times.length < 90) requestAnimationFrame(frame);
              else resolve();
            };
            requestAnimationFrame(frame);
          });
          times.sort((a, b) => a - b);
          return { visible, medianMs: times[45], p95Ms: times[85] };
        };
        const hidden = await sample(false);
        const shown = await sample(true);
        return { hidden, shown };
      });
      await fs.writeFile(path.join(output, 'workbench-timing.json'), JSON.stringify(benchTiming, null, 2));
      const contact = await page.evaluate(() => {
        const game = window.__wireTheHouse;
        const obstacle = game.room.worksiteBenchObstacles()[0];
        game.player.setObstacleProvider(() => [obstacle]);
        game.player.camera.position.set((obstacle.minX + obstacle.maxX) / 2,
          game.player.eyeHeight, (obstacle.minZ + obstacle.maxZ) / 2);
        game.player.update(0);
        const position = game.player.camera.position;
        const closestX = Math.max(obstacle.minX, Math.min(obstacle.maxX, position.x));
        const closestZ = Math.max(obstacle.minZ, Math.min(obstacle.maxZ, position.z));
        return { contacts: game.player.collisionContacts,
          clearance: Math.hypot(position.x - closestX, position.z - closestZ), obstacle };
      });
      await fs.writeFile(path.join(output, 'workbench-contact.json'), JSON.stringify(contact, null, 2));
      if (!contact.contacts.includes('temporary-electrician-bench') || contact.clearance < .279)
        errors.push('Workbench body collision failed');
      await page.evaluate(() => {
        const game = window.__wireTheHouse;
        game.player.camera.position.set(0, game.player.eyeHeight, 1.77);
        game.player.yaw = Math.PI / 2;
        game.player.pitch = -.23;
        game.player.camera.rotation.set(game.player.pitch, game.player.yaw, 0);
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(output, 'isolated-workbench-mobile-viewport.png') });
      await page.setViewportSize({ width: 1365, height: 768 });
      await page.evaluate(() => {
        const game = window.__wireTheHouse;
        game.player.camera.position.set(0, game.player.eyeHeight, 1.2);
        game.player.yaw = 0;
        game.player.pitch = -.68;
        game.player.camera.rotation.set(game.player.pitch, game.player.yaw, 0);
      });
      await page.waitForTimeout(500);
      await page.evaluate(() => {
        window.__wireTheHouse.room.traverse(object => {
          const material = object.material;
          if (!material) return;
          for (const item of Array.isArray(material) ? material : [material]) {
            if (item.normalMap && (item.name?.startsWith('Scanned ') || item.name === 'Site Pro poured screed')) item.normalScale.set(0, 0);
          }
        });
      });
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(output, 'isolated-default-normal-off.png') });
    } else {
      const editable = await page.evaluate(() => {
        const game = window.__wireTheHouse;
        const wing = game.room.mansionWing;
        return [...(wing?.editableAssets?.values() ?? [])].some(pivot =>
          pivot.getObjectByName('Temporary timber electrician workbench'));
      });
      await fs.writeFile(path.join(output, 'workbench-editor.json'), JSON.stringify({ editable }, null, 2));
      if (!editable) errors.push('Workbench missing from mansion Level Editor inventory');
    }
  }
  await fs.writeFile(path.join(output, 'isolated-errors.json'), JSON.stringify(errors, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
