import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { blockPointerLock } from './browser-safety.mjs';

const distMode = process.argv.includes('--dist');
const out = resolve('output/mansion-circulation-access');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await blockPointerLock(context);
  if (distMode) {
    const dist = resolve('dist');
    const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.webp':'image/webp',
      '.png':'image/png', '.jpg':'image/jpeg', '.glb':'model/gltf-binary', '.svg':'image/svg+xml' };
    await context.route('https://arisconstantinou.github.io/Electrical-Game/**', async route => {
      const file = resolve(dist, decodeURIComponent(new URL(route.request().url()).pathname.slice('/Electrical-Game/'.length)) || 'index.html');
      if (!file.startsWith(`${dist}\\`)) return route.abort();
      try {
        if (!(await stat(file)).isFile()) return route.abort();
        await route.fulfill({ status:200, contentType:mime[extname(file)] ?? 'application/octet-stream', body:await readFile(file) });
      } catch { await route.abort(); }
    });
  }
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto((distMode ? 'https://arisconstantinou.github.io/Electrical-Game/' : 'http://127.0.0.1:5365/Electrical-Game/') + '?mansion=preview&editor=1&renderer=webgl');
  await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout:120000 });
  const opening = await page.evaluate(() => {
    const game=window.__wireTheHouse, editor=game.levelEditor;
    const wall=game.room.mansionWing.editableWalls.get('Foyer south masonry west of garage passage');
    const [start,end]=editor.wallEndpoints(wall);
    editor.selectWall(wall);
    return {length:start.distanceTo(end),fromStart:Math.abs(5.5-start.x)};
  });
  await page.locator('#level-wall-tools-toggle').click();
  await page.locator('#level-wall-opening-width').fill('1.5');
  await page.locator('#level-wall-opening-position').fill(opening.fromStart.toFixed(2));
  await page.locator('#level-wall-opening').click();
  for (const z of [8,12]) {
    await page.evaluate(z => {
      const game=window.__wireTheHouse;
      game.levelEditor.selectWall(game.room.mansionWing.editableAssets.get(`site-asset:courtyard-east-window-sill-assembly-${z}:1`));
    },z);
    await page.locator('#level-details-toggle').click();
    await page.locator('#level-remove-sill').click();
  }
  await page.screenshot({ path:resolve(out,'editor-openings.png') });
  await page.evaluate(() => window.__wireTheHouse.levelEditor.close());
  await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout:120000 });
  await page.locator('#apprentice-count').selectOption('0');
  await page.locator('#start-button').click();
  await page.locator('#start-screen').waitFor({ state:'hidden', timeout:120000 });
  const result = await page.evaluate(() => {
    const game = window.__wireTheHouse;
    game.step = () => {};
    const player = game.player, camera = player.camera;
    player.wallWorkEnabled = false;
    const travel = (start, waypoints) => {
      camera.position.set(start[0], player.eyeHeight + start[2], start[1]);
      for (const waypoint of waypoints) for (let frame=0; frame<500; frame++) {
        const dx=waypoint[0]-camera.position.x, dz=waypoint[1]-camera.position.z;
        if (Math.hypot(dx,dz)<.06) break;
        player.yaw=Math.atan2(-dx,-dz);
        game.input.mobileMove.x=0; game.input.mobileMove.y=-1;
        player.update(1/60);
      }
      game.input.mobileMove.y=0;
      return { x:camera.position.x, z:camera.position.z, feet:camera.position.y-player.eyeHeight };
    };
    const up=travel([5.5,7.2,0],[[5.5,11.65],[7.5,11.65],[7.5,7.2]]);
    const down=travel([7.5,7.75,0],[[7.5,11.65],[5.5,11.65],[5.5,7.2]]);
    const descend=travel([7.5,7.75,3.3],[[7.5,11.65],[5.5,11.65],[5.5,7.75]]);
    const ascend=travel([5.5,7.2,-3.4],[[5.5,11.65],[7.5,11.65],[7.5,7.75]]);
    const roomSouth=travel([16.7,9,0],[[20.2,9]]);
    const backSouth=travel([20.2,9,0],[[21.4,9]]);
    const roomNorth=travel([16.7,13,0],[[20.2,13]]);
    const backNorth=travel([20.2,13,0],[[21.4,13]]);
    return {up,down,descend,ascend,roomSouth,backSouth,roomNorth,backNorth,renderError:game.renderer.renderError};
  });
  assert(result.up.feet>3.2 && result.up.z<7.4, `Ground-to-L1 stair blocked: ${JSON.stringify(result.up)}`);
  assert(result.down.feet< -3.2 && result.down.z<7.4, `Ground-to-B1 stair blocked: ${JSON.stringify(result.down)}`);
  assert(result.descend.feet<.3 && result.descend.z<8.2, `L1-to-ground stair blocked: ${JSON.stringify(result.descend)}`);
  assert(result.ascend.feet>-.2 && result.ascend.z<8.2, `B1-to-ground stair blocked: ${JSON.stringify(result.ascend)}`);
  for (const side of ['South','North']) {
    assert(result[`room${side}`].x>20, `${side} room entrance blocked`);
    assert(result[`back${side}`].x<20.65, `${side} room back wall has no body collision`);
  }
  assert.equal(result.renderError, '');
  assert.deepEqual(errors, []);
  await page.evaluate(() => {
    const game=window.__wireTheHouse;
    game.player.camera.position.set(18.5,game.player.eyeHeight,9);
    game.player.yaw=-Math.PI/2;
    game.player.camera.rotation.set(0,game.player.yaw,0);
    game.renderer.render();
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path:resolve(out,'courtyard-room-entry.png') });
  await writeFile(resolve(out,'report.json'),JSON.stringify({distMode,result,errors},null,2));
  console.log(JSON.stringify({pass:true,distMode,opening,result}));
  await context.close();
} finally { await browser.close(); }
