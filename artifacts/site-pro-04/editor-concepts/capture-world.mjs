import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&renderer=webgl', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 120_000 });
  await page.locator('#start-level-editor').click();
  await page.waitForFunction(() => window.__wireTheHouse?.levelEditor.active);
  await page.evaluate(() => {
    const editor = window.__wireTheHouse.levelEditor;
    editor.camera.position.set(13.5, 1.8, -2.5);
    editor.orbit.target.set(13.5, 1.4, 3);
    editor.orbit.update();
    editor.panel.style.display = 'none';
  });
  await page.waitForTimeout(500);
  const canvas = page.locator('#game-stage canvas').first();
  console.log('canvas', await canvas.count(), await canvas.boundingBox());
  await canvas.screenshot({ path: 'artifacts/site-pro-04/editor-concepts/world-mobile.png' });
  await context.close();
} finally { await browser.close(); }
