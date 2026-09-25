import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5365/Electrical-Game/?mansion=preview&renderer=webgl';
const out = process.argv[3] ?? 'output/hammer-idle-framing';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
await blockPointerLock(context);
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const report = { url, cases: [], errors };
try {
  await page.goto(url);
  await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 120000 });
  await page.locator('#apprentice-count').selectOption('0');
  await page.locator('#start-button').click();
  await page.locator('#site-pro-desktop-tools [data-tool="hammer"]').click();
  await page.evaluate(() => {
    const g = window.__wireTheHouse, c = g.renderer.camera;
    // Repeat the reported close-wall, downward-looking idle view.
    c.position.set(15.3, 1.65, 15.33);
    c.rotation.set(-.6, Math.PI / 2, 0);
    c.updateMatrixWorld(true);
    g.player.yaw = Math.PI / 2;
    g.player.pitch = -.6;
  });
  for (const side of ['right', 'left']) {
    await page.locator(`#hammer-view-${side}`).click();
    const state = await page.evaluate(async () => {
      const g = window.__wireTheHouse, c = g.renderer.camera, rig = g.fpsRig;
      for (let i = 0; i < 30; i++) g.step(1 / 60);
      const hammer = rig.tools.get('hammer'), V = c.position.constructor;
      const motor = hammer.localToWorld(new V(.02, -.055, -.1));
      g.renderer.render();
      await g.renderer.waitForFrame();
      return {
        status: rig.contactStatus,
        motorEyeM: motor.distanceTo(c.position),
        motorScreenX: motor.clone().project(c).x,
        gripsReachable: rig.gripsReachable(c, hammer),
        drawCalls: g.renderer.webgl.info.render.calls,
        renderError: g.renderer.renderError,
      };
    });
    assert.equal(state.status, 'out-of-reach', `${side}: test must exercise idle stance`);
    assert(state.motorEyeM > .60, `${side}: motor crowds the eye (${state.motorEyeM.toFixed(3)} m)`);
    assert(state.motorScreenX * (side === 'right' ? 1 : -1) > .05, `${side}: motor covers the aiming center`);
    assert(state.gripsReachable, `${side}: a hand has lost its grip`);
    assert.equal(state.renderError, '');
    report.cases.push({ side, ...state });
    await page.screenshot({ path: `${out}/${side}.png` });
  }
  assert.deepEqual(errors, []);
  report.passed = true;
  console.log(JSON.stringify(report));
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
