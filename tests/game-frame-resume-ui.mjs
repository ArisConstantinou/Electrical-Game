import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { routeBuildingDist } from './building-qa-utils.mjs';
import { blockPointerLock } from './browser-safety.mjs';
const { launchManagedBrowser, runManagedClient } = await import(pathToFileURL(path.join(
  process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'), 'skills/develop-web-game/scripts/browser_lifecycle.mjs')).href);
const out = 'output/game-frame-resume'; await mkdir(out, { recursive: true });
const report = { environment: 'Chrome portrait touch emulation; explicit freeze/resume events; not a physical phone lock', cases: [], errors: [] };
const session = await launchManagedBrowser(chromium, { channel: 'chrome', headless: true, screenshotDir: out });
try {
  await runManagedClient(session, 210000, async () => {
    for (const backend of ['webgl', 'webgpu']) {
      const context = await session.browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      await routeBuildingDist(context); await blockPointerLock(context);
      const page = await context.newPage(); page.on('pageerror', e => report.errors.push(e.message));
      await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=' + backend);
      await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart && !document.querySelector('#start-button')?.disabled, null, { timeout: 120000 });
      await page.locator('#apprentice-count').selectOption('0'); await page.locator('#start-button').tap();
      await page.evaluate(async () => {
        const g = window.__wireTheHouse;
        g.selectTool('hose'); g.player.camera.position.set(0, 1.65, 2); g.player.yaw = 0; g.player.pitch = .3;
        g.roomWater.addFloorWater(0, 0, 12); g.roomWater.rebuildGeometry(); await g.activateWaterPro();
        window.__frameResume = { frames: 0, objects: [g.renderer.scene, g.roomWater.field, g.mortar, g.mission] };
        const render = g.renderer.render; g.renderer.render = function (...args) {
          const accepted = render.apply(this, args); if (accepted) window.__frameResume.frames++; return accepted;
        };
      });
      await page.waitForFunction(() => window.__frameResume.frames >= 3);
      const state = () => page.evaluate(() => {
        const g = window.__wireTheHouse;
        return { frames: window.__frameResume.frames, held: g.input.actionHeld, emitted: g.mortar.waterGunLitres,
          camera: g.player.camera.position.toArray(), paused: g.lifecyclePaused, keys: [...g.input.keys],
          move: g.input.mobileMove, look: g.input.mobileLook, error: g.renderer.renderError,
          sameObjects: [g.renderer.scene, g.roomWater.field, g.mortar, g.mission].every((o, i) => o === window.__frameResume.objects[i]),
          pointerLocked: !!document.pointerLockElement };
      });
      // Current mobile controls start/stop continuous work with a quick AIM tap.
      await page.locator('#look-joystick').tap(); await page.waitForTimeout(300);
      const before = await state(); assert(before.held && before.emitted > 0, 'Native touch must actually start the hose');
      const frozenEmission = await page.evaluate(() => {
        document.dispatchEvent(new Event('freeze')); return window.__wireTheHouse.mortar.waterGunLitres;
      });
      const cdp = await context.newCDPSession(page);
      await cdp.send('Page.setWebLifecycleState', { state: 'frozen' }); await page.waitForTimeout(350);
      await cdp.send('Page.setWebLifecycleState', { state: 'active' });
      await page.evaluate(() => document.dispatchEvent(new Event('resume')));
      await page.waitForFunction(frames => window.__frameResume.frames > frames + 5, before.frames, { timeout: 20000 });
      await page.waitForTimeout(300); const after = await state();
      assert(!after.held && !after.paused && after.sameObjects && !after.pointerLocked);
      assert.equal(after.emitted, frozenEmission, 'Resume must not emit missed or held hose work');
      assert.deepEqual(after.keys, []); assert.deepEqual(after.move, { x: 0, y: 0 }); assert.deepEqual(after.look, { x: 0, y: 0 });
      assert(after.camera.every((n, i) => Math.abs(n - before.camera[i]) < 1e-6)); assert.equal(after.error, '');
      await page.locator('#look-joystick').tap(); await page.waitForTimeout(300);
      const restarted = await state(); assert(restarted.held && restarted.emitted > after.emitted, 'New input must work after resume');
      await page.locator('#look-joystick').tap(); await page.waitForTimeout(100); assert(!(await state()).held);
      await page.screenshot({ path: `${out}/${backend}-resumed.png` });
      report.cases.push({ backend, before, after, restarted }); await context.close();
    }
    assert.deepEqual(report.errors, []); report.passed = true;
  });
} finally { await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); }
console.log(JSON.stringify({ passed: report.passed, backends: report.cases.map(c => c.backend), checks: ['native touch hose', 'freeze/resume', 'no input or emission backlog', 'scene preservation', 'subsequent input'] }));
