import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { blockPointerLock } from '../tests/browser-safety.mjs';
import { routeBuildingDist } from '../tests/building-qa-utils.mjs';
const { launchManagedBrowser, runManagedClient } = await import(pathToFileURL(path.join(
  process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'), 'skills/develop-web-game/scripts/browser_lifecycle.mjs')).href);
const option = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const portrait = process.argv.includes('--portrait'), webgl = process.argv.includes('--webgl');
const label = option('--label') ?? 'published';
const dist = option('--dist');
const tool = option('--tool') ?? 'hammer';
const iphoneViewport = process.argv.includes('--iphone-viewport');
const out = path.resolve('output/stairs-performance', label + (portrait ? '-portrait' : '-desktop') + (webgl ? '-webgl' : '-webgpu'));
await mkdir(out, { recursive: true });
const report = { label, dist, environment: 'Windows Chrome headless; portrait is viewport emulation, not a physical phone',
  viewport: iphoneViewport ? { width: 430, height: 745 } : portrait ? { width: 390, height: 844 } : { width: 1366, height: 768 }, dpr: iphoneViewport ? 3 : portrait ? 2 : 1, cases: [], errors: [] };
const session = await launchManagedBrowser(chromium, { channel: 'chrome', headless: true, screenshotDir: out });
await runManagedClient(session, 210000, async () => {
  const context = await session.browser.newContext({ viewport: report.viewport, deviceScaleFactor: report.dpr, isMobile: portrait, hasTouch: portrait });
  await blockPointerLock(context);
  if (dist) await routeBuildingDist(context, path.resolve(dist));
  const page = await context.newPage();
  page.on('pageerror', e => report.errors.push(e.message));
  await page.addInitScript(() => {
    window.__stairLongTasks = [];
    new PerformanceObserver(list => window.__stairLongTasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration }))))
      .observe({ type: 'longtask', buffered: true });
  });
  const origin = dist ? 'http://127.0.0.1:5365' : 'https://arisconstantinou.github.io';
  const started = Date.now();
  await page.goto(`${origin}/Electrical-Game/${webgl ? '?renderer=webgl' : ''}`);
  await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart && !document.querySelector('#start-button')?.disabled, null, { timeout: 120000 });
  report.readyMs = Date.now() - started;
  await page.locator('#apprentice-count').selectOption(option('--apprentices') ?? '5');
  await page.locator('#start-button').click();
  report.assetTransforms = await page.evaluate(async () => {
    const g = window.__wireTheHouse, assets = g.room.mansionWing.editableAssets;
    let frozen = 0;
    const trees = [];
    for (const asset of assets.values()) {
      asset.traverse(object => { if (!object.matrixAutoUpdate && !object.matrixWorldAutoUpdate) frozen++; });
      for (const tree of asset.children) if (tree.name === 'Olive tree outside unfinished opening'
        || tree.name === 'Existing olive tree retained in open mansion court' || tree.name.startsWith('Modeled wind-responsive olive in outer grove')) {
        tree.updateWorldMatrix(true, true);
        const canopy = tree.getObjectByName('Scanned olive canopy') ?? (tree.isLOD ? tree.children[0]?.children.find(o => o.isGroup) : tree.children.find(o => o.isGroup));
        if (canopy) trees.push({ tree, canopy, before: canopy.quaternion.toArray() });
      }
    }
    await new Promise(resolve => setTimeout(resolve, 300));
    return { frozenObjects: frozen, trees: trees.map(({ tree, canopy, before }) => ({ name: tree.name,
      automatic: tree.matrixAutoUpdate && canopy.matrixAutoUpdate, moving: canopy.quaternion.toArray().some((n, i) => Math.abs(n - before[i]) > 1e-7) })) };
  });
  const poses = [
    { name: 'original-workroom', x: 0, y: 1.65, z: 2, yaw: 0, pitch: .15 },
    { name: 'foyer-stairs', x: 3.8, y: 1.65, z: 8.5, yaw: -1.5, pitch: .15 },
    { name: 'ground-flight-up', x: 5.5, y: 2.4, z: 9.5, yaw: Math.PI, pitch: .2 },
    { name: 'ground-landing-down', x: 6.5, y: 3.3, z: 11.6, yaw: 0, pitch: -.6 },
    { name: 'L2-stairwell', x: 7.5, y: 8.25, z: 8, yaw: Math.PI, pitch: -.5 },
    { name: 'B1-stairwell', x: 5.5, y: -1.0, z: 9.5, yaw: Math.PI, pitch: .2 },
    { name: 'street', x: 23, y: 1.65, z: -14, yaw: 2.54, pitch: .15 },
    { name: 'courtyard', x: 13, y: 1.7, z: 12, yaw: -1.5, pitch: -.1 },
    { name: 'L3-landing', x: 6.5, y: 9.9, z: 11.6, yaw: -4.6, pitch: -.1 },
  ];
  if (process.argv.includes('--brief')) poses.splice(2);
  if (process.argv.includes('--landing-only')) poses.splice(0, poses.length, poses[3]);
  if (option('--scenes')) {
    const names = option('--scenes').split(',');
    for (let i = poses.length - 1; i >= 0; i--) if (!names.includes(poses[i].name)) poses.splice(i, 1);
    if (!poses.length) throw new Error('No matching scenes');
  }
  for (const pose of poses) {
    console.log(`Measuring ${label}: ${pose.name}`);
    await page.evaluate(p => {
      const g = window.__wireTheHouse;
      g.player.camera.position.set(p.x, p.y, p.z); g.player.yaw = p.yaw; g.player.pitch = p.pitch;
      g.selectedTool = p.tool; g.fpsRig.show(p.tool);
    }, { ...pose, tool });
    const firstView = await page.evaluate(async () => {
      const g = window.__wireTheHouse, times = [], original = g.renderer.render;
      g.renderer.render = function (...args) { const result = original.apply(this, args); if (result) times.push(performance.now()); return result; };
      await new Promise(resolve => setTimeout(resolve, 600)); g.renderer.render = original;
      return { frames: times.length, maxIntervalMs: Math.max(0, ...times.slice(1).map((t, i) => t - times[i])) };
    });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(out, `${pose.name}.png`), timeout: 15000 });
    if (process.argv.includes('--draw-profile')) report.drawProfile = await page.evaluate(() => {
      const g = window.__wireTheHouse, r = g.renderer.gpu, original = r.renderObject, draws = [];
      r.renderObject = function (...args) {
        const object = args[0], geometry = args[3];
        const elements = geometry?.index?.count ?? geometry?.attributes?.position?.count ?? 0;
        draws.push({ name: object.name, parent: object.parent?.name, triangles: elements / 3 * (object.isInstancedMesh ? object.count : 1), instances: object.count ?? 1 });
        return original.apply(this, args);
      };
      g.renderer.render(); r.renderObject = original;
      return draws.sort((a,b) => b.triangles - a.triangles).slice(0,25);
    });
    const sample = await page.evaluate(async p => {
      const g = window.__wireTheHouse, frameTimes = [], stepTimes = [], spans = {}, calls = [], triangles = [];
      const originals = [], start = performance.now();
      const wrap = (owner, key, label) => {
        if (!owner || typeof owner[key] !== 'function') return;
        const old = owner[key]; originals.push(() => owner[key] = old);
        owner[key] = function (...args) { const before = performance.now(); const result = old.apply(this, args);
          (spans[label] ??= []).push(performance.now() - before); return result; };
      };
      wrap(g.room, 'update', 'room'); wrap(g.room.mansionWing, 'updateGameplayVisibility', 'basementVisibility');
      wrap(g.siteOcclusion, 'update', 'occlusion'); wrap(g.masonryBatch, 'update', 'masonryBatch');
      wrap(g.workerBody, 'update', 'workerBody'); wrap(g.apprentice, 'update', 'apprentices');
      wrap(g.renderer, 'render', 'renderer'); wrap(g.mixing, 'update', 'mixing');
      wrap(g.room.mansionWing, 'aimMasonry', 'masonryAim'); wrap(g.fpsRig, 'contactMasonry', 'hammerContact');
      const oldRender = g.renderer.render, oldStep = g.step;
      g.renderer.render = function (...args) { const result = oldRender.apply(this, args); if (result) {
        frameTimes.push(performance.now()); calls.push(this.webgl.info.render.calls); triangles.push(this.webgl.info.render.triangles); } return result; };
      g.step = function (...args) { const before = performance.now();
        if (p.turn) g.player.yaw = p.yaw + Math.sin((before - start) * .0018) * .6;
        const result = oldStep.apply(this, args); stepTimes.push(performance.now() - before); return result; };
      await new Promise(resolve => setTimeout(resolve, 3400));
      g.step = oldStep; g.renderer.render = oldRender; for (const restore of originals.reverse()) restore();
      const stats = values => { const sorted = [...values].sort((a, b) => a - b); return { samples: values.length,
        mean: values.reduce((a, b) => a + b, 0) / Math.max(1, values.length), p50: sorted[Math.floor(sorted.length * .5)] ?? 0,
        p95: sorted[Math.floor(sorted.length * .95)] ?? 0, max: sorted.at(-1) ?? 0 }; };
      const intervals = frameTimes.slice(1).map((t, i) => t - frameTimes[i]);
      const frameMs = stats(intervals), backend = g.renderer.webgl.backend, gl = backend.gl;
      let gpu = 'WebGPU'; if (gl) { const ext = gl.getExtension('WEBGL_debug_renderer_info'); gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); }
      return { mode: p.turn ? 'turning' : 'stationary', fps: intervals.length ? 1000 / frameMs.mean : 0, frameMs,
        minimumInstantFps: frameMs.max ? 1000 / frameMs.max : 0, intervalsOver50Ms: intervals.filter(ms => ms > 50).length,
        stepMs: stats(stepTimes), spans: Object.fromEntries(Object.entries(spans).map(([k, v]) => [k, stats(v)])),
        drawCalls: Math.max(0, ...calls), triangles: Math.max(0, ...triangles), camera: g.renderer.camera.position.toArray(),
        canvas: [g.renderer.webgl.domElement.width, g.renderer.webgl.domElement.height], gpu,
        longTasks: window.__stairLongTasks.filter(e => e.start >= start), lifecycle: g.renderer.lifecycleTelemetry,
        error: g.renderer.renderError, heapMB: performance.memory?.usedJSHeapSize / 1048576 };
    }, { ...pose, turn: process.argv.includes('--turn') });
    report.cases.push({ name: pose.name, firstView, ...sample });
    if (pose.name === 'foyer-stairs' && process.argv.includes('--cpu-profile')) {
      const cdp = await context.newCDPSession(page); await cdp.send('Profiler.enable'); await cdp.send('Profiler.start');
      await page.waitForTimeout(2800); const { profile } = await cdp.send('Profiler.stop');
      await writeFile(path.join(out, 'foyer-stairs.cpuprofile'), JSON.stringify(profile)); await cdp.detach();
    }
    await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ scene: pose.name, fps: sample.fps, p95: sample.frameMs.p95, cpu: sample.stepMs.mean, spans: Object.fromEntries(Object.entries(sample.spans).map(([k,v])=>[k, Number(v.mean.toFixed(2))])), draws: sample.drawCalls }));
  }
  await context.close();
  if (report.errors.length || report.cases.some(c => c.error || c.frameMs.samples < 10)) throw new Error('Gameplay profile failed: ' + JSON.stringify(report.errors));
});
await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(`Report: ${out}`);
