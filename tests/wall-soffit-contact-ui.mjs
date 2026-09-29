import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';
import { routeBuildingDist } from './building-qa-utils.mjs';

const phase = process.env.QA_PHASE ?? 'after';
const output = `output/wall-soffit-gap/${phase}`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { phase, contacts: [], errors: [], captures: [] };
try {
  const context = await browser.newContext({ viewport: { width: 1365, height: 768 }, deviceScaleFactor: 1 });
  await blockPointerLock(context);
  await routeBuildingDist(context);
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&renderer=webgl');
  await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 120000 });
  await page.locator('#apprentice-count').selectOption('0');
  await page.locator('#start-button').click();
  await page.locator('#start-screen').waitFor({ state: 'hidden' });
  const contacts = await page.evaluate(() => {
    const game = window.__wireTheHouse;
    game.step = () => {};
    game.player.update = () => {};
    game.room.updateWorldMatrix(true, true);
    const Box = game.pvc.targetGuideBounds.constructor;
    const pairs = [
      ['Foyer west fired-clay partition', 'Ground foyer slab cast concrete soffit'],
      ['L1 east wing outer middle pier', 'L2 east courtyard wing floor and L1 roof'],
    ];
    return pairs.map(([wallName, roofName]) => {
      const wall = game.room.mansionWing.editableWalls.get(wallName);
      const roof = game.room.mansionWing.getObjectByName(roofName);
      if (!wall || !roof) throw new Error(`Missing contact: ${wallName} / ${roofName}`);
      const wallBox = new Box().setFromObject(wall);
      const roofBox = new Box().setFromObject(roof);
      return { wallName, roofName, wallTop: wallBox.max.y, roofBottom: roofBox.min.y, roofTop: roofBox.max.y,
        gapM: roofBox.min.y - wallBox.max.y,
        overlapXZ: Math.min(wallBox.max.x, roofBox.max.x) - Math.max(wallBox.min.x, roofBox.min.x) > 0 &&
          Math.min(wallBox.max.z, roofBox.max.z) - Math.max(wallBox.min.z, roofBox.min.z) > 0 };
    });
  });
  report.contacts = contacts;
  const views = [
    { name: 'foyer-wall-head', eye: [1.25, 1.65, 11.6], target: [-1.35, 3.05, 11.0] },
    { name: 'east-wing-wall-head', eye: [19.5, 4.95, 9.9], target: [21.1, 6.4, 10.5] },
  ];
  for (const view of views) {
    const render = await page.evaluate(async ({ eye, target }) => {
      const game = window.__wireTheHouse;
      const camera = game.renderer.camera;
      game.fpsRig.visible = false;
      game.workerBody.visible = false;
      camera.position.set(...eye);
      camera.lookAt(...target);
      camera.updateMatrixWorld(true);
      await game.renderer.render();
      await game.renderer.waitForFrame();
      return { calls: game.renderer.webgl.info.render.calls, triangles: game.renderer.webgl.info.render.triangles,
        renderError: game.renderer.renderError };
    }, view);
    const capture = `${output}/${view.name}.png`;
    await page.screenshot({ path: capture });
    report.captures.push({ view: view.name, path: capture, render });
  }
  await context.close();
} finally {
  await browser.close();
}
await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
assert.deepEqual(report.errors, []);
assert(report.contacts.every(contact => contact.overlapXZ));
assert(Math.abs(report.contacts[1].roofTop - 6.6) < .001, 'Walkable L2 floor height changed');
assert(report.captures.every(capture => capture.render.renderError === ''));
assert(report.contacts.every(contact => contact.gapM <= -.005), `Wall heads are open: ${JSON.stringify(report.contacts)}`);
console.log(JSON.stringify(report));
