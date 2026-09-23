import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const out = 'output/mansion-courtyard-route';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { cases: [], errors: [], note: 'Chrome viewport emulation, not a physical phone.' };
try {
  for (const device of [
    { name: 'mobile-portrait', viewport: { width: 390, height: 844 }, mobile: true },
    { name: 'mobile-landscape', viewport: { width: 844, height: 390 }, mobile: true },
    { name: 'tablet-portrait', viewport: { width: 820, height: 1180 }, mobile: true },
    { name: 'desktop', viewport: { width: 1366, height: 768 }, mobile: false },
  ]) {
    const context = await browser.newContext({ viewport: device.viewport, deviceScaleFactor: 1, isMobile: device.mobile, hasTouch: device.mobile });
    await blockPointerLock(context);
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(`${device.name}: ${error.message}`));
    if (process.env.QA_DIST_ROOT) {
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
    }
    await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&renderer=webgl');
    await page.locator('#start-button').waitFor({ state: 'visible', timeout: 120000 });
    await page.locator('#apprentice-count').selectOption('0');
    await page.locator('#start-button').click({ timeout: 120000 });
    await page.waitForFunction(() => window.__wireTheHouse?.started, null, { timeout: 120000 });
    await page.evaluate(() => {
      const g = window.__wireTheHouse;
      g.player.camera.position.set(0, g.player.eyeHeight, 10);
      g.player.yaw = Math.PI; g.player.pitch = -.07;
      g.player.camera.rotation.set(-.07, Math.PI, 0, 'YXZ');
    });
    const walk = async (yaw, axis, target, greater) => {
      await page.evaluate(value => { const g = window.__wireTheHouse; g.player.yaw = value; g.input.keys.add('KeyW'); }, yaw);
      try {
        await page.waitForFunction(({ axis, target, greater }) => {
          const p = window.__wireTheHouse.player.camera.position, value = axis === 'x' ? p.x : p.z;
          return greater ? value > target : value < target;
        }, { axis, target, greater }, { timeout: 6000, polling: 50 });
      } finally {
        await page.evaluate(() => window.__wireTheHouse.input.keys.delete('KeyW'));
      }
      await page.waitForTimeout(180);
      return page.evaluate(() => window.__wireTheHouse.player.camera.position.toArray());
    };
    const north = await walk(Math.PI, 'z', 13.8, true);
    await page.evaluate(() => { const g = window.__wireTheHouse; g.player.yaw = -Math.PI / 2; g.player.pitch = -.07; });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${out}/${device.name}-courtyard-opening.png` });
    const court = await walk(-Math.PI / 2, 'x', 10.1, true);
    assert(court[0] > 9.6 && court[2] > 13, `${device.name}: courtyard doorless route is blocked: ${court}`);
    await page.screenshot({ path: `${out}/${device.name}-inside-courtyard.png` });
    await page.evaluate(() => { const g = window.__wireTheHouse; g.player.yaw = -.9; g.player.pitch = -.08; });
    await page.waitForTimeout(260);
    await page.screenshot({ path: `${out}/${device.name}-olive-and-court.png` });
    const tree = await page.evaluate(() => {
      const wing = window.__wireTheHouse.room.mansionWing;
      const olive = wing.courtyard.getObjectByName('Existing olive tree retained in open mansion court');
      const canopy = olive?.children.find(child => child.type === 'Group');
      return { exists: Boolean(olive), rotation: canopy?.rotation.z ?? null,
        obstacle: wing.obstacles.some(item => item.id === 'retained-olive-trunk') };
    });
    assert(tree.exists && tree.obstacle && tree.rotation !== null, `${device.name}: courtyard olive or hitbox absent: ${JSON.stringify(tree)}`);
    await page.waitForTimeout(350);
    const laterRotation = await page.evaluate(() => {
      const olive = window.__wireTheHouse.room.mansionWing.courtyard.getObjectByName('Existing olive tree retained in open mansion court');
      return olive.children.find(child => child.type === 'Group').rotation.z;
    });
    assert(Math.abs(laterRotation - tree.rotation) > .0002, `${device.name}: olive canopy does not move over time`);
    const back = await walk(Math.PI / 2, 'x', 8.3, false);
    assert(back[0] < 9, `${device.name}: cannot return to foyer: ${back}`);
    await page.evaluate(() => {
      const g = window.__wireTheHouse;
      g.player.camera.position.set(13.35, g.player.eyeHeight, 10.55);
      g.player.yaw = Math.PI;
    });
    await page.evaluate(() => window.__wireTheHouse.input.keys.add('KeyW'));
    await page.waitForTimeout(650);
    await page.evaluate(() => window.__wireTheHouse.input.keys.delete('KeyW'));
    const trunkContact = await page.evaluate(() => window.__wireTheHouse.player.camera.position.toArray());
    assert(trunkContact[2] <= 10.84, `${device.name}: player body passes through retained olive trunk: ${trunkContact}`);
    report.cases.push({ device: device.name, north, court, tree, laterRotation, back, trunkContact });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
} finally {
  await browser.close();
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
