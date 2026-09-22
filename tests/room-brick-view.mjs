import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { blockPointerLock } from './browser-safety.mjs';

const label = process.argv[2] ?? 'before';
const output = 'artifacts/site-pro-04/review/brick-geometry';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await blockPointerLock(context);
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&renderer=webgl');
  await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 45000 });
  await page.locator('#start-button').tap();
  await page.evaluate(async () => {
    const game = window.__wireTheHouse;
    await game.room.brickWall.waitForGeometry();
    await game.renderer.waitForFrame();
    game.step = () => undefined;
  });
  for (const [name, position, target] of [
    ['side', [0, 1.55, 0], [-3.6, 1.55, 0]],
    ['rear', [0, 1.55, .4], [-2.5, 1.5, 3.6]],
  ]) {
    await page.evaluate(({ position, target }) => {
      const game = window.__wireTheHouse;
      const camera = game.renderer.camera;
      camera.position.fromArray(position);
      camera.lookAt(...target);
      camera.updateMatrixWorld(true);
      game.renderer.render();
    }, { position, target });
    await page.locator('#game-canvas').screenshot({ path: `${output}/${label}-${name}.png` });
  }
} finally { await browser.close(); }
