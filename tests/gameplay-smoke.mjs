import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:5362/Electrical-Game/';
const output = new URL('../output/qa/', import.meta.url);
await mkdir(output, { recursive: true });
const outputPath = name => fileURLToPath(new URL(name, output));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];

const state = page => page.evaluate(() => JSON.parse(window.render_game_to_text()));
const aimAtActive = page => page.evaluate(() => {
  const game = window.__wireTheHouse;
  const point = game.mission.activePoint;
  if (!point) return;
  const targetX = point.position.x;
  const targetY = point.position.y;
  game.renderer.camera.position.set(targetX, 1.36, -0.72);
  const dy = targetY - game.renderer.camera.position.y;
  const dz = -2.41 - game.renderer.camera.position.z;
  game.player.yaw = 0;
  game.player.pitch = Math.atan2(dy, Math.abs(dz));
  game.renderer.camera.rotation.set(game.player.pitch, 0, 0);
  game.step(1 / 60);
});
const action = async page => { await page.keyboard.press('KeyE'); await page.evaluate(() => window.advanceTime(34)); };
const leftClickAction = async page => {
  await page.mouse.down({ button: 'left' });
  await page.evaluate(() => window.advanceTime(34));
  await page.mouse.up({ button: 'left' });
};
const mobileTap = async (page, selector) => { await page.locator(selector).tap(); await page.evaluate(() => window.advanceTime(34)); };
const reachLeveling = async page => {
  await page.keyboard.press('Digit3');
  await action(page);
  await page.keyboard.press('Digit4');
  for (let index = 0; index < 4; index += 1) await action(page);
  if ((await state(page)).activePoint.id === 'A') await page.screenshot({ path: outputPath('desktop-real-chase.png') });
  await page.keyboard.press('Digit5');
  await aimAtActive(page);
  await action(page);
  await action(page);
  if ((await state(page)).activePoint.id === 'A') await page.screenshot({ path: outputPath('desktop-mortar-flush.png') });
  await page.keyboard.press('Digit6');
  await action(page);
  const current = await state(page);
  if (current.activePoint.stage !== 'leveling') throw new Error(`Expected leveling, got ${current.activePoint.stage}`);
  if (current.activePoint.id === 'A') await page.screenshot({ path: outputPath('desktop-leveling.png') });
};
const finishPipe = async page => {
  await page.keyboard.press('Digit1');
  await action(page);
  await page.keyboard.press('Digit2');
  await action(page);
  await page.keyboard.press('Digit1');
  await action(page);
  await action(page);
};

