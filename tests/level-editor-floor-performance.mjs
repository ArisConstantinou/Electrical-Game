import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { environment: 'Chrome WebGL touch emulation on Windows host; not a physical phone', cases: [] };
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&renderer=webgl', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 120_000 });
  await page.locator('#start-level-editor').tap();
  await page.evaluate(() => {
    const renderer = window.__wireTheHouse.renderer;
    const render = renderer.gpu.render.bind(renderer.gpu);
    window.__floorProfile = { active: false, times: [], draws: [], triangles: [] };
    renderer.gpu.render = (world, camera) => {
      const result = render(world, camera);
      const profile = window.__floorProfile;
      if (profile.active && world === renderer.scene && !renderer.gpu.getRenderTarget()) {
        profile.times.push(performance.now());
        profile.draws.push(renderer.webgl.info.render.calls);
        profile.triangles.push(renderer.webgl.info.render.triangles);
      }
      return result;
    };
  });
  const sample = async name => {
    await page.waitForTimeout(300);
    await page.evaluate(() => { window.__floorProfile = { active: true, times: [], draws: [], triangles: [] }; });
    await page.waitForTimeout(1800);
    const result = await page.evaluate(() => {
      const profile = window.__floorProfile;
      profile.active = false;
      const intervals = profile.times.slice(1).map((time, index) => time - profile.times[index]).sort((a, b) => a - b);
      const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
      return { frames: profile.times.length, p95Ms: intervals[Math.floor(intervals.length * .95)] ?? null,
        meanDrawCalls: mean(profile.draws), meanTriangles: mean(profile.triangles),
        visibleWingObjects: window.__wireTheHouse.room.mansionWing.children.filter(child => child.visible).length,
        renderError: window.__wireTheHouse.renderer.renderError };
    });
    assert(result.frames > 30 && !result.renderError, `${name}: ${JSON.stringify(result)}`);
    report.cases.push({ name, ...result });
  };
  await sample('editor-top-ground');
  await page.locator('.level-editor__bottom-nav [data-editor-tab="select"]').tap();
  await page.locator('#level-view-quick [data-level-view="2d"]').tap();
  await page.locator('#level-floor-quick').selectOption('1');
  await page.locator('.level-editor__bottom-nav [data-editor-tab="select"]').tap();
  await sample('editor-top-l1');
  await page.locator('.level-editor__bottom-nav [data-editor-tab="select"]').tap();
  await page.locator('#level-view-quick [data-level-view="3d"]').tap();
  await page.locator('.level-editor__bottom-nav [data-editor-tab="select"]').tap();
  await sample('editor-angle-l1');
  console.log(JSON.stringify(report));
} finally { await browser.close(); }
