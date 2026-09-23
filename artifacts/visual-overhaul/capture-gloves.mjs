import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const root = path.resolve('dist');
const output = path.resolve('artifacts/visual-overhaul');
const candidate = path.resolve(process.env.QA_GLOVE_CANDIDATE_GLB || 'public/assets/worker/worker.glb');
const original = await fs.readFile('output/visual-overhaul/glove-before/worker.glb')
  .catch(() => execFileSync('git', ['show', '4a032b7:public/assets/worker/worker.glb'], { maxBuffer: 25_000_000 }));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = [];
try {
  for (const variant of ['before', 'candidate']) {
    for (const mobile of process.env.QA_GLOVE_DESKTOP_ONLY ? [false] : [false, true]) {
      const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1365, height: 768 }, deviceScaleFactor: 1 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.route('http://127.0.0.1:5365/Electrical-Game/**', async route => {
        const relative = decodeURIComponent(new URL(route.request().url()).pathname)
          .slice('/Electrical-Game/'.length) || 'index.html';
        const file = relative === 'assets/worker/worker.glb' ? candidate : path.resolve(root, relative);
        if (file !== candidate && !file.startsWith(root + path.sep)) return route.abort();
        try {
          const body = relative === 'assets/worker/worker.glb' && variant === 'before'
            ? original : await fs.readFile(file);
          const extension = path.extname(file).toLowerCase();
          const contentType = ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
            '.json': 'application/json', '.webp': 'image/webp', '.jpg': 'image/jpeg',
            '.png': 'image/png', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
            '.bin': 'application/octet-stream' })[extension] || 'application/octet-stream';
          await route.fulfill({ status: 200, contentType, body });
        } catch { await route.fulfill({ status: 404, body: `Missing isolated asset: ${relative}` }); }
      });
      await page.goto('http://127.0.0.1:5365/Electrical-Game/');
      await page.locator('#start-button').click({ timeout: 90000 });
      await page.waitForFunction(() => window.__wireTheHouse?.started &&
        getComputedStyle(document.querySelector('#start-screen')).visibility === 'hidden', null, { timeout: 30000 });
      await page.waitForFunction(() => window.__wireTheHouse?.workerBody.loaded, null, { timeout: 60000 });
      await page.evaluate(() => {
        const game = window.__wireTheHouse;
        game.player.velocity.set(0, 0, 0);
        const point = game.mission.points.find(item => item.definition.id === 'C');
        const target = point.getWorldPosition(game.player.camera.position.clone());
        game.player.camera.position.set(target.x, game.player.eyeHeight, target.z + .8);
        game.player.yaw = 0;
        game.player.pitch = Math.atan2(target.y - game.player.eyeHeight, .8);
        game.player.camera.rotation.set(game.player.pitch, 0, 0);
      });
      for (const tool of ['spray', 'drill']) {
        await page.evaluate(tool => window.__wireTheHouse.selectTool(tool), tool);
        await page.evaluate(async () => {
          const renderer = window.__wireTheHouse.renderer;
          renderer.render();
          await renderer.waitForFrame();
        });
        await page.waitForTimeout(900);
        await page.screenshot({ path: path.join(output, `glove-${variant}-${tool}-${mobile ? 'mobile' : 'desktop'}.png`) });
      }
      const data = await page.evaluate(async () => {
        const game = window.__wireTheHouse;
        const glove = [];
        game.workerBody.traverse(object => {
          if (object.isMesh && !Array.isArray(object.material) && object.material?.name === 'Scanned graphite work glove') glove.push(object.name);
        });
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
        return { loaded: game.workerBody.loaded, gloveMeshes: glove.length,
          medianMs: intervals[45], p95Ms: intervals[85] };
      });
      report.push({ variant, mobile, ...data, errors });
      if (errors.length || !data.loaded || (variant === 'candidate' && data.gloveMeshes < 1)) process.exitCode = 1;
      if (!mobile) {
        await page.evaluate(async () => {
          const game = window.__wireTheHouse;
          game.step = () => {};
          game.selectTool('spray');
          const body = game.workerBody;
          body.overview = true;
          for (let i = 0; i < 40; i++)
            body.update(1 / 60, game.renderer.camera, game.player, game.fpsRig,
              'spray', false, false, []);
          body.updateMatrixWorld(true);
          const hand = body.bone('hand.R').getWorldPosition(game.renderer.camera.position.clone());
          const camera = game.modelInspector.camera;
          camera.position.copy(hand).add({ x: .18, y: .12, z: -.37 });
          camera.lookAt(hand);
          camera.fov = 45;
          camera.aspect = 1365 / 768;
          camera.updateProjectionMatrix();
          game.renderer.viewCamera = camera;
          game.renderer.render();
          await game.renderer.waitForFrame();
        });
        await page.screenshot({ path: path.join(output, `glove-${variant}-hand-close.png`) });
      }
      await page.close();
    }
  }
  await fs.writeFile(path.join(output, 'glove-candidate-check.json'), JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
