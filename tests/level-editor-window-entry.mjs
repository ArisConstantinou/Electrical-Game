import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { blockPointerLock } from './browser-safety.mjs';

const dist = resolve('dist');
const mobile = process.argv.includes('--mobile');
const out = resolve('output/level-editor-window-entry');
await mkdir(out, { recursive:true });
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.webp':'image/webp',
  '.png':'image/png', '.jpg':'image/jpeg', '.glb':'model/gltf-binary', '.svg':'image/svg+xml' };
const browser = await chromium.launch({ channel:'chrome', headless:true });
try {
  const context = await browser.newContext({ viewport:mobile ? { width:390, height:844 } : { width:1366, height:768 },
    isMobile:mobile, hasTouch:mobile });
  await blockPointerLock(context);
  await context.route('https://arisconstantinou.github.io/Electrical-Game/**', async route => {
    const file = resolve(dist, decodeURIComponent(new URL(route.request().url()).pathname.slice('/Electrical-Game/'.length)) || 'index.html');
    if (!file.startsWith(`${dist}\\`)) return route.abort();
    try {
      if (!(await stat(file)).isFile()) return route.abort();
      await route.fulfill({ status:200, contentType:mime[extname(file)] ?? 'application/octet-stream', body:await readFile(file) });
    } catch { await route.abort(); }
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://arisconstantinou.github.io/Electrical-Game/?mansion=preview&editor=1&renderer=webgl');
  await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout:120000 });
  const id = z => `site-asset:courtyard-east-window-sill-assembly-${z}:1`;
  const select = async z => { await page.evaluate(name => {
    const game = window.__wireTheHouse;
    game.levelEditor.selectWall(game.room.mansionWing.editableAssets.get(name));
  }, id(z)); await page.locator('#level-details-toggle').click(); };
  if (mobile) {
    await page.locator('.level-editor__bottom-nav [data-editor-tab="select"]').click();
    await page.locator('#level-browser-toggle').click();
    await page.locator('#level-list button').filter({ hasText:'Courtyard east window sill assembly 8' }).click();
    await page.locator('#level-details-toggle').click();
  } else await select(8);
  assert.equal(await page.locator('#level-remove-sill').isVisible(), true);
  await page.screenshot({ path:resolve(out,mobile ? 'mobile-sill-action.png' : 'desktop-sill-action.png') });
  await page.locator('#level-remove-sill').click();
  const first = await page.evaluate(name => {
    const game = window.__wireTheHouse, wing = game.room.mansionWing;
    const sill = wing.editableAssets.get(name);
    const obstacle = wing.obstaclesAt(0).find(item => item.id === 'court-open-window-sill-8');
    return { hidden:sill.userData.levelEditorHidden, visible:sill.visible,
      obstacleMinX:obstacle.minX, saved:game.levelEditor.document().assets.find(asset => asset.id === name)?.hidden };
  }, id(8));
  assert.deepEqual(first, { hidden:true, visible:false, obstacleMinX:Infinity, saved:true });
  await page.evaluate(() => window.__wireTheHouse.levelEditor.moveHistory(-1));
  assert.equal(await page.evaluate(name => window.__wireTheHouse.room.mansionWing.editableAssets.get(name).visible, id(8)), true);
  await page.evaluate(() => window.__wireTheHouse.levelEditor.moveHistory(1));
  assert.equal(await page.evaluate(name => window.__wireTheHouse.room.mansionWing.editableAssets.get(name).visible, id(8)), false);
  await page.evaluate(() => [...document.querySelectorAll('#level-list button')]
    .find(button => button.textContent === 'RESTORE · Courtyard east window sill assembly 8').click());
  assert.equal(await page.evaluate(name => window.__wireTheHouse.room.mansionWing.editableAssets.get(name).visible, id(8)), true);
  await select(8);
  await page.locator('#level-remove-sill').click();
  await select(12);
  await page.locator('#level-remove-sill').click();
  const saved = await page.evaluate(() => window.__wireTheHouse.levelEditor.document());
  await page.evaluate(snapshot => {
    const game = window.__wireTheHouse, wing = game.room.mansionWing;
    for (const z of [8,12]) wing.setEditorAssetHidden(wing.editableAssets.get(`site-asset:courtyard-east-window-sill-assembly-${z}:1`), false);
    game.levelEditor.applyDocument(snapshot);
  }, saved);
  const traverse = await page.evaluate(() => {
    const game = window.__wireTheHouse;
    game.levelEditor.close();
    game.step = () => {};
    const player = game.player, camera = player.camera;
    player.wallWorkEnabled = false;
    const enter = z => {
      camera.position.set(16.7, player.eyeHeight, z);
      player.yaw = -Math.PI / 2;
      game.input.mobileMove.y = -1;
      for (let frame=0; frame<300; frame++) player.update(1/60);
      game.input.mobileMove.y = 0;
      return { x:camera.position.x, z:camera.position.z };
    };
    return { south:enter(9), north:enter(13), renderError:game.renderer.renderError };
  });
  assert(traverse.south.x > 20, `South entry blocked: ${JSON.stringify(traverse)}`);
  assert(traverse.north.x > 20, `North entry blocked: ${JSON.stringify(traverse)}`);
  assert.equal(traverse.renderError, '');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ pass:true, mobile, first, traverse }));
} finally { await browser.close(); }
