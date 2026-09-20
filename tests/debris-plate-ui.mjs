import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { blockPointerLock } from './browser-safety.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5365/Electrical-Game/';
const out = process.argv[3] ?? 'output/debris-plate-ui';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { url, fixture: 'Deterministic field fixture: actual 35-degree MasonryVolume impacts feed the real ChasingSystem; camera and clock controlled for close wall/release/floor inspection. Native hammer controls are covered separately. No fragment scaling, resizing or relocation. Water Pro remains enabled. Mobile is browser emulation.', cases: [] };
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 768 }, isMobile: mobile, hasTouch: mobile });
    await blockPointerLock(context);
    await context.addInitScript(() => {
      const random = crypto.getRandomValues.bind(crypto);
      crypto.getRandomValues = array => array instanceof Uint32Array && array.length === 1 ? (array[0] = 193187, array) : random(array);
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => window.__wireTheHouse?.roomWater.waterProActive);
    await page.locator('#start-button').click();
    await page.evaluate(async () => {
      const g = window.__wireTheHouse, w = g.room.brickWall;
      await g.renderer.waitForFrame();
      g.step = () => {}; g.fpsRig.visible = false;
      const angle = 35 * Math.PI / 180, direction = { x: 0, y: -Math.sin(angle), z: -Math.cos(angle) };
      window.__platePieces = [];
      for (let blow = 0; blow < 16; blow++) {
        const entry = { x: .72 + blow * .006, y: 1.55, z: w.volume.frontZ };
        const origin = { x: entry.x, y: entry.y - direction.y * .3, z: entry.z - direction.z * .3 };
        const hit = w.volume.raycast(origin, direction, .65); if (!hit) continue;
        const result = w.volume.impact({ point: hit.point, direction, edge: { x: 1, y: 0, z: 0 }, energyJ: 4, widthM: .05, chisel: 'flat' });
        window.__platePieces.push(...result.fragments.map(f => ({ volume: f.volume, dimensions: [f.size.x, f.size.y, f.size.z].sort((a, b) => b - a) })));
        g.chasing.spawnDebris(result);
        for (let i = 0; i < 5; i++) g.chasing.update(1 / 60);
      }
      w.flushGeometry(); await w.waitForGeometry();
      g.renderer.camera.position.set(.77, 1.55, -1.9); g.renderer.camera.lookAt(.77, 1.5, w.volume.frontZ);
      g.renderer.render(); await g.renderer.waitForFrame();
    });
    const platform = mobile ? 'mobile' : 'desktop';
    await page.screenshot({ path: `${out}/${platform}-wall-release.png` });
    const state = await page.evaluate(async () => {
      const g = window.__wireTheHouse;
      for (let i = 0; i < 300; i++) g.chasing.update(1 / 60);
      g.renderer.camera.position.set(.77, .85, -1.05); g.renderer.camera.lookAt(.77, .035, -1.95);
      g.renderer.render(); await g.renderer.waitForFrame();
      const fragments = g.chasing.particles.map(p => ({ volume: p.mesh.userData.volume, dimensions: [p.halfWidth * 2, p.halfHeight * 2, p.halfDepth * 2].sort((a, b) => b - a), actual: p.mesh.userData.actualFractureGeometry, scale: p.mesh.scale.toArray(), settled: p.settled, wallSupported: p.wallSupported, position: p.mesh.position.toArray() }));
      return { pieces: window.__platePieces, fragments, emitted: g.chasing.totalEmittedVolume, retired: g.chasing.totalRetiredVolume, active: g.chasing.activeFragmentVolume, unsupported: g.chasing.unsupportedSettledFragmentCount, overlap: g.chasing.settledOverlapCount, maximumUpdateMs: g.chasing.maximumUpdateMs, renderError: g.renderer.renderError, pointerLocked: Boolean(document.pointerLockElement) };
    });
    await page.screenshot({ path: `${out}/${platform}-floor-rubble.png` });
    await page.evaluate(async () => {
      const r = window.__wireTheHouse.renderer;
      r.camera.position.set(.74, .35, -1.4); r.camera.lookAt(.74, .03, -1.81);
      r.render(); await r.waitForFrame();
    });
    await page.screenshot({ path: `${out}/${platform}-floor-close.png` });
    const substantial = piece => piece.dimensions[0] >= .055 && piece.dimensions[1] >= .035 && piece.volume >= .000045;
    const largeFloor = state.fragments.filter(p => substantial(p) && p.settled && !p.wallSupported && p.position[2] > -2.41);
    report.cases.push({ platform, errors, largeEmitted: state.pieces.filter(substantial).length, largeFloor: largeFloor.length, state });
    assert(largeFloor.length >= 2, 'Repeated real shell releases must leave substantial visible pieces on the floor');
    assert(state.fragments.every(p => p.actual && p.scale.every(v => v === 1)), 'Visible debris must retain unscaled actual removed geometry');
    assert(Math.abs(state.emitted - state.retired - state.active) < 1e-10, 'Visible/retired debris must preserve the exact volume ledger');
    assert.equal(state.unsupported, 0); assert.equal(state.overlap, 0);
    assert.equal(state.pointerLocked, false); assert.equal(state.renderError, ''); assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(JSON.stringify(report.cases.map(c => ({ platform: c.platform, largeEmitted: c.largeEmitted, largeFloor: c.largeFloor, errors: c.errors })), null, 2));
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
