import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const out = 'output/mansion-ground-garage-route';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { cases: [], errors: [], note: 'Chrome viewport emulation on Windows; not physical-phone evidence.' };
const only = process.argv.find(value => value.startsWith('--only='))?.slice('--only='.length);
try {
  for (const device of [
    { name: 'mobile-portrait', width: 390, height: 844, touch: true },
    { name: 'mobile-landscape', width: 844, height: 390, touch: true },
    { name: 'tablet-portrait', width: 820, height: 1180, touch: true },
    { name: 'desktop', width: 1366, height: 768, touch: false },
  ].filter(device => !only || device.name === only)) {
    const context = await browser.newContext({ viewport: { width: device.width, height: device.height },
      deviceScaleFactor: 1, isMobile: device.touch, hasTouch: device.touch });
    await blockPointerLock(context);
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(`${device.name}: ${error.message}`));
    await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&renderer=webgl');
    await page.locator('#start-button').waitFor({ state: 'visible', timeout: 120000 });
    await page.locator('#apprentice-count').selectOption('0');
    await page.locator('#start-button').click();
    await page.waitForFunction(() => window.__wireTheHouse?.started, null, { timeout: 120000 });
    await page.evaluate(() => { const g = window.__wireTheHouse;
      g.player.camera.position.set(7.5, g.player.eyeHeight, 7.85);
      g.player.yaw = 0; g.player.pitch = -.06;
    });
    const eye = await page.evaluate(() => window.__wireTheHouse.player.eyeHeight);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${out}/${device.name}-foyer-to-garage.png` });
    const walk = async (yaw, axis, target, greater) => {
      await page.evaluate(value => { const g = window.__wireTheHouse; g.player.yaw = value; g.input.keys.add('KeyW'); }, yaw);
      try {
        try { await page.waitForFunction(({ axis, target, greater }) => {
          const p = window.__wireTheHouse.player.camera.position;
          const v = axis === 'x' ? p.x : p.z;
          return greater ? v > target : v < target;
        }, { axis, target, greater }, { timeout: 6500, polling: 50 }); }
        catch (error) {
          const state = await page.evaluate(() => ({ position: window.__wireTheHouse.player.camera.position.toArray(),
            contacts: window.__wireTheHouse.player.collisionContacts }));
          throw new Error(`Walk to ${axis} ${target} stopped at ${JSON.stringify(state)}`, { cause: error });
        }
      } finally { await page.evaluate(() => window.__wireTheHouse.input.keys.delete('KeyW')); }
      await page.waitForTimeout(180);
      return page.evaluate(() => window.__wireTheHouse.player.camera.position.toArray());
    };
    const connector = await walk(0, 'z', 5.1, false);
    const garage = await walk(-Math.PI / 2, 'x', 11, true);
    await page.evaluate(() => { window.__wireTheHouse.player.yaw = 0; window.__wireTheHouse.player.pitch = -.09; });
    await page.waitForTimeout(100);
    await page.screenshot({ path: `${out}/${device.name}-inside-garage.png` });
    const bay = await walk(0, 'z', 0.2, false);
    await page.screenshot({ path: `${out}/${device.name}-unfinished-vehicle-bay.png` });
    const workshop = await walk(-Math.PI / 2, 'x', 16.4, true);
    await page.evaluate(() => { window.__wireTheHouse.player.yaw = Math.PI; window.__wireTheHouse.player.pitch = -.09; });
    await page.waitForTimeout(100);
    await page.screenshot({ path: `${out}/${device.name}-workshop.png` });
    await walk(Math.PI, 'z', 2.5, true);
    await page.evaluate(() => { const g = window.__wireTheHouse; g.player.yaw = Math.PI / 2; g.input.keys.add('KeyW'); });
    await page.waitForTimeout(180);
    const firstContact = await page.evaluate(() => ({ x: window.__wireTheHouse.player.camera.position.x,
      contacts: window.__wireTheHouse.player.collisionContacts, yaw: window.__wireTheHouse.player.yaw,
      held: window.__wireTheHouse.input.keys.has('KeyW') }));
    await page.waitForTimeout(520);
    await page.evaluate(() => window.__wireTheHouse.input.keys.delete('KeyW'));
    const partitionContact = await page.evaluate(() => ({ x: window.__wireTheHouse.player.camera.position.x,
      contacts: window.__wireTheHouse.player.collisionContacts }));
    assert(partitionContact.x > 15.7 && partitionContact.contacts.includes('Garage workshop rough partition north pier'),
      `${device.name}: workshop partition did not stop the player: ${JSON.stringify({ firstContact, partitionContact })}`);
    await walk(0, 'z', .2, false);
    await walk(Math.PI / 2, 'x', 11, false);
    await walk(Math.PI, 'z', 5.1, true);
    const back = await walk(Math.PI / 2, 'x', 7.5, false);
    const foyer = await walk(Math.PI, 'z', 7.8, true);
    for (const position of [connector, garage, bay, workshop, back, foyer])
      assert(Math.abs(position[1] - eye) < .18, `${device.name}: route changed floor: ${position}`);
    report.cases.push({ device: device.name, connector, garage, bay, workshop, partitionContact, back, foyer });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
} finally {
  await browser.close();
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