const desktop = await browser.newPage({ viewport: { width: 1366, height: 768 } });
desktop.on('console', message => { if (message.type() === 'error') errors.push(`desktop console: ${message.text()}`); });
desktop.on('pageerror', error => errors.push(`desktop page: ${error.message}`));
const response = await desktop.goto(baseUrl, { waitUntil: 'networkidle' });
if (!response?.ok()) throw new Error(`Route did not load: ${response?.status()}`);
await desktop.click('#start-button');
await desktop.waitForTimeout(450);
if (!await desktop.locator('#desktop-key-guide').isVisible()) throw new Error('Desktop key guide is not visible during gameplay');
const keyGuideText = await desktop.locator('#desktop-key-guide').innerText();
for (const required of ['WASD', 'LMB', 'E', 'WHEEL', '1–6', 'V', 'C', 'F', 'ESC']) {
  if (!keyGuideText.includes(required)) throw new Error(`Desktop key guide is missing ${required}`);
}
const beforeMove = await state(desktop);
await desktop.mouse.move(680, 380);
await desktop.mouse.move(740, 330);
const afterLook = await state(desktop);
if (afterLook.player.yaw === beforeMove.player.yaw || afterLook.player.pitch === beforeMove.player.pitch) throw new Error('Desktop Pointer Lock mouse look did not update yaw and pitch');
await desktop.mouse.wheel(0, 120);
if ((await state(desktop)).mission.selectedTool !== 'hammer') throw new Error('Desktop mouse wheel did not cycle the visible work tool');
await desktop.keyboard.press('Digit3');
await aimAtActive(desktop);
await leftClickAction(desktop);
if ((await state(desktop)).activePoint.stage !== 'marked') throw new Error('Desktop left mouse did not use the selected tool');
if ((await state(desktop)).workSurface.sprayMode !== 'live') throw new Error('Realistic LIVE spray is not the default method');
await desktop.keyboard.press('KeyV');
if ((await state(desktop)).workSurface.sprayMode !== 'dots') throw new Error('Desktop could not retain the alternative DOTS method');
await desktop.keyboard.press('KeyV');
await desktop.keyboard.press('KeyC');
const liveSettings = await state(desktop);
if (liveSettings.workSurface.sprayMode !== 'live' || liveSettings.workSurface.sprayColor !== 'RED') throw new Error(`Desktop spray settings did not change: ${JSON.stringify(liveSettings.workSurface)}`);
const liveMarksBefore = liveSettings.workSurface.freeSprayMarks;
await desktop.mouse.down({ button: 'left' });
for (let index = 0; index < 7; index += 1) {
  await desktop.evaluate(step => {
    const game = window.__wireTheHouse;
    game.player.pitch -= 0.012 * step;
    window.advanceTime(90);
  }, index);
}
await desktop.screenshot({ path: outputPath('desktop-live-red-spray.png') });
await desktop.mouse.up({ button: 'left' });
const liveMarksAfter = (await state(desktop)).workSurface.freeSprayMarks;
if (liveMarksAfter - liveMarksBefore < 18) throw new Error(`LIVE spray did not create connected coverage and overspray: ${liveMarksAfter - liveMarksBefore} marks`);
await desktop.keyboard.press('Digit4');
await desktop.mouse.down({ button: 'left' });
await desktop.evaluate(() => window.advanceTime(800));
await desktop.mouse.up({ button: 'left' });
if ((await state(desktop)).activePoint.stage !== 'chased') throw new Error('Holding desktop left mouse did not repeatedly use the hammer');
await desktop.reload({ waitUntil: 'networkidle' });
await desktop.click('#start-button');
await desktop.waitForTimeout(450);
await desktop.keyboard.press('Digit3');
await desktop.keyboard.down('KeyS');
await desktop.evaluate(() => window.advanceTime(500));
await desktop.keyboard.up('KeyS');
const afterMove = await state(desktop);
if (Math.abs(afterMove.player.z - beforeMove.player.z) < 0.25) throw new Error('Desktop WASD movement did not move the player');

