import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { routeBuildingDist } from './building-qa-utils.mjs';
import { blockPointerLock } from './browser-safety.mjs';

const { launchManagedBrowser, runManagedClient } = await import(pathToFileURL(path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'), 'skills/develop-web-game/scripts/browser_lifecycle.mjs')));
const baseline = process.argv.includes('--baseline'), faults = process.argv.includes('--faults');
const base = 'http://127.0.0.1:5365/Electrical-Game/';
const treeURL = `${base}assets/vegetation/courtyard-tree/courtyard-tree-optimized.glb*`;
const out = `output/loading-35-recovery/${baseline ? 'before' : faults ? 'faults' : 'after'}`;
await mkdir(out, { recursive: true });
const report = { baseline, delivery: 'Compiled files routed only in the owned browser on the unchanged port-5365 origin', cases: [] };
const session = await launchManagedBrowser(chromium, { channel: 'chrome', headless: true, screenshotDir: out });
const percentile = (values, p) => values.toSorted((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))] ?? null;
async function fixture(viewport = { width: 1249, height: 1221 }) {
  const context = await session.browser.newContext({ viewport, isMobile: viewport.width < 600, hasTouch: viewport.width < 600 });
  await routeBuildingDist(context, resolve(baseline ? 'output/loading-35-recovery/baseline-dist' : 'dist'));
  await blockPointerLock(context);
  await context.addInitScript(() => {
    window.loadingProbe = { stages: [], longTasks: [], errors: [], abortedTreeRequests: 0 };
    new MutationObserver(() => {
      const value = document.querySelector('#start-load-percent')?.textContent, probe = window.loadingProbe;
      if (value && probe.stages.at(-1)?.value !== value) probe.stages.push({ value, ms: performance.now(), heap: performance.memory?.usedJSHeapSize ?? null });
    }).observe(document, { childList: true, subtree: true, characterData: true });
    try { new PerformanceObserver(list => {
      for (const entry of list.getEntries()) window.loadingProbe.longTasks.push({ ms: entry.startTime, duration: entry.duration });
    }).observe({ type: 'longtask', buffered: true }); } catch {}
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => { if (request.url().includes('courtyard-tree-optimized.glb')) report.abortedTreeRequests = (report.abortedTreeRequests ?? 0) + 1; });
  return { context, page, errors };
}
async function ready(page) { await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 90000 }); }
async function failed(page) {
  await page.waitForFunction(() => document.querySelector('#start-button-label')?.textContent === 'RETRY LOADING', null, { timeout: 45000 });
  return page.evaluate(() => ({ label: document.querySelector('#start-button-label').textContent,
    percent: document.querySelector('#start-load-percent').textContent, disabled: document.querySelector('#start-button').disabled,
    detail: document.querySelector('#start-load-error').textContent, detailVisible: !document.querySelector('#start-load-error').hidden,
    started: !!window.__wireTheHouse?.started, stages: window.loadingProbe.stages }));
}
await runManagedClient(session, 360000, async () => {
  if (!faults) for (const backend of ['webgpu', 'webgl']) {
    const { context, page, errors } = await fixture();
    await page.goto(base + (backend === 'webgl' ? '?renderer=webgl' : ''), { waitUntil: 'domcontentloaded' });
    await ready(page);
    const loaded = await page.evaluate(() => {
      const g = window.__wireTheHouse, r = g.renderer, b = r.gpu.backend, gl = b.gl;
      const debug = gl?.getExtension('WEBGL_debug_renderer_info');
      return { probe: window.loadingProbe, ua: navigator.userAgent, actualBackend: b.isWebGLBackend ? 'webgl' : 'webgpu',
        gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : b.device?.adapterInfo,
        resourceMemory: r.webgl.info.memory, graphics: r.lifecycleTelemetry,
        tree: { ready: g.room.mansionWing.courtyard.tree.userData.scannedReady, triangles: g.room.mansionWing.courtyard.tree.userData.scannedTriangles },
        start: { position: g.player.camera.position.toArray(), yaw: g.player.yaw, pitch: g.player.pitch, tool: g.selectedTool },
        viewport: { width: innerWidth, height: innerHeight }, canvas: [r.webgl.domElement.width, r.webgl.domElement.height] };
    });
    assert.equal(loaded.actualBackend, backend, 'Requested API must run without a silent fallback');
    assert.equal(loaded.tree.ready, true); assert.equal(loaded.tree.triangles, 131515);
    assert.deepEqual(loaded.start, { position: [0, 1.65, 5.2], yaw: Math.PI, pitch: -.08, tool: 'spray' });
    await page.screenshot({ path: `${out}/${backend}-menu.png` });
    await page.locator('#start-button').click();
    const turn = await page.evaluate(async () => {
      const g = window.__wireTheHouse, r = g.renderer, programsBefore = r.webgl.info.memory.programs, frames = [], start = performance.now();
      let previous = start;
      while (performance.now() - start < 4000) {
        await new Promise(requestAnimationFrame);
        const now = performance.now(); frames.push(now - previous); previous = now;
        g.player.yaw = Math.PI + Math.PI * Math.min(1, (now - start) / 2000);
      }
      await r.waitForFrame();
      return { frames, programsBefore, programsAfter: r.webgl.info.memory.programs, graphics: r.lifecycleTelemetry, renderError: r.renderError,
        state: JSON.parse(window.render_game_to_text()) };
    });
    assert(turn.frames.length > 30);
    if (!baseline) {
      // Historical baseline submits one additional shader at Start. Prefer
      // the locally recorded comparison when present; fresh checkouts retain
      // the same measured bound without requiring ignored output artifacts.
      let allowedAdditionalPrograms = 1;
      try {
        const before = JSON.parse(await readFile('output/loading-35-recovery/before/report.json', 'utf8')).cases.find(test => test.name === backend);
        allowedAdditionalPrograms = before.programs[1] - before.programs[0];
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      assert(turn.programsAfter - turn.programsBefore <= allowedAdditionalPrograms, 'Correction must not add first-turn shader work beyond the unchanged baseline');
    }
    assert.equal(turn.renderError, ''); assert.equal(turn.graphics.graphicsFault, false); assert.equal(turn.graphics.deviceLost, false);
    assert.deepEqual(turn.graphics.graphicsErrors, []); assert.deepEqual(errors, []);
    await page.screenshot({ path: `${out}/${backend}-first-turn.png` });
    report.cases.push({ name: backend, loaded, frameMs: { count: turn.frames.length, p95: percentile(turn.frames, .95), max: Math.max(...turn.frames) },
      programs: [turn.programsBefore, turn.programsAfter], graphics: turn.graphics, pageErrors: errors });
    console.log(JSON.stringify({ backend, readyMs: loaded.probe.stages.at(-1).ms, frameP95: percentile(turn.frames, .95), graphicsErrors: turn.graphics.graphicsErrors }));
    await context.close();
  }
  if (faults) {
    for (const scenario of ['transient-network', 'pending-network', 'pending-decoder', 'missing-tree-part']) {
      const { context, page, errors } = await fixture(scenario === 'missing-tree-part' ? { width: 430, height: 932 } : undefined);
      let attempts = 0, decoderRequests = 0;
      await context.route(treeURL, async route => {
        attempts++;
        if (scenario === 'transient-network' && attempts <= 2) return route.abort('failed');
        if (scenario === 'pending-network' && attempts === 1) return;
        if (scenario === 'pending-network' && attempts <= 3) return route.abort('failed');
        if (scenario === 'missing-tree-part' && attempts <= 3) {
          const original = await readFile('dist/assets/vegetation/courtyard-tree/courtyard-tree-optimized.glb');
          const corrupted = Buffer.from(original.toString('latin1').replaceAll('courtyard_tree_leaves', 'courtyard_tree_absent'), 'latin1');
          assert.notDeepEqual(corrupted, original);
          return route.fulfill({ status: 200, contentType: 'model/gltf-binary', body: corrupted });
        }
        return route.fallback();
      });
      if (scenario === 'pending-decoder') await context.route(`${base}assets/draco/draco_wasm_wrapper.js*`, route => {
        decoderRequests++;
        return decoderRequests === 1 ? undefined : route.fallback();
      });
      await page.goto(base + '?renderer=webgl', { waitUntil: 'domcontentloaded' });
      if (scenario === 'pending-network' || scenario === 'pending-decoder') {
        await page.waitForFunction(() => document.querySelector('#start-load-percent')?.textContent === '35%', null, { timeout: 30000 });
        await page.screenshot({ path: `${out}/${scenario}-35.png` });
      }
      if (scenario === 'transient-network' || scenario === 'pending-decoder') {
        await ready(page);
        assert.equal(attempts, scenario === 'transient-network' ? 3 : 2);
        if (scenario === 'pending-decoder') assert.equal(decoderRequests, 2);
        const tree = await page.evaluate(() => window.__wireTheHouse.room.mansionWing.courtyard.tree.userData);
        assert.equal(tree.scannedReady, true); assert.equal(tree.scannedTriangles, 131515);
        report.cases.push({ name: scenario, attempts, decoderRequests, recovered: true, tree });
      } else {
        const failure = await failed(page);
        assert.equal(attempts, 3); assert.equal(failure.disabled, false); assert.equal(failure.percent, 'LOAD FAILED');
        assert(failure.detailVisible && failure.detail.includes('Courtyard tree')); assert.equal(failure.started, false);
        if (scenario === 'pending-network') assert(failure.stages.some(stage => stage.value === '35%'));
        await page.screenshot({ path: `${out}/${scenario}-failure.png` });
        await Promise.all([page.waitForEvent('domcontentloaded'), page.locator('#start-button').click()]);
        await ready(page);
        assert.equal(attempts, 4);
        assert.equal(await page.evaluate(() => window.__wireTheHouse.started), false, 'Retry returns to the prepared menu');
        await page.locator('#start-button').click();
        assert.equal(await page.evaluate(() => window.__wireTheHouse.started), true);
        report.cases.push({ name: scenario, attemptsBeforeRetry: 3, failure, manualRetryRecovered: true });
      }
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `${out}/${scenario}-recovered.png` });
      console.log(JSON.stringify({ scenario, attempts, decoderRequests, pageErrors: errors }));
      await context.close();
      await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
    }
  }
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
});
