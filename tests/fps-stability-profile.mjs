import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { blockPointerLock } from './browser-safety.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const isolatedRoot = process.env.QA_DIST_ROOT ? path.resolve(process.env.QA_DIST_ROOT) : null;
const backend = process.env.QA_RENDERER === 'webgl' ? 'webgl' : 'default';
const crew = process.env.QA_CREW === '1';
const label = `${process.env.QA_LIVE ? 'live' : isolatedRoot ? 'candidate' : 'baseline'}-${backend}${crew ? '-crew1' : ''}`;
const report = { url: `http://127.0.0.1:5365/Electrical-Game/${backend === 'webgl' ? '?renderer=webgl' : ''}`, cases: [] };
const percentile = (values, ratio) => values.length ? values[Math.min(values.length - 1, Math.floor((values.length - 1) * ratio))] : null;
const summarise = values => {
  const sorted = values.toSorted((a, b) => a - b);
  return { count: values.length, mean: values.reduce((a, b) => a + b, 0) / (values.length || 1),
    p50: percentile(sorted, .5), p95: percentile(sorted, .95), p99: percentile(sorted, .99), max: sorted.at(-1) ?? null };
};
try {
  const context = await browser.newContext({ viewport: { width: 1718, height: 1259 }, deviceScaleFactor: 1 });
  await blockPointerLock(context);
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__loadLongTasks = [];
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) window.__loadLongTasks.push({ start: entry.startTime, duration: entry.duration });
    }).observe({ type: 'longtask', buffered: true });
  });
  if (isolatedRoot) await page.route('http://127.0.0.1:5365/Electrical-Game/**', async route => {
    const relative = decodeURIComponent(new URL(route.request().url()).pathname).slice('/Electrical-Game/'.length) || 'index.html';
    const file = path.resolve(isolatedRoot, relative);
    if (!file.startsWith(isolatedRoot + path.sep)) return route.abort();
    try {
      const extension = path.extname(file).toLowerCase();
      await route.fulfill({ status: 200, body: await readFile(file), contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.svg': 'image/svg+xml' })[extension] || 'application/octet-stream' });
    } catch { await route.fulfill({ status: 404, body: `Missing isolated asset: ${relative}` }); }
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(report.url);
  await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 120000 });
  report.load = await page.evaluate(() => ({ readyMs: performance.now(), longTasks: window.__loadLongTasks,
    heap: performance.memory?.usedJSHeapSize }));
  await page.locator('#apprentice-count').selectOption(crew ? '1' : '0');
  const startAt = await page.evaluate(() => performance.now());
  await page.locator('#start-button').click();
  report.load.startMs = await page.evaluate(startAt => performance.now() - startAt, startAt);
  if (crew) await page.locator('#site-pro-desktop-tools [data-tool="hammer"]').click();
  await page.waitForTimeout(1200);
  report.environment = await page.evaluate(() => {
    const game = window.__wireTheHouse;
    const gl = document.querySelector('canvas')?.getContext('webgl2');
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    return { userAgent: navigator.userAgent, gpu: debug && gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),
      backend: game.renderer.gpu.backend.constructor.name, dpr: devicePixelRatio,
      canvas: [game.renderer.webgl.domElement.width, game.renderer.webgl.domElement.height],
      heapLimit: performance.memory?.jsHeapSizeLimit, initialHeap: performance.memory?.usedJSHeapSize };
  });
  await page.evaluate(() => {
    const game = window.__wireTheHouse, samples = window.__fpsProfile = { active: false, frameAt: [], stepMs: [], renderMs: [], drawCalls: [], triangles: [], shadowDirty: [], shadowAnchor: [], invalidators: {} };
    const invalidate = game.room.invalidateSunShadow?.bind(game.room);
    if(invalidate)game.room.invalidateSunShadow = () => { if(samples.active){const source=new Error().stack?.split('\n')[2]?.trim() || 'unknown'; samples.invalidators[source]=(samples.invalidators[source]||0)+1;} invalidate(); };
    const step = game.step.bind(game), render = game.renderer.gpu.render.bind(game.renderer.gpu);
    game.step = (...args) => { const start = performance.now(); const result = step(...args); if (samples.active) samples.stepMs.push(performance.now() - start); return result; };
    game.renderer.gpu.render = (...args) => { const start = performance.now(); const dirty=game.room.sun.shadow.needsUpdate; const anchor=game.room.sun.target.position.toArray(); const result = render(...args);
      if (samples.active && args[0] === game.renderer.scene && !game.renderer.gpu.getRenderTarget()) {
        samples.frameAt.push(performance.now()); samples.renderMs.push(performance.now() - start);
        samples.drawCalls.push(game.renderer.webgl.info.render.calls);samples.shadowDirty.push(dirty);samples.shadowAnchor.push(anchor);
        samples.triangles.push(game.renderer.webgl.info.render.triangles);
      }
      return result;
    };
  });
  for (const pose of (crew ? [
    { name: 'stair-and-work-area', x: 3.5, z: 13, yaw: 0 },
    { name: 'foyer-stair-overview', x: 3, z: 10, yaw: Math.PI },
    { name: 'stair-foyer', x: 5.2, z: 9.1, yaw: 1.8 },
  ] : [
    { name: 'starting-bay', x: 0, z: 5.2, yaw: Math.PI },
    { name: 'stair-foyer', x: 5.2, z: 9.1, yaw: 1.8 },
    { name: 'courtyard-wall', x: 15.3, z: 13.2, yaw: Math.PI },
  ]).filter(pose => !process.env.QA_ONLY_SCENE || pose.name === process.env.QA_ONLY_SCENE)) {
    for (const motion of (process.env.QA_REPEAT_TURN ? ['still', 'turn', 'turn-warm'] : ['still', 'turn'])) {
      await page.evaluate(({ pose, motion }) => {
        const game = window.__wireTheHouse;
        game.player.camera.position.set(pose.x, game.player.eyeHeight, pose.z);
        game.player.yaw = pose.yaw;
        clearInterval(window.__profileTurn);
        if (motion.startsWith('turn')) {
          let phase = 0;
          window.__profileTurn = setInterval(() => { phase += .065; game.player.yaw = pose.yaw + Math.sin(phase) * .72; }, 16);
        }
        window.__fpsProfile.active = false;
      }, { pose, motion });
      await page.waitForTimeout(900);
      const imagePath = `output/fps-stability/${label}-${pose.name}-${motion}.png`;
      await mkdir('output/fps-stability', { recursive: true });
      await page.screenshot({ path: imagePath });
      await page.evaluate(() => { const s = window.__fpsProfile; for (const key of Object.keys(s)) if (Array.isArray(s[key])) s[key].length = 0; s.invalidators={}; s.startedAt=performance.now(); s.active = true; });
      await page.waitForTimeout(3600);
      const sample = await page.evaluate(() => {
        const s = window.__fpsProfile; s.active = false;
        return { frameAt: [...s.frameAt], stepMs: [...s.stepMs], renderMs: [...s.renderMs],
          drawCalls: [...s.drawCalls], triangles: [...s.triangles], shadowDirty:[...s.shadowDirty],shadowAnchor:[...s.shadowAnchor],invalidators:s.invalidators, heap: performance.memory?.usedJSHeapSize,
          renderError: window.__wireTheHouse.renderer.renderError,
          longTasks: window.__loadLongTasks.filter(task => task.start >= s.startedAt) };
      });
      const intervals = sample.frameAt.slice(1).map((time, i) => time - sample.frameAt[i]);
      const frame = summarise(intervals), step = summarise(sample.stepMs), render = summarise(sample.renderMs);
      report.cases.push({ scene: pose.name, motion, fps: frame.mean ? 1000 / frame.mean : 0,
        frame, step, render, drawCalls: summarise(sample.drawCalls), triangles: summarise(sample.triangles),
        heap: sample.heap, renderError: sample.renderError, longTasks:sample.longTasks,
        shadowDirtyFrames:sample.shadowDirty.filter(Boolean).length,shadowAnchorFirst:sample.shadowAnchor[0],shadowAnchorLast:sample.shadowAnchor.at(-1),invalidators:sample.invalidators,screenshot: imagePath });
    }
  }
  await page.evaluate(() => clearInterval(window.__profileTurn));
  report.errors = errors;
} finally {
  await browser.close();
  await mkdir('output/fps-stability', { recursive: true });
  await writeFile(`output/fps-stability/${label}.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
