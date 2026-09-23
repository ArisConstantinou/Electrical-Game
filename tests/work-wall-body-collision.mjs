import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await blockPointerLock(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&renderer=webgl');
  await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 120_000 });
  await page.locator('#start-button').click();
  await page.waitForFunction(() => window.__wireTheHouse?.started);
  const results = await page.evaluate(() => {
    const game = window.__wireTheHouse;
    game.step = () => {};
    const wall = game.room.brickWall, pivot = wall.parent;
    const player = game.player;
    player.wallWorkEnabled = false;
    player.setMansionPreview(true);
    const walk = () => {
      player.camera.position.set(0, player.eyeHeight, -1.7);
      player.yaw = 0;
      player.pitch = 0;
      game.input.mobileMove.y = -1;
      for (let i = 0; i < 240; i++) player.update(1 / 60);
      game.input.mobileMove.y = 0;
      return { z: player.camera.position.z, contacts: [...player.collisionContacts] };
    };
    const original = walk();
    pivot.position.z -= 1;
    pivot.updateWorldMatrix(true, true);
    const movedObstacle = game.room.mansionWing.obstaclesAt(0).find(item => item.id === pivot.name);
    const moved = walk();
    return { original, moved, pivot: pivot.name, movedObstacle };
  });
  console.log(JSON.stringify(results));
  assert.deepEqual(errors, []);
  assert(results.original.z > -2.25 && results.original.z < -2, 'Original masonry must stop the player');
  assert(results.movedObstacle?.segments?.length, 'Moved work wall needs a physical segment');
  assert(results.moved.z < -2.7 && results.moved.z > -3.25, 'Player must approach the moved wall rather than the abandoned plane');
  assert(results.moved.contacts.includes(results.pivot), 'Physical contact must identify the work wall');
  await context.close();
} finally {
  await browser.close();
}
