import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const variant = process.argv[2] || 'before';
const mobile = process.argv.includes('--mobile');
const selectedView = process.argv[3]?.startsWith('--') ? null : process.argv[3];
const root = path.resolve('dist');
const output = path.resolve('artifacts/visual-overhaul');
const views = [
  { name: 'room-wall', mansion: false, x: 0, y: 1.65, z: -1.55, yaw: 0, pitch: 0 },
  { name: 'room-ceiling', mansion: false, x: 0, y: 1.65, z: -.4, yaw: 0, pitch: 1.18 },
  { name: 'garage-ceiling', mansion: true, x: 13.5, y: 1.65, z: 1.25, yaw: 0, pitch: 1.2 },
  { name: 'upper-ceiling', mansion: true, x: 9.5, y: 4.9, z: 2.25, yaw: 0, pitch: 1.2 },
  { name: 'mansion-block-end', mansion: true, x: 16.7, y: 1.55, z: 8.7, yaw: -1.0, pitch: -.04 },
];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = [];
try {
  for (const view of views.filter(item => !selectedView || item.name === selectedView)) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1365, height: 768 }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://127.0.0.1:5365/Electrical-Game/**', async route => {
      const relative = decodeURIComponent(new URL(route.request().url()).pathname).slice('/Electrical-Game/'.length) || 'index.html';
      const file = path.resolve(root, relative);
      if (!file.startsWith(root + path.sep)) return route.abort();
      try {
        const extension = path.extname(file).toLowerCase();
        await route.fulfill({ status: 200, body: await fs.readFile(file), contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.svg': 'image/svg+xml' })[extension] || 'application/octet-stream' });
      } catch { await route.fulfill({ status: 404, body: `Missing isolated asset: ${relative}` }); }
    });
    await page.goto(`http://127.0.0.1:5365/Electrical-Game/?mansion=${view.mansion ? 'preview' : 'basic'}&renderer=webgl`);
    if (mobile) await page.locator('#start-button').tap({ timeout: 120000 });
    else await page.locator('#start-button').click({ timeout: 120000 });
    await page.waitForFunction(() => window.__wireTheHouse?.started, null, { timeout: 120000 });
    await page.waitForTimeout(500);
    const state = await page.evaluate(async pose => {
      const game = window.__wireTheHouse;
      game.input.locked = false;
      game.player.velocity.set(0, 0, 0);
      game.step(0);
      game.step = () => {};
      game.player.camera.position.set(pose.x, pose.y, pose.z);
      game.player.yaw = pose.yaw;
      game.player.pitch = pose.pitch;
      game.player.camera.rotation.set(pose.pitch, pose.yaw, 0, 'YXZ');
      game.player.camera.updateMatrixWorld(true);
      game.fpsRig.visible = false; // Environment inspection only; gameplay remains unchanged.
      await game.renderer.render();
      await game.renderer.waitForFrame();
      const ceiling = game.room.getObjectByName('Concrete slab ceiling');
      const clay = game.room.getObjectByName('Clay and concrete ribbed soffit preview');
      let mansionClayCeilings = 0, mansionConcreteSoffits = 0;
      game.room.mansionWing?.traverse(object => {
        if (object.name.includes('soffit') && object.name.includes('clay')) mansionClayCeilings++;
        if (object.name === 'Continuous cast concrete soffit' || object.name.includes('cast concrete') && object.name.includes('soffit') || object.name.includes('cast garage roof soffit')) mansionConcreteSoffits++;
      });
      const roofs = [];
      game.room.mansionWing?.traverse(object => {
        if (!object.name.includes('garage roof panel') && object.name !== 'L1 room slab prepared for L2') return;
        roofs.push({ name: object.name, at: object.getWorldPosition(game.player.camera.position.clone()).toArray(), visible: object.visible });
      });
      const exposedEnds = game.room.mansionWing?.getObjectByName('Four-chamber exposed hollow clay block ends');
      const clayBatches = { sound: 0, light: 0, broken: 0 };
      game.room.mansionWing?.traverse(object => {
        if (!object.isInstancedMesh) return;
        if (object.name.endsWith('sound clay units')) clayBatches.sound += object.count;
        if (object.name.includes('lightly chipped units')) clayBatches.light += object.count;
        if (object.name.endsWith('broken corners')) clayBatches.broken += object.count;
      });
      return { camera: game.player.camera.getWorldPosition(game.player.camera.position.clone()).toArray(), roofs,
        exposedEnds: Boolean(exposedEnds), clayBatches,
        roomSlabY: ceiling?.position.y, roomClayCeiling: Boolean(clay), mansionClayCeilings, mansionConcreteSoffits,
        render: { calls: game.renderer.webgl.info.render.calls, triangles: game.renderer.webgl.info.render.triangles,
          geometries: game.renderer.webgl.info.memory.geometries, textures: game.renderer.webgl.info.memory.textures },
        renderError: game.renderer.renderError };
    }, view);
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(output, `wall-ceiling-${variant}-${view.name}.png`) });
    assert.deepEqual(errors, []);
    assert.equal(state.renderError, '');
    if (variant === 'after') {
      assert.equal(state.roomClayCeiling, false);
      if (view.mansion) {
        assert.equal(state.mansionClayCeilings, 0);
        assert(state.mansionConcreteSoffits >= 8);
        assert.equal(state.exposedEnds, true);
        assert(state.roofs.every(roof => roof.visible));
      } else assert(Math.abs(state.roomSlabY - 3.08) < .01);
    }
    let editorCycle = null;
    if ((variant === 'after' || process.argv.includes('--editor-cycle')) && view.name === 'garage-ceiling') {
      editorCycle = await page.evaluate(async () => {
        const game = window.__wireTheHouse;
        const roof = game.room.mansionWing.getObjectByName('Continuous cast garage roof panel around existing L1 floor');
        const before = roof.visible;
        await game.levelEditor.open();
        const during = roof.visible;
        game.levelEditor.close();
        return { before, during, after: roof.visible, editorClosed: !game.levelEditor.active };
      });
      assert.deepEqual(editorCycle, { before: true, during: false, after: true, editorClosed: true });
    }
    report.push({ view: view.name, state, editorCycle, errors });
    await context.close();
  }
} finally { await browser.close(); }
await fs.writeFile(path.join(output, `wall-ceiling-${variant}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
