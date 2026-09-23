import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const sidecar = new URL('../.studio/mansion-level.json', import.meta.url);
const priorSidecar = await readFile(sidecar).catch(() => null);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let slotId = null;

async function aimAtStock(page) {
  return page.evaluate(() => {
    const game = window.__wireTheHouse, editor = game.levelEditor, stock = game.pvc.stock;
    editor.setFloorIndex(0);
    editor.setViewMode('3d');
    const center = stock.bundleCenter(0).add(new stock.position.constructor(0, 1.45, 0));
    const towardCamera = new center.constructor(0, .3, 2.0).applyQuaternion(stock.quaternion);
    editor.orbit.target.copy(center);
    editor.camera.position.copy(center).add(towardCamera);
    editor.camera.lookAt(center);
    editor.orbit.update();
    for (let yi = -18; yi <= 18; yi++) for (let xi = -18; xi <= 18; xi++) {
      const x = xi / 30, y = yi / 30;
      editor.raycaster.setFromCamera({ x, y }, editor.camera);
      const hit = editor.raycaster.intersectObjects(editor.editables().filter(item => editor.isSelectableVisible(item)), true)[0];
      let owner = hit?.object;
      while (owner && owner !== stock && owner !== game.renderer.scene) owner = owner.parent;
      if (owner === stock) return { x, y, id: stock.name };
    }
    return null;
  });
}

