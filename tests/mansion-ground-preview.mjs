import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const output = 'output/mansion-ground-preview';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { cases: [], errors: [], note: 'Viewport emulation is not physical phone performance evidence.' };
try {
  for (const device of [
    { name: 'mobile-portrait', viewport: { width: 390, height: 844 }, isMobile: true },
    { name: 'desktop', viewport: { width: 1366, height: 768 }, isMobile: false },
  ]) {
    const context = await browser.newContext({ viewport: device.viewport, isMobile: device.isMobile, hasTouch: device.isMobile, deviceScaleFactor: 1 });
    await blockPointerLock(context);
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(`${device.name}: ${error.message}`));
    await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&renderer=webgl');
    await page.locator('#start-button').waitFor({ state: 'visible', timeout: 120000 });
    await page.locator('#apprentice-count').selectOption('0');
    await page.locator('#start-button').click();
    await page.waitForFunction(() => window.__wireTheHouse?.started, null, { timeout: 120000 });
    const pose = async (x, z, yaw, pitch = -.04) => {
      await page.evaluate(({ x, z, yaw, pitch }) => {
        const g = window.__wireTheHouse;
        g.player.camera.position.set(x, g.player.eyeHeight, z);
        g.player.yaw = yaw;
        g.player.pitch = pitch;
        g.player.camera.rotation.set(pitch, yaw, 0, 'YXZ');
      }, { x, z, yaw, pitch });
      await page.waitForTimeout(350);
    };
    const position = () => page.evaluate(() => window.__wireTheHouse.player.camera.position.toArray());
    await pose(.45, 2.7, Math.PI);
    await page.screenshot({ path: `${output}/${device.name}-room-to-passage.png` });
    await page.evaluate(() => window.__wireTheHouse.input.keys.add('KeyW'));
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.__wireTheHouse.input.keys.delete('KeyW'));
    const passage = await position();
    const equipment = await page.evaluate(() => window.__wireTheHouse.mixing.collisionObstacles().filter(o => o.maxZ > 1 && o.minZ < 4));
    assert(passage[2] > 3.8, `${device.name}: cannot walk through the opened rear wall: ${passage}; equipment: ${JSON.stringify(equipment)}`);
    report.cases.push({ device: device.name, step: 'room-to-passage', position: passage });
    await page.screenshot({ path: `${output}/${device.name}-passage.png` });
    await pose(0, 6.2, Math.PI);
    await page.evaluate(() => window.__wireTheHouse.input.keys.add('KeyW'));
    await page.waitForTimeout(1600);
    await page.evaluate(() => window.__wireTheHouse.input.keys.delete('KeyW'));
    const foyer = await position();
    assert(foyer[2] > 7.7, `${device.name}: passage does not reach the foyer: ${foyer}`);
    report.cases.push({ device: device.name, step: 'passage-to-foyer', position: foyer });
    await page.screenshot({ path: `${output}/${device.name}-foyer.png` });
    await pose(.45, 5.2, 0);
    await page.evaluate(() => window.__wireTheHouse.input.keys.add('KeyW'));
    await page.waitForTimeout(1400);
    await page.evaluate(() => window.__wireTheHouse.input.keys.delete('KeyW'));
    const back = await position();
    assert(back[2] < 3.5, `${device.name}: cannot return to the original work room: ${back}`);
    report.cases.push({ device: device.name, step: 'return-to-work-room', position: back });
    // A wall beside the aperture must block the same movement.
    await pose(2.2, 2.7, Math.PI);
    await page.evaluate(() => window.__wireTheHouse.input.keys.add('KeyW'));
    await page.waitForTimeout(1100);
    await page.evaluate(() => window.__wireTheHouse.input.keys.delete('KeyW'));
    const blocked = await position();
    assert(blocked[2] < 3.45, `${device.name}: body clips through rear masonry: ${blocked}`);
    report.cases.push({ device: device.name, step: 'solid-rear-wall-collision', position: blocked });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
} finally {
  await browser.close();
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
