import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const out = 'output/default-mansion-access';
await mkdir(out, { recursive: true });
const routeDist = async page => {
  if (!process.env.QA_DIST_ROOT) return;
  const root = path.resolve(process.env.QA_DIST_ROOT);
  await page.route('http://127.0.0.1:5365/Electrical-Game/**', async route => {
    const relative = decodeURIComponent(new URL(route.request().url()).pathname).slice('/Electrical-Game/'.length) || 'index.html';
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep)) return route.abort();
    try {
      const extension = path.extname(file).toLowerCase();
      await route.fulfill({ status: 200, body: await readFile(file), contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.svg': 'image/svg+xml' })[extension] || 'application/octet-stream' });
    } catch { await route.fulfill({ status: 404, body: `Missing isolated asset: ${relative}` }); }
  });
};
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  await blockPointerLock(context);
  const page = await context.newPage();
  await routeDist(page);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5365/Electrical-Game/');
  await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart && !document.querySelector('#start-button')?.disabled, undefined, { timeout: 120000 });
  await page.locator('#apprentice-count').selectOption('0');
  await page.locator('#start-button').click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/default-start.png` });
  const guide = page.locator('#desktop-key-guide');
  const guideToggle = page.locator('#desktop-key-guide-toggle');
  assert.equal(await guide.isVisible(), false, 'Keyboard guide must start closed');
  await guideToggle.click();
  assert.equal(await guide.isVisible(), true, 'Side tab must open keyboard guide');
  assert.equal(await guideToggle.getAttribute('aria-expanded'), 'true');
  await page.screenshot({ path: `${out}/keyboard-guide-open.png` });
  await guideToggle.click();
  assert.equal(await guide.isVisible(), false, 'Side tab must close keyboard guide');
  assert.equal(await guideToggle.getAttribute('aria-expanded'), 'false');
  const initial = await page.evaluate(() => ({
    mansion: Boolean(window.__wireTheHouse.room.mansionWing),
    x: window.__wireTheHouse.player.camera.position.x,
    z: window.__wireTheHouse.player.camera.position.z,
    yaw: window.__wireTheHouse.player.yaw,
  }));
  assert(initial.mansion, `Default Start loaded old isolated room: ${JSON.stringify(initial)}`);
  assert(initial.z > 3.8, `Default Start is still inside old room: ${JSON.stringify(initial)}`);
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__wireTheHouse.player.camera.position.z > 9, undefined, { timeout: 8000 });
  await page.keyboard.up('KeyW');
  const reached = await page.evaluate(() => window.__wireTheHouse.player.camera.position.z);
  await page.evaluate(() => { window.__wireTheHouse.player.yaw = Math.PI * 1.5; });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1800);
  const foyerTraverse = await page.evaluate(() => ({ x: window.__wireTheHouse.player.camera.position.x,
    z: window.__wireTheHouse.player.camera.position.z, contacts: window.__wireTheHouse.player.collisionContacts }));
  await page.keyboard.up('KeyW');
  assert(foyerTraverse.x > 2, `Foyer blocked: ${JSON.stringify(foyerTraverse)}`);
  await page.evaluate(() => { window.__wireTheHouse.player.yaw = Math.PI; });
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__wireTheHouse.player.camera.position.z > 13.5, undefined, { timeout: 8000 });
  await page.keyboard.up('KeyW');
  await page.evaluate(() => { window.__wireTheHouse.player.yaw = Math.PI * 1.5; });
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__wireTheHouse.player.camera.position.x > 9.8, undefined, { timeout: 8000 });
  await page.keyboard.up('KeyW');
  await page.screenshot({ path: `${out}/courtyard-reached.png` });
  const courtyard = await page.evaluate(() => ({ x: window.__wireTheHouse.player.camera.position.x, z: window.__wireTheHouse.player.camera.position.z }));
  // The old mission room is part of this level and remains reachable through the same opening.
  await page.evaluate(() => {
    const game = window.__wireTheHouse;
    game.player.camera.position.set(0, game.player.eyeHeight, 5.2);
    game.player.yaw = 0;
  });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1800);
  await page.keyboard.up('KeyW');
  const oldRoom = await page.evaluate(() => ({ x: window.__wireTheHouse.player.camera.position.x,
    z: window.__wireTheHouse.player.camera.position.z, contacts: window.__wireTheHouse.player.collisionContacts,
    mixer: window.__wireTheHouse.mixing.collisionObstacles().find(item => item.id === 'concrete-mixer') }));
  assert(oldRoom.z < 2.8, `Old room passage blocked: ${JSON.stringify(oldRoom)}`);
  assert.deepEqual(errors, []);
  await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=basic');
  await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart && !document.querySelector('#start-button')?.disabled, undefined, { timeout: 120000 });
  assert.equal(await page.evaluate(() => Boolean(window.__wireTheHouse.room.mansionWing)), false,
    'Explicit original-room route must retain the original room');
  await context.close();
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await blockPointerLock(mobile);
  const mobilePage = await mobile.newPage();
  await routeDist(mobilePage);
  const mobileErrors = [];
  mobilePage.on('pageerror', error => mobileErrors.push(error.message));
  await mobilePage.goto('http://127.0.0.1:5365/Electrical-Game/');
  await mobilePage.waitForFunction(() => window.__wireTheHouse?.isReadyForStart && !document.querySelector('#start-button')?.disabled, undefined, { timeout: 120000 });
  await mobilePage.locator('#start-button').tap();
  await mobilePage.screenshot({ path: `${out}/mobile-default-start.png` });
  const mobileStart = await mobilePage.evaluate(() => ({ mansion: Boolean(window.__wireTheHouse.room.mansionWing),
    z: window.__wireTheHouse.player.camera.position.z }));
  assert(mobileStart.mansion && mobileStart.z > 3.8, `Mobile Start did not enter connected mansion: ${JSON.stringify(mobileStart)}`);
  assert.equal(await mobilePage.locator('#desktop-key-guide-toggle').isVisible(), false);
  assert.deepEqual(mobileErrors, []);
  console.log(JSON.stringify({ initial, reached, courtyard, oldRoom, mobileStart, originalRoute: true, errors, mobileErrors }));
} finally {
  await browser.close();
}