try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await blockPointerLock(desktop);
  const page = await desktop.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&editor=1&renderer=webgl');
  await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 45000 });
  const before = await page.evaluate(() => {
    const game = window.__wireTheHouse, stock = game.pvc.stock;
    return { position: stock.position.toArray(), center: stock.bundleCenter(0).toArray(),
      preparedParent: game.pvc.preparedRoot.parent === stock.contents,
      yardParent: game.apprentice.pipeYard.parent === stock.contents };
  });
  // The internal site-space child is private in TypeScript but visible at runtime.
  assert(before.preparedParent && before.yardParent);
  const pick = await aimAtStock(page);
  assert(pick, 'A visible PVC pipe needs a direct canvas pick from the editor camera');
  const canvas = await page.locator('#game-canvas').boundingBox();
  assert(canvas);
  await page.mouse.click(canvas.x + (pick.x + 1) * canvas.width / 2,
    canvas.y + (1 - pick.y) * canvas.height / 2);
  assert.equal(await page.evaluate(() => window.__wireTheHouse.levelEditor.selected?.name), pick.id);
  assert(await page.locator('#level-scale').isDisabled(),
    'Scaling a stock of fixed 3 m pipes must not silently change material length');
  await page.locator('[data-axis="x"]').fill(String(before.position[0] + .35));
  await page.locator('[data-axis="x"]').dispatchEvent('change');
  const moved = await page.evaluate(() => {
    const stock = window.__wireTheHouse.pvc.stock;
    return { x: stock.position.x, center: stock.bundleCenter(0).toArray() };
  });
  assert(Math.abs(moved.x - before.position[0] - .35) < .011);
  assert(Math.abs(moved.center[0] - before.center[0] - .35) < .011);
  await page.locator('#level-yaw').fill('20');
  await page.locator('#level-yaw').dispatchEvent('change');
  const rotated = await page.evaluate(() => {
    const game = window.__wireTheHouse, stock = game.pvc.stock;
    const pipeCenter = stock.bundleCenter(0);
    const camera = game.renderer.camera;
    camera.position.copy(pipeCenter).add(new pipeCenter.constructor(0, 1.5, 2).applyQuaternion(stock.quaternion));
    camera.lookAt(stock.sitePoint(3.46 + Math.sin(.095) * 1.5, 1.52, 1.15));
    camera.updateMatrixWorld(true);
    const aimedBundle = stock.bundleAt(camera)?.index ?? null;
    game.pvc.phase = 'marking';
    game.pvc.setFocus();
    const destination = stock.sitePoint(2.20, .95, game.pvc.bend.mark - .35 + .31);
    const focusError = game.pvc.cameraDestination.distanceTo(destination);
    const cutPoint = game.apprentice.pipeYard.cuttingPoint(0, 'socket');
    return { yaw: stock.rotation.y, center: pipeCenter.toArray(),
      aimedBundle, focusError, cutPoint: cutPoint.toArray() };
  });
  assert(Math.abs(rotated.yaw - 20 * Math.PI / 180) < .02);
  assert(Number.isInteger(rotated.aimedBundle) && rotated.aimedBundle >= 0 && rotated.aimedBundle < 5,
    'Gameplay ray must find one of the moved and rotated PVC bundles');
  assert(rotated.focusError < .001, 'PVC marking camera must follow the edited stock');
  assert(rotated.cutPoint.every(Number.isFinite));
  await page.locator('#level-save').click();
  await page.waitForFunction(() => new URL(location.href).searchParams.has('level'));
  slotId = new URL(page.url()).searchParams.get('level');
  await page.reload();
  await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 45000 });
  const restored = await page.evaluate(() => {
    const game = window.__wireTheHouse, stock = game.pvc.stock;
    return { x: stock.position.x, yaw: stock.rotation.y, center: stock.bundleCenter(0).toArray(),
      prepared: game.pvc.preparedRoot.parent === stock.contents,
      yard: game.apprentice.pipeYard.parent === stock.contents };
  });
  assert(Math.abs(restored.x - moved.x) < .011 && Math.abs(restored.yaw - rotated.yaw) < .011);
  assert(restored.prepared && restored.yard);
  const playable = await desktop.newPage();
  playable.on('pageerror', error => errors.push(error.message));
  await playable.goto(`http://127.0.0.1:5365/Electrical-Game/?mansion=preview&level=${encodeURIComponent(slotId)}&renderer=webgl`);
  await playable.locator('#start-button').click({ timeout: 45000 });
  await playable.waitForFunction(() => window.__wireTheHouse?.started, null, { timeout: 45000 });
  const played = await playable.evaluate(() => {
    const game = window.__wireTheHouse, stock = game.pvc.stock, camera = game.renderer.camera;
    const pipe = stock.pipes[0].children.find(item => item.name === '3 m PVC length');
    const target = pipe.getWorldPosition(new stock.position.constructor());
    camera.position.copy(target).add(new target.constructor(-1.45, .15, 0).applyQuaternion(stock.quaternion));
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
    const aimed = game.pvc.stockAimed();
    game.pvc.interact();
    return { x: stock.position.x, aimed, phase: game.pvc.phase, focused: game.pvc.focused };
  });
  assert(Math.abs(played.x - moved.x) < .011 && played.aimed && played.phase === 'opening' && played.focused,
    'A saved PVC move must still allow real gameplay interaction on the relocated pipe');
  await playable.close();
  const apprenticePage = await desktop.newPage();
  apprenticePage.on('pageerror', error => errors.push(error.message));
  await apprenticePage.goto(`http://127.0.0.1:5365/Electrical-Game/?mansion=preview&level=${encodeURIComponent(slotId)}&renderer=webgl`);
  await apprenticePage.locator('#start-button').click({ timeout: 45000 });
  await apprenticePage.waitForFunction(() => window.__wireTheHouse?.started, null, { timeout: 45000 });
  await apprenticePage.evaluate(() => {
    const game = window.__wireTheHouse;
    window.editorPvcStep = game.step.bind(game);
    game.step = () => {};
    const stock = game.pvc.stock, center = stock.bundleCenter(1), camera = game.renderer.camera;
    camera.position.copy(center).add(new center.constructor(-1.25, 1.43, 0).applyQuaternion(stock.quaternion));
    camera.lookAt(center.clone().add(new center.constructor(0, 1.03, 0)));
    camera.updateMatrixWorld(true);
    game.player.yaw = camera.rotation.y;
    game.player.pitch = camera.rotation.x;
    game.player.velocity.set(0, 0, 0);
  });
  const step = count => apprenticePage.evaluate(count => {
    for (let index = 0; index < count; index++) window.editorPvcStep(1 / 60);
  }, count);
  await apprenticePage.keyboard.press('t');
  await step(3);
  const bundlePick = await apprenticePage.evaluate(() => {
    const game = window.__wireTheHouse;
    return game.pvc.stock.bundleAt(game.renderer.camera)?.index ?? null;
  });
  assert.equal(bundlePick, 1, 'Coordinator must aim the moved second PVC bundle');
  await apprenticePage.mouse.click(720, 450);
  await step(3);
  assert.equal(await apprenticePage.evaluate(() => window.__wireTheHouse.apprentice.mode), 'pipe-choice');
  await apprenticePage.locator('[data-apprentice="pipe-socket"]').click();
  await step(3);
  await apprenticePage.evaluate(() => {
    const game = window.__wireTheHouse;
    game.renderer.camera.position.set(.4, 1.65, -.5);
    game.renderer.camera.lookAt(game.pvc.stock.bundleCenter(1));
    game.player.yaw = game.renderer.camera.rotation.y;
    game.player.pitch = game.renderer.camera.rotation.x;
  });
  let apprenticeState;
  for (let iteration = 0; iteration < 180; iteration++) {
    await step(36);
    apprenticeState = await apprenticePage.evaluate(() => window.__wireTheHouse.apprentice.telemetry);
    if (apprenticeState.phase === 'done' || apprenticeState.phase === 'blocked') break;
  }
  assert.equal(apprenticeState?.phase, 'done', JSON.stringify(apprenticeState));
  assert.equal(apprenticeState.pipeBatch.finishedSocket, 20,
    'The relocated stock must still supply a full apprentice PVC batch');
  await apprenticePage.close();
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await blockPointerLock(mobile);
  const touchPage = await mobile.newPage();
  touchPage.on('pageerror', error => errors.push(error.message));
  await touchPage.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&editor=1&renderer=webgl');
  await touchPage.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 45000 });
  const touchPick = await aimAtStock(touchPage);
  assert(touchPick, 'The moved PVC stock needs a visible mobile portrait pick');
  const touchCanvas = await touchPage.locator('#game-canvas').boundingBox();
  assert(touchCanvas);
  await touchPage.touchscreen.tap(touchCanvas.x + (touchPick.x + 1) * touchCanvas.width / 2,
    touchCanvas.y + (1 - touchPick.y) * touchCanvas.height / 2);
  assert.equal(await touchPage.evaluate(() => window.__wireTheHouse.levelEditor.selected?.name), touchPick.id);
  await touchPage.evaluate(() => {
    const game = window.__wireTheHouse, editor = game.levelEditor, stock = game.pvc.stock;
    const center = stock.bundleCenter(0).add(new stock.position.constructor(0, 1.45, 0));
    editor.orbit.target.copy(center);
    editor.camera.position.copy(center).add(new center.constructor(-2.4, .2, 1.2).applyQuaternion(stock.quaternion));
    editor.camera.zoom = .75;
    editor.camera.updateProjectionMatrix();
    editor.camera.lookAt(center);
    editor.orbit.update();
  });
  await touchPage.waitForTimeout(100);
  const output = new URL('../artifacts/site-pro-04/review/level-editor-selection/', import.meta.url);
  await mkdir(output, { recursive: true });
  await touchPage.screenshot({ path: fileURLToPath(new URL('pvc-stock-selected-mobile.png', output)) });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ before, pick, moved, rotated, restored, played,
    apprentice: { bundlePick, phase: apprenticeState.phase, finishedSocket: apprenticeState.pipeBatch.finishedSocket },
    touchPick, errors }));
  await mobile.close();
  await desktop.close();
} finally {
  await browser.close();
  if (slotId) await rm(new URL(`../.studio/levels/${slotId}.json`, import.meta.url), { force: true });
  if (priorSidecar === null) await rm(sidecar, { force: true });
  else await writeFile(sidecar, priorSidecar);
}
