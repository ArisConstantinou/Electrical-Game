import { chromium } from 'playwright';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { blockPointerLock } from './browser-safety.mjs';

const live = process.argv.includes('--live');
const dist = resolve('dist');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  await blockPointerLock(context);
  const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.webp':'image/webp',
    '.png':'image/png', '.jpg':'image/jpeg', '.glb':'model/gltf-binary', '.svg':'image/svg+xml' };
  if (!live) await context.route('https://arisconstantinou.github.io/Electrical-Game/**', async route => {
    const file = resolve(dist, decodeURIComponent(new URL(route.request().url()).pathname.slice('/Electrical-Game/'.length)) || 'index.html');
    if (!file.startsWith(`${dist}\\`)) return route.abort();
    try {
      if (!(await stat(file)).isFile()) return route.abort();
      await route.fulfill({ status: 200, contentType: mime[extname(file)] ?? 'application/octet-stream', body: await readFile(file) });
    } catch { await route.abort(); }
  });
  const page = await context.newPage();
  await page.goto(live
    ? 'http://127.0.0.1:5365/Electrical-Game/?mansion=preview&renderer=webgl'
    : 'https://arisconstantinou.github.io/Electrical-Game/?mansion=preview&renderer=webgl');
  await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 120000 });
  await page.locator('#apprentice-count').selectOption('0');
  await page.locator('#start-button').click();
  const result = await page.evaluate(async () => {
    const game = window.__wireTheHouse;
    game.step = () => {};
    const wall = game.room.mansionWing.masonryDemolition.get('Courtyard north fired-clay enclosure');
    for (let i=0;i<wall.original.length;i++) {
      const matrix = wall.original[i].elements;
      if (Math.abs(matrix[12]-1.8)<.76 && matrix[13]<2.1) wall.strike(i);
    }
    game.room.mansionWing.updateGameplayVisibility(15.3,14.3,0);
    game.fpsRig.visible = false;
    const camera = game.renderer.camera;
    camera.position.set(15.3,1.65,14.3);
    const intervals = [], renderMs = [];
    let accepted = 0, previous = performance.now();
    for (let frame=0;frame<150;frame++) {
      await new Promise(resolve=>requestAnimationFrame(resolve));
      const now=performance.now(), interval=now-previous; previous=now;
      camera.rotation.set(0,Math.PI+Math.sin(frame*.09)*.65,0);
      const start=performance.now();
      if (game.renderer.render()) accepted++;
      await game.renderer.waitForFrame();
      if (frame>=30) { intervals.push(interval); renderMs.push(performance.now()-start); }
    }
    const percentile = (values,p) => [...values].sort((a,b)=>a-b)[Math.floor(values.length*p)];
    return {removed:wall.removedIndices().length,accepted,frameP50Ms:percentile(intervals,.5),
      frameP95Ms:percentile(intervals,.95),frameMaxMs:Math.max(...intervals),
      renderP95Ms:percentile(renderMs,.95),drawCalls:game.renderer.webgl.info.render.calls,
      rendererError:game.renderer.renderError};
  });
  console.log(JSON.stringify({live,result}));
} finally { await browser.close(); }
