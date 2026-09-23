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
  await page.waitForTimeout(3800);
  const state = await page.evaluate(() => {
    const game = window.__wireTheHouse;
    game.player.camera.position.set(0, game.player.eyeHeight, 1.35);
    game.player.yaw = 0;
    game.player.pitch = -.06;
    game.player.camera.rotation.set(game.player.pitch, game.player.yaw, 0);
    game.selectedTool = 'drill';
    return { selectedTool: game.selectedTool };
  });
  await page.waitForTimeout(900);
  const visual = await page.evaluate(() => {
    const drill = window.__wireTheHouse.fpsRig.getObjectByName('FPS drill tool');
    const shell = drill?.getObjectByName('Photographed cordless drill shell');
    const procedural = drill?.children.filter(child => child.userData.toolModelPart === true) ?? [];
    if (shell) shell.visible = false;
    procedural.forEach(child => { child.visible = true; });
    return { shellLoaded: Boolean(shell), proceduralCount: procedural.length,
      tip: drill?.userData.tipPoint, grip: drill?.userData.gripPoint };
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(output, 'drill-before.png') });
  await page.evaluate(() => {
    const drill = window.__wireTheHouse.fpsRig.getObjectByName('FPS drill tool');
    drill.getObjectByName('Photographed cordless drill shell').visible = true;
    drill.children.filter(child => child.userData.toolModelPart === true)
      .forEach(child => { child.visible = false; });
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(output, 'drill-after.png') });
  const timing = await page.evaluate(async () => {
    const drill = window.__wireTheHouse.fpsRig.getObjectByName('FPS drill tool');
    const shell = drill.getObjectByName('Photographed cordless drill shell');
    const sample = async visible => {
      shell.visible = visible;
      drill.children.filter(child => child.userData.toolModelPart === true)
        .forEach(child => { child.visible = !visible; });
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
    return { before: await sample(false), after: await sample(true) };
  });
  if (!visual.shellLoaded) throw new Error('Photographed drill shell failed to load');
  await page.evaluate(() => {
    const game = window.__wireTheHouse;
    game.player.camera.position.set(1.45, game.player.eyeHeight, .4);
    game.player.yaw = -Math.PI / 2;
    game.player.pitch = 0;
    game.player.camera.rotation.set(0, game.player.yaw, 0);
    game.selectedTool = 'drill';
    const clay = game.room.getObjectByName('Right fired-clay courses');
    window.__clayNormalNode = clay.material.normalNode;
    clay.material.normalNode = null;
    clay.material.needsUpdate = true;
  });
  await page.waitForTimeout(650);
  await page.screenshot({ path: path.join(output, 'brick-normal-before.png') });
  await page.evaluate(() => {
    const clay = window.__wireTheHouse.room.getObjectByName('Right fired-clay courses');
    clay.material.normalNode = window.__clayNormalNode;
    clay.material.needsUpdate = true;
  });
  await page.waitForTimeout(650);
  await page.screenshot({ path: path.join(output, 'brick-normal-after.png') });
  const interaction = await page.evaluate(() => {
    const game = window.__wireTheHouse;
    const drill = game.fpsRig.getObjectByName('FPS drill tool');
    const shell = drill.getObjectByName('Photographed cordless drill shell');
    const motor = drill.getObjectByName('reference-motor');
    const trigger = drill.getObjectByName('Index finger trigger');
    const tipWithShell = game.fpsRig.toolTipWorld(game.renderer.camera, 'drill').toArray();
    shell.visible = false;
    const tipWithoutShell = game.fpsRig.toolTipWorld(game.renderer.camera, 'drill').toArray();
    shell.visible = true;
    const shellMesh = shell.getObjectByName('Drill_01');
    shellMesh.geometry.computeBoundingBox();
    shellMesh.updateWorldMatrix(true, false);
    const shellBounds = shellMesh.geometry.boundingBox.clone().applyMatrix4(shellMesh.matrixWorld);
    const shellTipGapM = shellBounds.distanceToPoint(game.fpsRig.toolTipWorld(game.renderer.camera, 'drill'));
    return { tipWithShell, tipWithoutShell, triggerPresent: Boolean(trigger),
      motorPresent: Boolean(motor), shellTipGapM,
      triangles: shellMesh.geometry.index.count / 3 };
  });
  await page.evaluate(() => {
    const game = window.__wireTheHouse;
    game.player.camera.position.set(0, game.player.eyeHeight, 1.35);
    game.player.yaw = 0;
    game.player.pitch = -.06;
    game.player.camera.rotation.set(game.player.pitch, game.player.yaw, 0);
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(450);
  await page.screenshot({ path: path.join(output, 'drill-mobile-viewport.png') });
  await page.setViewportSize({ width: 1365, height: 768 });
  await fs.writeFile(path.join(output, 'drill-check.json'), JSON.stringify({ state, visual, timing, interaction, errors }, null, 2));
  if (errors.length || !interaction.triggerPresent || !interaction.motorPresent ||
    interaction.tipWithShell.some((value, i) => Math.abs(value - interaction.tipWithoutShell[i]) > 1e-6))
    process.exitCode = 1;
} finally {
  await browser.close();
}
