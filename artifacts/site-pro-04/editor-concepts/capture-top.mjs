import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&renderer=webgl', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 120_000 });
  await page.locator('#start-level-editor').click();
  await page.waitForFunction(() => window.__wireTheHouse?.levelEditor.active);
  const hidden = await page.evaluate(() => {
    const game = window.__wireTheHouse;
    const editor = game.levelEditor;
    editor.panel.style.display = 'none';
    editor.gizmo.getHelper().visible = false;
    editor.camera.position.set(13.5, 19, 1.25);
    editor.camera.up.set(0, 0, -1);
    editor.orbit.target.set(13.5, 0, 1.25);
    editor.orbit.update();
    const names = [];
    game.renderer.scene.traverse(object => {
      if (!object.isMesh) return;
      const name = object.name.toLowerCase();
      if (/(roof|ceiling|soffit|l1 |first.floor|landing|upper.stair|storey|second.floor)/.test(name)) {
        object.visible = false;
        names.push(object.name);
      }
    });
    return names;
  });
  await page.waitForTimeout(600);
  await page.locator('#game-stage canvas').first().screenshot({ path: 'artifacts/site-pro-04/editor-concepts/world-top.png' });
  console.log('Hidden overhead meshes:', hidden.length);
  await context.close();
} finally { await browser.close(); }