for (const id of ['A', 'B', 'C']) {
  await aimAtActive(desktop);
  const aimed = await state(desktop);
  if (!aimed.activePoint.targeted || aimed.activePoint.id !== id) throw new Error(`Could not target Point ${id}`);
  await reachLeveling(desktop);
  if (id === 'A' || id === 'C') {
    for (let index = 0; index < 3; index += 1) await desktop.keyboard.press('KeyA');
    for (let index = 0; index < 2; index += 1) await desktop.keyboard.press('KeyW');
  } else {
    for (let index = 0; index < 2; index += 1) await desktop.keyboard.press('KeyD');
    for (let index = 0; index < 2; index += 1) await desktop.keyboard.press('KeyS');
  }
  const aligned = await state(desktop);
  if (!aligned.activePoint.levelPass || !aligned.activePoint.flushPass) throw new Error(`Point ${id} leveling did not reach both tolerances`);
  await action(desktop);
  await finishPipe(desktop);
  await desktop.screenshot({ path: outputPath(`desktop-point-${id}.png`) });
}
const complete = await state(desktop);
if (!complete.mission.complete || complete.mode !== 'mission-complete') throw new Error('Mission did not reach FIRST FIX COMPLETE');
if (!await desktop.locator('#result-panel.visible').isVisible()) throw new Error('Result panel is not visible');

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
mobile.on('console', message => { if (message.type() === 'error') errors.push(`mobile console: ${message.text()}`); });
mobile.on('pageerror', error => errors.push(`mobile page: ${error.message}`));
await mobile.goto(baseUrl, { waitUntil: 'networkidle' });
await mobile.click('#start-button');
await mobile.waitForTimeout(450);
if (await mobile.locator('#desktop-key-guide').isVisible()) throw new Error('Desktop key guide overlaps the mobile HUD');
for (const selector of ['#mobile-action', '#tool-prev', '#tool-next', '#spray-mode', '#spray-color']) {
  const box = await mobile.locator(selector).boundingBox();
  if (!box || box.width < 44 || box.height < 44) throw new Error(`${selector} is below the 44px touch target`);
}
await mobileTap(mobile, '#spray-mode');
if ((await state(mobile)).workSurface.sprayMode !== 'dots') throw new Error('Mobile could not select the alternative DOTS method');
await mobileTap(mobile, '#spray-mode');
await mobileTap(mobile, '#spray-color');
const mobileSpraySettings = await state(mobile);
if (mobileSpraySettings.workSurface.sprayMode !== 'live' || mobileSpraySettings.workSurface.sprayColor !== 'RED') throw new Error(`Mobile spray settings did not change: ${JSON.stringify(mobileSpraySettings.workSurface)}`);
await mobile.screenshot({ path: outputPath('mobile-spray-controls.png') });
const mobileLayout = await mobile.evaluate(() => ({ innerWidth, scrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth }));
if (mobileLayout.scrollWidth > mobileLayout.innerWidth || mobileLayout.bodyScrollWidth > mobileLayout.innerWidth) throw new Error(`Mobile horizontal overflow: ${JSON.stringify(mobileLayout)}`);
const touchResult = await mobile.evaluate(() => {
  const game = window.__wireTheHouse;
  const shell = document.querySelector('#game-shell');
  const footer = document.querySelector('.page-footer');
  const before = { yaw: game.player.yaw, pitch: game.player.pitch, scrollY };
  const dispatch = (type, x, y) => {
    const event = new PointerEvent(type, { pointerId: 91, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true });
    const accepted = shell.dispatchEvent(event);
    return { accepted, defaultPrevented: event.defaultPrevented };
  };
  const down = dispatch('pointerdown', 260, 300);
  const move = dispatch('pointermove', 215, 235);
  dispatch('pointerup', 215, 235);
  return { before, after: { yaw: game.player.yaw, pitch: game.player.pitch, scrollY }, down, move, shellTouchAction: getComputedStyle(shell).touchAction, footerTouchAction: getComputedStyle(footer).touchAction };
});
if (touchResult.after.pitch === touchResult.before.pitch || touchResult.after.yaw === touchResult.before.yaw) throw new Error('Mobile swipe did not update yaw and pitch');
if (!touchResult.move.defaultPrevented || touchResult.shellTouchAction !== 'none') throw new Error('Game touch-look did not suppress browser scrolling');
if (touchResult.after.scrollY !== touchResult.before.scrollY) throw new Error('Viewport scrolled during game camera swipe');
if (touchResult.footerTouchAction === 'none') throw new Error('Scroll prevention leaked outside the game area');
const mobileBeforeMove = await state(mobile);
await mobile.evaluate(async () => {
  const shell = document.querySelector('#game-shell');
  const joystick = document.querySelector('#joystick');
  const rect = joystick.getBoundingClientRect();
  const dispatch = (target, type, x, y) => target.dispatchEvent(new PointerEvent(type, { pointerId: 92, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
  dispatch(joystick, 'pointerdown', rect.left + rect.width / 2, rect.top + rect.height / 2);
  dispatch(joystick, 'pointermove', rect.left + rect.width / 2, rect.top + rect.height * .2);
  await window.advanceTime(450);
  dispatch(joystick, 'pointerup', rect.left + rect.width / 2, rect.top + rect.height * .2);
});
const mobileAfterMove = await state(mobile);
if (Math.hypot(mobileAfterMove.player.x - mobileBeforeMove.player.x, mobileAfterMove.player.z - mobileBeforeMove.player.z) < 0.2) throw new Error('Mobile joystick did not move the player');
const stuckCheck = await mobile.evaluate(async () => {
  const game = window.__wireTheHouse;
  const joystick = document.querySelector('#joystick');
  const next = document.querySelector('#tool-next');
  const rect = joystick.getBoundingClientRect();
  const dispatch = (target, type, pointerId, x, y) => target.dispatchEvent(new PointerEvent(type, { pointerId, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
  dispatch(joystick, 'pointerdown', 193, rect.left + rect.width / 2, rect.top + rect.height / 2);
  dispatch(joystick, 'pointermove', 193, rect.left + rect.width / 2, rect.top + 8);
  dispatch(next, 'pointerdown', 194, 320, 760);
  const before = game.renderer.camera.position.clone();
  window.advanceTime(500);
  return { distance: before.distanceTo(game.renderer.camera.position), move: { ...game.input.mobileMove }, tool: game.selectedTool };
});
if (stuckCheck.distance > 0.01 || stuckCheck.move.x !== 0 || stuckCheck.move.y !== 0) throw new Error(`Joystick remained stuck after interrupted pointer: ${JSON.stringify(stuckCheck)}`);
await mobileTap(mobile, '#tool-prev');
await aimAtActive(mobile);
await mobileTap(mobile, '#mobile-action');
if ((await state(mobile)).activePoint.stage !== 'marked') throw new Error('Mobile ACTION did not mark the point');
if ((await state(mobile)).workSurface.freeSprayMarks < 1) throw new Error('Free spray did not create a visible wall mark');
const graffiti = await mobile.evaluate(() => {
  const shell = document.querySelector('#game-shell');
  const actionButton = document.querySelector('#mobile-action');
  const dispatch = (target, type, pointerId, x, y) => target.dispatchEvent(new PointerEvent(type, { pointerId, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
  dispatch(actionButton, 'pointerdown', 201, 330, 700);
  dispatch(shell, 'pointerdown', 202, 260, 340);
  for (const [x, y] of [[250, 335], [240, 345], [230, 360], [220, 375]]) {
    dispatch(shell, 'pointermove', 202, x, y);
    window.advanceTime(100);
  }
  dispatch(shell, 'pointerup', 202, 220, 375);
  dispatch(actionButton, 'pointerup', 201, 330, 700);
  return JSON.parse(window.render_game_to_text()).workSurface.freeSprayMarks;
});
if (graffiti < 4) throw new Error(`Held mobile spray did not paint a free stroke: ${graffiti} marks`);
await mobile.screenshot({ path: outputPath('mobile-free-spray.png') });
await mobile.waitForTimeout(800);
if (await mobile.locator('#interaction-prompt.visible').isVisible()) throw new Error('Action notification did not dismiss after its short timeout');
await mobileTap(mobile, '#tool-next');
for (let index = 0; index < 4; index += 1) await mobileTap(mobile, '#mobile-action');
await mobileTap(mobile, '#tool-next');
await aimAtActive(mobile);
await mobileTap(mobile, '#mobile-action');
await mobileTap(mobile, '#mobile-action');
await mobileTap(mobile, '#tool-next');
await mobileTap(mobile, '#mobile-action');
if ((await state(mobile)).activePoint.stage !== 'leveling') throw new Error('Mobile ACTION did not reach leveling mode');
for (let index = 0; index < 3; index += 1) await mobileTap(mobile, '[data-level="left"]');
for (let index = 0; index < 2; index += 1) await mobileTap(mobile, '[data-level="in"]');
const mobileLevel = await state(mobile);
if (!mobileLevel.activePoint.levelPass || !mobileLevel.activePoint.flushPass) throw new Error('Mobile leveling controls did not affect the actual 3D group');
await mobile.screenshot({ path: outputPath('mobile-leveling.png') });
await mobileTap(mobile, '[data-level="confirm"]');
if ((await state(mobile)).activePoint.stage !== 'leveled') throw new Error('Mobile CONFIRM did not pass leveling');
await mobile.screenshot({ path: outputPath('mobile-entry.png') });

await browser.close();
if (errors.length) throw new Error(errors.join('\n'));
console.log(JSON.stringify({ desktop: { movementDeltaZ: Number((afterMove.player.z - beforeMove.player.z).toFixed(2)), pointerLook: true, mouseWheelToolChange: true, missionComplete: complete.mission.complete, points: complete.points }, mobile: { ...touchResult, layout: mobileLayout, joystickDistance: Number(Math.hypot(mobileAfterMove.player.x - mobileBeforeMove.player.x, mobileAfterMove.player.z - mobileBeforeMove.player.z).toFixed(2)), levelingPassed: true } }, null, 2));
