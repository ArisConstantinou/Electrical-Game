import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve('dist');
const output = path.resolve('artifacts/visual-overhaul');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1365, height: 768 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await page.route('http://127.0.0.1:5365/Electrical-Game/**', async route => {
  const relative = decodeURIComponent(new URL(route.request().url()).pathname)
    .slice('/Electrical-Game/'.length) || 'index.html';
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep)) return route.abort();
  try {
    const body = await fs.readFile(file);
    const extension = path.extname(file).toLowerCase();
    const contentType = ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
      '.json': 'application/json', '.webp': 'image/webp', '.jpg': 'image/jpeg',
      '.png': 'image/png', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream' })[extension]
      || 'application/octet-stream';
    await route.fulfill({ status: 200, contentType, body });
  } catch { await route.fulfill({ status: 404, body: `Missing isolated asset: ${relative}` }); }
});

try {
  await page.goto('http://127.0.0.1:5365/Electrical-Game/');
  await page.locator('#start-button').click({ timeout: 120000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__wireTheHouse.modelInspector.open());
  await page.locator('#model-assets').click();
  await page.locator('#model-search').fill('Distribution board');
  const listedBoards = await page.locator('#model-list button').count();
  if (listedBoards !== 2) throw new Error(`Expected two selectable board stages, found ${listedBoards}`);
  await page.locator('#model-list button').first().click();
  const results = [];
  for (const [stage, name] of [['first-fix', 'empty'], ['second-fix', 'fitted']]) {
    const result = await page.evaluate(async requestedStage => {
      const inspector = window.__wireTheHouse.modelInspector;
      if (!inspector.active) await inspector.open();
      const entry = inspector.entries.find(item => item.source?.userData.stage === requestedStage);
      if (!entry) throw new Error(`Distribution board entry missing: ${requestedStage}`);
      await inspector.select(entry.id);
      const sample = entry.source;
      const meshes = [];
      sample.traverse(item => { if (item.isMesh) meshes.push(item); });
      return { stage: requestedStage, title: document.querySelector('#model-title')?.textContent,
        count: meshes.length, triangles: meshes.reduce((sum, item) =>
          sum + (item.geometry.index ? item.geometry.index.count : item.geometry.getAttribute('position').count) / 3, 0),
        stageMetadata: sample.userData, selected: inspector.selected };
    }, stage);
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(output, `db-reference-${name}-desktop.png`) });
    results.push(result);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(output, 'db-reference-fitted-mobile-viewport.png') });
  const viewport = await page.evaluate(() => {
    const panel = document.querySelector('#model-inspector').getBoundingClientRect();
    const stage = document.querySelector('#model-orbit').getBoundingClientRect();
    return { panel: { width: panel.width, height: panel.height }, stage: { width: stage.width, height: stage.height } };
  });
  const report = { results, listedBoards, viewport, errors };
  await fs.writeFile(path.join(output, 'db-reference-check.json'), JSON.stringify(report, null, 2));
  if (errors.length || results.some(item => item.count > 20 || item.stageMetadata.sourcePartCount < 30
    || item.stageMetadata.circuitDesignAssigned !== false)
    || viewport.stage.width < 200 || viewport.stage.height < 100) process.exitCode = 1;
  process.stdout.write(`${JSON.stringify(report)}\n`);
} finally {
  await browser.close();
}
