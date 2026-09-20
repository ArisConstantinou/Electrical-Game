import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const out = resolve(process.argv[3] ?? 'output/masonry-physical-cracks');
const url = process.argv[2] ?? 'http://127.0.0.1:5365/Electrical-Game/';
await mkdir(out, { recursive: true });
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const report = { url, checks: [], viewports: [], errors: [] };
try {
  const { MasonryVolume, MaterialId } = await server.ssrLoadModule('/src/world/MasonryVolume.ts');
  const volume = new MasonryVolume({ seed: 193187 });
  let opened = 0, weakestOnly = 0;
  const ms = [];
  for (let i = 0; i < 35; i++) {
    const hit = volume.raycast({ x: .8 + Math.sin(i) * .017, y: 1.55 + Math.cos(i) * .017, z: -2 }, { x: 0, y: 0, z: -1 }, .8);
    if (!hit) continue;
    const result = volume.impact({ point: hit.point, direction: { x: 0, y: 0, z: -1 }, edge: { x: 1, y: 0, z: 0 }, chisel: 'flat', energyJ: 4 });
    ms.push(result.stats.milliseconds);
    if (!result.removedNodes) { weakestOnly++; assert.equal(result.cracks.length, 0, 'Weakness alone cannot produce a visible line'); }
    for (const crack of result.cracks) {
      opened++;
      assert(result.removedVolume > 0 && result.fragments.length, 'Opening must remove real mass into actual fragments');
      const [a, b] = crack.points;
      for (const t of [0, .25, .5, .75, 1]) {
        const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
        assert.equal(volume.sampleMaterial(p.x, p.y, p.z), MaterialId.Air, 'The entire fissure path must be a true material opening');
        assert(volume.cavityBox(p, p).clear, 'Placement collision must agree with the actual opening');
      }
      assert(volume.raycast(a, { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }, Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) * .99) === null, 'Chisel must pass through the same open fissure');
    }
  }
  assert(opened > 0 && weakestOnly > 0, 'Fixture must exercise accumulated weakness and actual fissure opening');
  const restored = new MasonryVolume({ seed: 193187 }); restored.restore(volume.serialize());
  assert.deepEqual(restored.serialize(), volume.serialize(), 'Physical cracks persist through the ordinary volume save');
  report.checks.push({ openedFissureNodes: opened, weaknessOnlyImpacts: weakestOnly, removedVolumeCm3: volume.removedVolume * 1e6, meanImpactMs: ms.reduce((a, b) => a + b, 0) / ms.length, worstImpactMs: Math.max(...ms) });
} finally { await server.close(); }

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    const mobile = viewport.width < 500;
    const page = await browser.newPage({ viewport, isMobile: mobile, hasTouch: mobile });
    page.on('pageerror', e => report.errors.push(e.message));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.click('#start-button');
    await page.keyboard.press('Digit4');
    for (let i = 0; i < 35; i++) {
      await page.evaluate(i => {
        const g = window.__wireTheHouse, x = .8 + Math.sin(i) * .017, y = 1.55 + Math.cos(i) * .017;
        g.renderer.camera.position.set(x + .16, g.player.eyeHeight, -1.45);
        g.renderer.camera.lookAt(x, y, -2.41);
        g.player.yaw = g.renderer.camera.rotation.y; g.player.pitch = g.renderer.camera.rotation.x;
        g.step(0);
      }, i);
      await page.keyboard.down('KeyE');
      await page.evaluate(() => window.advanceTime(30));
      await page.keyboard.up('KeyE');
      await page.evaluate(() => window.advanceTime(300));
    }
    await page.evaluate(async () => { await window.__wireTheHouse.room.brickWall.waitForGeometry(); });
    const state = await page.evaluate(() => {
      const w = window.__wireTheHouse.room.brickWall;
      return { telemetry: w.telemetry, overlayNames: w.children.filter(c => /material cracks|crack overlay/i.test(c.name)).map(c => c.name) };
    });
    assert(state.telemetry.removedNodes > 0, 'Real hammer inputs must remove visible material');
    assert.equal(state.telemetry.fractureRendering, 'removed-material-surfaces');
    assert.equal(state.telemetry.fractureSegments, 0);
    assert.deepEqual(state.overlayNames, []);
    await page.screenshot({ path: join(out, `${mobile ? 'mobile' : 'desktop'}-gameplay.png`) });
    const inspection = await page.evaluate(() => {
      const g = window.__wireTheHouse, camera = g.renderer.camera.clone(false);
      camera.position.set(1.02, 1.65, -2.0); camera.lookAt(.8, 1.55, -2.45);
      camera.near = .008; camera.fov = 45; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
      // An inspection view excludes only the camera-relative tools; masonry stays identical.
      const visible = g.fpsRig.visible;
      try { g.fpsRig.visible = false; g.renderer.webgl.render(g.renderer.scene, camera); return g.renderer.webgl.domElement.toDataURL('image/png'); }
      finally { g.fpsRig.visible = visible; }
    });
    await writeFile(join(out, `${mobile ? 'mobile' : 'desktop'}-fracture-close.png`), Buffer.from(inspection.split(',')[1], 'base64'));
    report.viewports.push({ ...viewport, diagnosticMobileViewport: mobile, ...state });
    await page.close();
  }
} finally { await browser.close(); }
assert.deepEqual(report.errors, []);
await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
