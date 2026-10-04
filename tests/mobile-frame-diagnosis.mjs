import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { routeBuildingDist } from './building-qa-utils.mjs';
import { blockPointerLock } from './browser-safety.mjs';
const { launchManagedBrowser, runManagedClient } = await import(pathToFileURL(path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'), 'skills/develop-web-game/scripts/browser_lifecycle.mjs')));
const stressOnly = process.argv.includes('--stress-only');
const pacingOnly = process.argv.includes('--pacing-only'), desktop = process.argv.includes('--desktop');
const out = `output/loading-35-recovery/${pacingOnly ? desktop ? 'desktop-pacing' : 'mobile-pacing' : stressOnly ? 'mobile-frame-stress' : 'mobile-frame-diagnosis'}`;
await mkdir(out, { recursive: true });
const report = { method: 'Intel Ultra 9 desktop Chrome. pacing=true explicitly reinstates the legacy CPU cooldown; pacing=false removes it. CPU throttling and touch emulation are controlled diagnostics, not Galaxy S23 Ultra performance proof.', desktop, cases: [], errors: [] };
const session = await launchManagedBrowser(chromium, { channel: 'chrome', headless: true, screenshotDir: out });
await runManagedClient(session, 240000, async () => {
  const browserCDP = await session.browser.newBrowserCDPSession();
  report.gpu = (await browserCDP.send('SystemInfo.getInfo')).gpu;
  await browserCDP.detach();
  for (const backend of ['webgpu', 'webgl']) {
    const context = await session.browser.newContext(desktop
      ? { viewport: { width: 1249, height: 1221 } }
      : { viewport: { width: 412, height: 915 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await routeBuildingDist(context); await blockPointerLock(context);
    const page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.message));
    await page.goto(`http://127.0.0.1:5365/Electrical-Game/${backend === 'webgl' ? '?renderer=webgl' : ''}`);
    await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 90000 });
    await page.locator('[data-apprentice-count="5"]')[desktop ? 'click' : 'tap']();
    await page.waitForFunction(() => !document.querySelector('#start-button').disabled);
    await page.locator('#start-button')[desktop ? 'click' : 'tap']();
    await page.evaluate(() => {
      const g = window.__wireTheHouse, r = g.renderer;
      window.frameProbe = { active: false, methods: {}, frames: [], work: [], pacing: true };
      const wrap = (object, key, label) => {
        if (typeof object?.[key] !== 'function') return;
        const original = object[key]; object[key] = function (...args) {
          const at = performance.now(); try { return original.apply(this, args); }
          finally { if (window.frameProbe.active) (window.frameProbe.methods[label] ??= []).push(performance.now() - at); }
        };
      };
      for (const [object, key, label] of [[g, 'step', 'whole-step'], [g.room, 'update', 'room'], [g.player, 'update', 'player'],
        [g.apprentice, 'update', 'apprentices'], [g.workerBody, 'update', 'worker-body'], [g.fpsRig, 'update', 'fps-rig'],
        [g.mixing, 'update', 'mixing'], [g.mortar, 'update', 'mortar'], [g.workSurfaces, 'frontForBounds', 'work-surface'],
        [r, 'render', 'renderer-submit']]) wrap(object, key, label);
      const render = r.gpu.render;
      r.gpu.render = function (...args) {
        const main = args[0] === r.scene && args[1] === r.renderCamera && !this.getRenderTarget();
        const at = performance.now(); try { return render.apply(this, args); }
        finally { if (main && window.frameProbe.active) window.frameProbe.frames.push({ at, calls: r.webgl.info.render.calls, triangles: r.webgl.info.render.triangles }); }
      };
      const loop = g.loop;
      g.loop = function (time) {
        const at = performance.now(); loop(time);
        // Explicitly reproduce the legacy policy even after production removes
        // it, so rerunning this diagnostic still compares distinct schedules.
        if (!window.frameProbe.pacing) g.nextGameFrameAt = 0;
        else if (g.lastTime === time) {
          const workMs = performance.now() - at;
          g.nextGameFrameAt = performance.now() + (workMs > 32 ? Math.min(18, workMs - 24) : 0);
        }
      };
    });
    const cdp = await context.newCDPSession(page);
    for (const cpuRate of pacingOnly ? [1] : stressOnly ? [4] : [1, 4]) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
      for (const [round, pacing] of (cpuRate === 1 && !pacingOnly ? [true] : [true, false, false, true]).entries()) {
        for (const count of cpuRate === 1 && !pacingOnly ? [0, 1, 5] : [1]) {
          await page.evaluate(count => window.__wireTheHouse.apprentice.prepareCrew(count), count);
          for (const scene of cpuRate === 1 ? ['passage', 'foyer', 'courtyard'] : ['passage']) {
            await page.evaluate(({ scene, pacing }) => {
              const g = window.__wireTheHouse, p = window.frameProbe; p.active = false; p.pacing = pacing;
              const positions = { passage: [0, 1.65, 5.2], foyer: [12, 1.65, 14.4], courtyard: [15.3, 1.65, 14.3] };
              g.player.camera.position.fromArray(positions[scene]); g.player.yaw = Math.PI; g.player.pitch = -.08;
              p.methods = {}; p.frames = [];
            }, { scene, pacing });
            await page.waitForTimeout(pacingOnly ? 3000 : 1000);
            const data = await page.evaluate(async () => {
              const p = window.frameProbe, g = window.__wireTheHouse; p.active = true;
              const start = performance.now();
              // Collect enough submitted images even under low FPS; a fixed
              // short interval alone can leave too few frames for comparison.
              while ((performance.now() - start < 3000 || p.frames.length < 32) && performance.now() - start < 10000) {
                await new Promise(requestAnimationFrame); g.player.yaw = Math.PI + Math.sin((performance.now() - start) / 700) * .4;
              }
              p.active = false;
              const stats = values => { const v = values.toSorted((a, b) => a - b); return { n: v.length, mean: v.reduce((a, b) => a + b, 0) / Math.max(1, v.length), p95: v[Math.floor(v.length * .95)] ?? null, max: v.at(-1) ?? null }; };
              const intervals = p.frames.slice(1).map((frame, index) => frame.at - p.frames[index].at);
              return { frames: stats(intervals), fps: intervals.length * 1000 / intervals.reduce((a, b) => a + b, 0),
                cpu: Object.fromEntries(Object.entries(p.methods).map(([key, values]) => [key, stats(values)])),
                draws: stats(p.frames.map(frame => frame.calls)), triangles: stats(p.frames.map(frame => frame.triangles)),
                canvas: [g.renderer.webgl.domElement.width, g.renderer.webgl.domElement.height],
                graphics: g.renderer.lifecycleTelemetry, heapMiB: performance.memory?.usedJSHeapSize / 1048576 };
            });
            assert(data.frames.n > 15); assert.equal(data.graphics.graphicsFault, false); assert.deepEqual(data.graphics.graphicsErrors, []);
            report.cases.push({ backend, cpuRate, pacing, round, count, scene, ...data });
            console.log(JSON.stringify({ backend, cpuRate, pacing, round, count, scene, fps: Math.round(data.fps), frameP95: data.frames.p95,
              topCPU: Object.entries(data.cpu).sort((a, b) => b[1].mean - a[1].mean).slice(0, 4).map(([name, value]) => [name, +value.mean.toFixed(2)]) }));
            await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
          }
        }
      }
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await page.screenshot({ path: `${out}/${backend}-stress-passage.png` });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
});
