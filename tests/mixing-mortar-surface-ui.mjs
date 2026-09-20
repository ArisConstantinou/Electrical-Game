import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { blockPointerLock } from './browser-safety.mjs';

const url = process.argv.find(arg => /^https?:/.test(arg)) ?? 'http://127.0.0.1:5365/Electrical-Game/';
const out = 'output/mixing-mortar-surface';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { url, mobileIsEmulation: true, cases: [], errors: [] };
try {
  for (const layout of [{ name: 'desktop', width: 1366, height: 768 }, { name: 'mobile', width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport: layout, isMobile: layout.name === 'mobile', hasTouch: layout.name === 'mobile' });
    await blockPointerLock(context);
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => window.__wireTheHouse?.mixing, undefined, { timeout: 120000 });
    await page.locator('#start-button').click();
    const result = await page.evaluate(async () => {
      const g = window.__wireTheHouse, m = g.mixing, b = m.batch;
      g.step = () => {};
      b.addWater(20 / 3); m.present();
      const fill = m.models.fill;
      const heights = () => {
        const p = fill.geometry.getAttribute('position');
        return Array.from({ length: p.count }, (_, i) => p.getZ(i) * fill.scale.x);
      };
      const water = heights();
      b.openSack(0);
      for (let i = 0; i < 6; i++) { b.scoopCement(0); b.pour('trowel'); }
      for (let i = 0; i < 12; i++) { b.scoopSand(); b.pour('shovel'); }
      b.mix(120); m.present();
      const ready = heights();
      m.elapsed += 10; m.present();
      const later = heights();
      const camera = g.renderer.camera, bucket = m.models.bucket.getWorldPosition(camera.position.clone());
      camera.position.set(bucket.x, bucket.y + .99, bucket.z - .36);
      camera.lookAt(bucket.x, bucket.y + .20, bucket.z); camera.updateMatrixWorld(true);
      await g.renderer.waitForFrame(); g.renderer.render(); await g.renderer.waitForFrame();
      return { ready: b.ready, waterRange: Math.max(...water) - Math.min(...water), mortarRange: Math.max(...ready) - Math.min(...ready),
        retainedAtRest: ready.every((v, i) => v === later[i]), roughness: fill.material.roughness, bumpScale: fill.material.bumpScale,
        highest: fill.position.y + Math.max(...ready), rim: .313, renderError: g.renderer.renderError,
        overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert(result.ready, 'The complete recipe reached ready mortar');
    assert(result.waterRange < .00001, 'Water alone remains level at rest');
    assert(result.mortarRange > .009, 'Ready mortar retains visible centimetre-scale relief');
    assert(result.retainedAtRest, 'Paddle furrows persist after the motor stops');
    assert(result.roughness >= .9 && result.bumpScale > .001, 'Mortar is matte and granular');
    assert(result.highest < result.rim, 'Relief stays inside the bucket');
    assert.equal(result.renderError, ''); assert.equal(result.overflow, false);
    await page.screenshot({ path: `${out}/${layout.name}-ready.png` });
    report.cases.push({ layout: layout.name, ...result });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report));
