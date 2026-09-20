import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';

// Repeat the identical workload before/after the rebuild. Camera placement is a
// QA fixture. The held-button probe uses real mouse input; the 150-strike workload
// invokes the existing gameplay impact entry point to control strike count.
const baseUrl = process.argv[2] ?? 'http://127.0.0.1:5365/Electrical-Game/';
const output = resolve(process.argv[3] ?? 'artifacts/masonry-rebuild-baseline');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const report = {
  url: baseUrl, capturedAt: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  dirty: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim(),
  browserVersion: browser.version(), headless: true,
  viewport: { width: 1366, height: 768, deviceScaleFactor: 1 },
  limitations: ['Headless desktop browser; not physical mobile evidence.', 'requestAnimationFrame intervals include scheduling/GPU work; they are not GPU timer queries.', 'JS heap is Chromium performance.memory when exposed; GPU memory is not exposed.', 'Impact timing instruments ChasingSystem.freeHit including debris generation; update/render timings are separate.', '50 stationary + 100 moving impacts use the gameplay freeHit method, separate from the real mouse hold probe.'],
  stages: [], errors,
};
try {
  const response = await page.goto(baseUrl, { waitUntil: 'networkidle' });
  report.httpStatus = response.status();
  await page.click('#start-button');
  await page.keyboard.press('Digit4');
  await page.keyboard.press('KeyX');
  await page.evaluate(() => {
    const game = window.__wireTheHouse;
    const gl = game.renderer.webgl.getContext();
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    window.__masonryBench = {
      frameIntervals: [], impactTimes: [], renderTimes: [],
      environment: { userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency,
        gpuVendor: extension ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) : null,
        gpuRenderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : null,
        webglVersion: gl.getParameter(gl.VERSION) },
    };
    let previous = performance.now();
    const frame = time => { window.__masonryBench.frameIntervals.push(time - previous); previous = time; requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
    const hit = game.chasing.freeHit.bind(game.chasing);
    game.chasing.freeHit = (...args) => {
      const before = performance.now(); const result = hit(...args);
      window.__masonryBench.impactTimes.push({ ms: performance.now() - before, success: Boolean(result) });
      return result;
    };
    const render = game.renderer.render.bind(game.renderer);
    game.renderer.render = () => {
      const before = performance.now(); render();
      window.__masonryBench.renderTimes.push(performance.now() - before);
    };
    window.__masonryBench.aim = (x = 0.8, y = 1.55) => {
      game.renderer.camera.position.set(x, 1.55, -1.15);
      game.renderer.camera.lookAt(x, y, -2.41);
      game.player.yaw = game.renderer.camera.rotation.y;
      game.player.pitch = game.renderer.camera.rotation.x;
      game.renderer.camera.updateMatrixWorld(true);
    };
    window.__masonryBench.aim();
  });
  const reset = () => page.evaluate(() => {
    const bench = window.__masonryBench;
    bench.frameIntervals = []; bench.impactTimes = []; bench.renderTimes = [];
  });
  const capture = async name => {
    const value = await page.evaluate(() => {
      const bench = window.__masonryBench;
      const game = window.__wireTheHouse;
      const summarize = values => {
        const sorted = [...values].sort((a, b) => a - b);
        const sum = values.reduce((total, value) => total + value, 0);
        return { samples: values.length, averageMs: values.length ? sum / values.length : null,
          p95Ms: sorted[Math.floor((sorted.length - 1) * .95)] ?? null,
          worstMs: sorted.at(-1) ?? null };
      };
      const frames = summarize(bench.frameIntervals);
      const info = game.renderer.webgl.info;
      return { environment: bench.environment,
        frameIntervals: { ...frames, averageFps: frames.averageMs ? 1000 / frames.averageMs : null },
        impactProcessing: { ...summarize(bench.impactTimes.map(item => item.ms)), successful: bench.impactTimes.filter(item => item.success).length },
        cpuRenderSubmission: summarize(bench.renderTimes),
        render: { ...info.render }, memory: { ...info.memory, jsHeapUsedBytes: performance.memory?.usedJSHeapSize ?? null, jsHeapTotalBytes: performance.memory?.totalJSHeapSize ?? null },
        state: JSON.parse(window.render_game_to_text()),
      };
    });
    await page.screenshot({ path: join(output, `${name}.png`) });
    report.stages.push({ name, ...value });
    await writeFile(join(output, 'metrics.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ name, frames: value.frameIntervals, impact: value.impactProcessing, render: value.render, memory: value.memory, fragments: value.state.workSurface.activeFragments }));
  };
  await reset();
  await page.waitForTimeout(3000);
  await capture('01-undamaged');
  await reset();
  await page.mouse.move(683, 384);
  await page.mouse.down();
  await page.evaluate(() => window.__masonryBench.aim());
  await page.waitForTimeout(1800);
  await page.mouse.up();
  await capture('02-real-mouse-hold');
  await reset();
  for (let index = 0; index < 50; index++) {
    await page.evaluate(() => {
      const game = window.__wireTheHouse;
      window.__masonryBench.aim();
      game.chasing.freeHit(game.renderer.camera, false);
    });
    await page.waitForTimeout(40);
  }
  await capture('03-fifty-local-impacts');
  await reset();
  for (let index = 0; index < 100; index++) {
    await page.evaluate(index => {
      const game = window.__wireTheHouse;
      const y = .45 + (index % 25) * .072;
      window.__masonryBench.aim(-.8, y);
      game.chasing.freeHit(game.renderer.camera, false);
    }, index);
    await page.waitForTimeout(40);
  }
  await capture('04-long-moving-chase');
  await reset();
  await page.evaluate(() => window.__masonryBench.aim(-.8, 1.4));
  await page.waitForTimeout(3000);
  await capture('05-damaged-idle');
  if (process.argv.includes('--extended')) {
    await reset();
    // 500 rapid real-geometry strikes over multiple wall areas; no direct edits.
    for (let index=0; index<500; index++) {
      await page.evaluate(index=>{
        const g=window.__wireTheHouse, b=window.__masonryBench;
        g.room.brickWall.chiselTiltDegrees=index<250?50:0;
        g.room.brickWall.chiselSideDegrees=index<250?0:50;
        const x=index<250?-1.7+(index%5)*.024:-1.6+(index%50)*.053;
        const y=index<250?.45+(Math.floor(index/5)%50)*.037:1.8+Math.floor((index-250)/50)*.025;
        b.aim(x,y); g.chasing.freeHit(g.renderer.camera,false);
      },index);
      await page.waitForTimeout(20);
    }
    await capture('06-five-hundred-rapid-multiple-areas');
    await page.evaluate(async()=>{await window.__wireTheHouse.room.brickWall.waitForGeometry();});
    await reset(); await page.waitForTimeout(10000); await capture('07-damaged-idle-ten-seconds');
    await reset(); await page.waitForTimeout(20000); await capture('08-damaged-idle-thirty-seconds');
    const tail=report.stages.at(-1);
    if(tail.state.workSurface.pendingMeshes!==0) throw new Error('Worker remesh backlog did not drain');
    if(tail.state.workSurface.pendingSupportJobs!==0) throw new Error('Detached support work did not drain');
    if(tail.state.workSurface.activeFragments>144) throw new Error('Physical fragment budget exceeded');
    if(tail.frameIntervals.averageFps<50) throw new Error('Severe sustained idle FPS collapse');
  }
  if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
} finally {
  await writeFile(join(output, 'metrics.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
