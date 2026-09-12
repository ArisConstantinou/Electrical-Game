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
const mobileAimAction = async page => {
  await page.evaluate(() => {
    const game = window.__wireTheHouse;
    const look = document.querySelector('#look-joystick');
    const rect = look.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const dispatch = (type, pointerId, clientX = x, clientY = y) => look.dispatchEvent(new PointerEvent(type, { pointerId, pointerType: 'touch', clientX, clientY, bubbles: true, cancelable: true }));
    if (game.selectedTool === 'spray' || game.selectedTool === 'hammer') {
      dispatch('pointerdown', 881);
      dispatch('pointermove', 881, x + rect.width * .2, y);
      window.advanceTime(game.selectedTool === 'hammer' ? 260 : 60);
      dispatch('pointerup', 881, x + rect.width * .2, y);
      return;
    }
    dispatch('pointerdown', 881); dispatch('pointerup', 881);
    dispatch('pointerdown', 882); window.advanceTime(34); dispatch('pointerup', 882);
  });
};
const mobileTap = async (page, selector) => {
  await page.locator(selector).tap();
  await page.evaluate(() => window.advanceTime(34));
};
const reachLeveling = async page => {
  const surfaceBeforeChase = (await state(page)).workSurface;
  await page.keyboard.press('Digit3');
  await action(page);
  await page.keyboard.press('Digit4');
  for (let index = 0; index < 4; index += 1) await action(page);
  const chaseComplete = await state(page);
  if (chaseComplete.workSurface.destroyedBricks !== surfaceBeforeChase.destroyedBricks) throw new Error('CHASE destroyed bricks instead of recessing them');
  if (chaseComplete.workSurface.recessedBricks <= surfaceBeforeChase.recessedBricks) throw new Error('CHASE did not create a recessed wall channel');
  if (chaseComplete.activePoint.id === 'A') {
    const destroyedBefore = chaseComplete.workSurface.destroyedBricks;
    await page.keyboard.press('KeyX');
    if ((await state(page)).workSurface.hammerMode !== 'demolish') throw new Error('X did not switch hammer to DEMOLISH');
    await page.evaluate(() => {
      const game = window.__wireTheHouse;
      game.player.yaw += 0.1;
      game.renderer.camera.rotation.set(game.player.pitch, game.player.yaw, 0);
      game.step(1 / 60);
    });
    await action(page);
    const destroyedAfter = (await state(page)).workSurface.destroyedBricks;
    if (destroyedAfter <= destroyedBefore) throw new Error('Demo hammer stopped after the required four mission hits');
    await page.keyboard.press('KeyX');
    await aimAtActive(page);
  }
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

const tallDesktop = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
await tallDesktop.goto(baseUrl, { waitUntil: 'networkidle' });
const tallLayout = await tallDesktop.evaluate(() => {
  const shell = document.querySelector('#game-shell').getBoundingClientRect();
  return { innerHeight, shellHeight: shell.height, shellBottom: shell.bottom, footerCount: document.querySelectorAll('.page-footer').length, scrollHeight: document.documentElement.scrollHeight };
});
if (Math.abs(tallLayout.shellHeight - tallLayout.innerHeight) > 1 || tallLayout.footerCount !== 0 || tallLayout.scrollHeight !== tallLayout.innerHeight) throw new Error(`Tall desktop game does not fill viewport: ${JSON.stringify(tallLayout)}`);
await tallDesktop.screenshot({ path: outputPath('desktop-tall-viewport.png') });
await tallDesktop.close();

const demolition = await browser.newPage({ viewport: { width: 1366, height: 768 } });
await demolition.goto(baseUrl, { waitUntil: 'networkidle' });
await demolition.click('#start-button');
await demolition.waitForTimeout(450);
await demolition.keyboard.press('Digit4');
await demolition.keyboard.press('KeyX');
if ((await state(demolition)).workSurface.hammerMode !== 'demolish') throw new Error('Standalone demolition mode did not activate');
const destroyAtHeight = async targetY => {
  await demolition.evaluate(y => {
    const game = window.__wireTheHouse;
    game.renderer.camera.position.set(0, 1.65, -0.35);
    game.player.yaw = 0;
    game.player.pitch = Math.atan2(y - 1.65, 2.06);
    game.renderer.camera.rotation.set(game.player.pitch, 0, 0);
    game.step(1 / 60);
  }, targetY);
  const before = (await state(demolition)).workSurface.destroyedBricks;
  await leftClickAction(demolition);
  const after = (await state(demolition)).workSurface.destroyedBricks;
  if (after <= before) throw new Error(`Demo hammer could not destroy brick at wall height ${targetY}`);
};
await destroyAtHeight(2.93);
await destroyAtHeight(0.07);
await demolition.evaluate(() => {
  const game = window.__wireTheHouse;
  game.renderer.camera.position.set(0, 1.5, 0.2);
  game.player.yaw = 0;
  game.player.pitch = 0;
  game.renderer.camera.rotation.set(0, 0, 0);
  game.step(1 / 60);
});
await demolition.screenshot({ path: outputPath('desktop-top-bottom-demolition.png') });
const fullWallResult = await demolition.evaluate(() => {
  const game = window.__wireTheHouse;
  const wall = game.room.brickWall;
  const camera = game.renderer.camera;
  camera.position.set(0, 1.5, 0.2);
  let pass = 0;
  let previous = -1;
  while (pass < 4 && wall.destroyedBrickCount !== previous) {
    previous = wall.destroyedBrickCount;
    for (let row = 0; row < 23; row += 1) {
      for (let col = 0; col < 21; col += 1) {
        const x = -3 + (6 / 21) / 2 + col * (6 / 21) + (row % 2 ? (6 / 21) / 2 : 0);
        if (x > 2.98) continue;
        const y = (3 / 23) / 2 + row * (3 / 23);
        camera.lookAt(x, y, -2.5);
        camera.updateMatrixWorld(true);
        wall.removeAtAim(camera);
      }
    }
    pass += 1;
  }
  return { destroyed: wall.destroyedBrickCount, passes: pass };
});
if (fullWallResult.destroyed !== 472) throw new Error(`Not every wall brick can be destroyed: ${JSON.stringify(fullWallResult)}`);
await demolition.screenshot({ path: outputPath('desktop-full-wall-demolished.png') });
await demolition.close();

const desktop = await browser.newPage({ viewport: { width: 1366, height: 768 } });
desktop.on('console', message => { if (message.type() === 'error') errors.push(`desktop console: ${message.text()}`); });
desktop.on('pageerror', error => errors.push(`desktop page: ${error.message}`));
const response = await desktop.goto(baseUrl, { waitUntil: 'networkidle' });
if (!response?.ok()) throw new Error(`Route did not load: ${response?.status()}`);
await desktop.click('#start-button');
await desktop.waitForTimeout(450);
if (!await desktop.locator('#desktop-key-guide').isVisible()) throw new Error('Desktop key guide is not visible during gameplay');
const keyGuideText = await desktop.locator('#desktop-key-guide').innerText();
for (const required of ['WASD', 'LMB', 'E', 'WHEEL', '1–6', 'V', 'C', 'X', 'F', 'ESC']) {
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
if (liveMarksAfter - liveMarksBefore < 5) throw new Error(`LIVE spray did not record a continuous held stroke: ${liveMarksAfter - liveMarksBefore} samples`);
await desktop.keyboard.press('Digit4');
await aimAtActive(desktop);
await desktop.mouse.down({ button: 'left' });
await desktop.evaluate(() => window.advanceTime(800));
await desktop.mouse.up({ button: 'left' });
if ((await state(desktop)).activePoint.stage !== 'chased') throw new Error(`Holding desktop left mouse did not repeatedly use the hammer: ${JSON.stringify(await state(desktop))}`);
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
  if (id === 'A') {
    const pointerLocked = await desktop.evaluate(() => Boolean(document.pointerLockElement));
    if (pointerLocked) throw new Error('Pointer lock was not released when leveling opened');
    const tiltBeforeButtons = (await state(desktop)).activePoint.tiltDegrees;
    await desktop.locator('[data-level="left"]').click();
    const tiltAfterLeft = (await state(desktop)).activePoint.tiltDegrees;
    if (tiltAfterLeft >= tiltBeforeButtons) throw new Error('LEFT leveling button is not clickable');
    await desktop.locator('[data-level="right"]').click();
    const tiltAfterRight = (await state(desktop)).activePoint.tiltDegrees;
    if (Math.abs(tiltAfterRight - tiltBeforeButtons) > 0.01) throw new Error('RIGHT leveling button is not clickable');
    await desktop.mouse.click(700, 400, { button: 'right' });
    await desktop.evaluate(() => window.advanceTime(34));
    if ((await state(desktop)).activePoint.stage !== 'mortared') throw new Error('Right mouse did not exit leveling mode');
    await aimAtActive(desktop);
    await action(desktop);
    if ((await state(desktop)).activePoint.stage !== 'leveling') throw new Error('Could not resume leveling after right-mouse exit');
  }
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
for (const selector of ['#joystick', '#look-joystick', '[data-tool="spray"]', '[data-tool="hammer"]', '[data-tool="fitting"]', '[data-tool="level"]', '[data-tool="spring"]', '[data-tool="cutter"]', '#settings-toggle', '#tool-mode-toggle']) {
  const box = await mobile.locator(selector).boundingBox();
  if (!box || box.width < 44 || box.height < 44) throw new Error(`${selector} is below the 44px touch target`);
}
if (await mobile.locator('button#mobile-action, #tool-prev, #tool-next').count()) throw new Error('Legacy mobile ACTION or previous/next tool buttons still exist');
if (await mobile.locator('#tool-status').isVisible()) throw new Error('Selected-tool badge still overlaps the right joystick');
await mobileTap(mobile, '#tool-mode-toggle');
if ((await state(mobile)).workSurface.sprayMode !== 'dots') throw new Error('Context mode button did not select DOTS');
await mobileTap(mobile, '#tool-mode-toggle');
if ((await state(mobile)).workSurface.sprayMode !== 'live') throw new Error('Context mode button did not restore LIVE');
if (await mobile.locator('#settings-panel').isVisible()) throw new Error('Settings panel covers gameplay before it is opened');
await mobileTap(mobile, '#settings-toggle');
await mobile.waitForTimeout(220);
if (!await mobile.locator('#settings-panel').isVisible()) throw new Error('Settings icon did not open the settings panel');
for (const selector of ['#spray-color', '#aim-input-mode', '#aim-control-mode', '#aim-speed', '#wall-assist', '#settings-close']) {
  const box = await mobile.locator(selector).boundingBox();
  if (!box || box.width < 44 || box.height < 44) throw new Error(`${selector} is below the 44px settings touch target`);
}
await mobileTap(mobile, '#spray-color');
await mobileTap(mobile, '#aim-input-mode');
if ((await state(mobile)).workSurface.aimInputMode !== 'stick') throw new Error('Settings did not expose the classic velocity stick fallback');
await mobileTap(mobile, '#aim-input-mode');
if ((await state(mobile)).workSurface.aimInputMode !== 'drag') throw new Error('Settings did not restore direct drag aiming');
await mobileTap(mobile, '#aim-control-mode');
if ((await state(mobile)).workSurface.aimControlMode !== 'double-tap') throw new Error('Settings did not retain classic 2× HOLD aim control');
await mobileTap(mobile, '#aim-control-mode');
for (const expected of ['fast', 'precise', 'normal']) {
  await mobileTap(mobile, '#aim-speed');
  if ((await state(mobile)).workSurface.aimProfile !== expected) throw new Error(`Aim speed did not cycle to ${expected}`);
}
await mobileTap(mobile, '#wall-assist');
if ((await state(mobile)).workSurface.wallAssist !== false) throw new Error('Wall precision assist did not switch off');
await mobileTap(mobile, '#wall-assist');
const mobileSpraySettings = await state(mobile);
if (mobileSpraySettings.workSurface.sprayMode !== 'live' || mobileSpraySettings.workSurface.sprayColor !== 'RED' || mobileSpraySettings.workSurface.aimControlMode !== 'auto-use') throw new Error(`Mobile settings did not change: ${JSON.stringify(mobileSpraySettings.workSurface)}`);
await mobile.screenshot({ path: outputPath('mobile-spray-controls.png') });
await mobileTap(mobile, '#settings-close');
if (await mobile.locator('#settings-panel').isVisible()) throw new Error('Settings close button did not dismiss the panel');
await mobileTap(mobile, '[data-tool="hammer"]');
if (!await mobile.locator('#tool-mode-toggle').isVisible() || !((await mobile.locator('#tool-mode-toggle').innerText()).includes('CHASE'))) throw new Error('Hammer contextual CHASE mode is not visible');
await mobileTap(mobile, '#tool-mode-toggle');
if ((await state(mobile)).workSurface.hammerMode !== 'demolish') throw new Error('Context mode button did not select DEMOLISH');
await mobileTap(mobile, '#tool-mode-toggle');
await mobileTap(mobile, '[data-tool="spray"]');
const proximityAssist = await mobile.evaluate(() => {
  const game = window.__wireTheHouse;
  const sample = distance => {
    game.renderer.camera.position.z = -2.41 + distance;
    game.player.yaw = 0;
    game.player.pitch = 0;
    game.input.resetMobileLook();
    game.player.update(0);
    game.player.lookMobileDrag(100, 100);
    return { yaw: Math.abs(game.player.yaw), pitch: Math.abs(game.player.pitch), assist: game.player.wallAssistAmount };
  };
  const far = sample(2.1);
  const near = sample(.72);
  game.input.resetMobileLook();
  return { far, near };
});
if (proximityAssist.far.assist > .1 || proximityAssist.near.assist < .7 || proximityAssist.near.yaw >= proximityAssist.far.yaw * .75 || proximityAssist.near.pitch >= proximityAssist.far.pitch * .75) throw new Error(`Wall proximity did not blend into precision aiming: ${JSON.stringify(proximityAssist)}`);
const mobileLayout = await mobile.evaluate(() => {
  const shell = document.querySelector('#game-shell').getBoundingClientRect();
  return { innerWidth, innerHeight, scrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth, scrollHeight: document.documentElement.scrollHeight, shellHeight: shell.height, footerCount: document.querySelectorAll('.page-footer').length };
});
if (mobileLayout.scrollWidth > mobileLayout.innerWidth || mobileLayout.bodyScrollWidth > mobileLayout.innerWidth || mobileLayout.scrollHeight !== mobileLayout.innerHeight || Math.abs(mobileLayout.shellHeight - mobileLayout.innerHeight) > 1 || mobileLayout.footerCount !== 0) throw new Error(`Mobile viewport is clipped or overflowing: ${JSON.stringify(mobileLayout)}`);
const touchResult = await mobile.evaluate(() => {
  const game = window.__wireTheHouse;
  const shell = document.querySelector('#game-shell');
  const before = { yaw: game.player.yaw, pitch: game.player.pitch, scrollY };
  const dispatch = (type, x, y) => {
    const event = new PointerEvent(type, { pointerId: 91, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true });
    const accepted = shell.dispatchEvent(event);
    return { accepted, defaultPrevented: event.defaultPrevented };
  };
  const down = dispatch('pointerdown', 260, 300);
  const move = dispatch('pointermove', 215, 235);
  dispatch('pointerup', 215, 235);
  return { before, after: { yaw: game.player.yaw, pitch: game.player.pitch, scrollY }, down, move, shellTouchAction: getComputedStyle(shell).touchAction };
});
if (touchResult.after.pitch === touchResult.before.pitch || touchResult.after.yaw === touchResult.before.yaw) throw new Error('Mobile swipe did not update yaw and pitch');
const mobileButtonStyles = await mobile.evaluate(() => {
  const button = document.querySelector('[data-tool="spray"]');
  const style = getComputedStyle(button);
  const child = button.querySelector('span');
  const childStyle = getComputedStyle(child);
  const selectEvent = new Event('selectstart', { bubbles: true, cancelable: true });
  child.dispatchEvent(selectEvent);
  return { tapHighlight: style.webkitTapHighlightColor, userSelect: style.userSelect, webkitUserSelect: style.webkitUserSelect, childUserSelect: childStyle.userSelect, childWebkitUserSelect: childStyle.webkitUserSelect, touchCallout: childStyle.webkitTouchCallout || 'unsupported', touchAction: style.touchAction, selectPrevented: selectEvent.defaultPrevented };
});
if (!['rgba(0, 0, 0, 0)', 'transparent'].includes(mobileButtonStyles.tapHighlight) || mobileButtonStyles.userSelect !== 'none' || mobileButtonStyles.webkitUserSelect !== 'none' || mobileButtonStyles.childUserSelect !== 'none' || mobileButtonStyles.childWebkitUserSelect !== 'none' || !['none', 'unsupported'].includes(mobileButtonStyles.touchCallout) || mobileButtonStyles.touchAction !== 'manipulation' || !mobileButtonStyles.selectPrevented) throw new Error(`Game UI allows browser highlight or selection: ${JSON.stringify(mobileButtonStyles)}`);
await aimAtActive(mobile);
const autoAimUse = await mobile.evaluate(() => {
  const game = window.__wireTheHouse;
  const shell = document.querySelector('#look-joystick');
  window.dispatchEvent(new CustomEvent('wirehouse:select-tool', { detail: 'spray' }));
  const rect = shell.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const dispatch = (type, pointerId, clientX, clientY) => shell.dispatchEvent(new PointerEvent(type, { pointerId, pointerType: 'touch', clientX, clientY, bubbles: true, cancelable: true }));
  const marksBefore = JSON.parse(window.render_game_to_text()).workSurface.freeSprayMarks;
  dispatch('pointerdown', 172, x, y);
  const yawBefore = game.player.yaw;
  dispatch('pointermove', 172, x - rect.width * .4, y + rect.height * .08);
  const heldImmediately = game.input.actionHeld;
  const yawAfterMove = game.player.yaw;
  window.advanceTime(360);
  const during = { held: game.input.actionHeld, yaw: game.player.yaw, yawDrift: Math.abs(game.player.yaw - yawAfterMove), marks: JSON.parse(window.render_game_to_text()).workSurface.freeSprayMarks };
  dispatch('pointerup', 172, x - rect.width * .4, y + rect.height * .08);
  return { marksBefore, yawBefore, heldImmediately, during, heldAfter: game.input.actionHeld, inputMode: game.aimInputMode, thumbDisplay: getComputedStyle(document.querySelector('#look-joystick-thumb')).display };
});
if (autoAimUse.inputMode !== 'drag' || autoAimUse.thumbDisplay !== 'none' || !autoAimUse.heldImmediately || !autoAimUse.during.held || autoAimUse.heldAfter || Math.abs(autoAimUse.during.yaw - autoAimUse.yawBefore) < 0.05 || autoAimUse.during.yawDrift > 0.001 || autoAimUse.during.marks <= autoAimUse.marksBefore) throw new Error(`Direct drag aim did not track and stop with the finger: ${JSON.stringify(autoAimUse)}`);
if (!touchResult.move.defaultPrevented || touchResult.shellTouchAction !== 'none') throw new Error('Game touch-look did not suppress browser scrolling');
if (touchResult.after.scrollY !== touchResult.before.scrollY) throw new Error('Viewport scrolled during game camera swipe');
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
const dualStickCheck = await mobile.evaluate(() => {
  const game = window.__wireTheHouse;
  const move = document.querySelector('#joystick');
  const look = document.querySelector('#look-joystick');
  const moveRect = move.getBoundingClientRect();
  const lookRect = look.getBoundingClientRect();
  const dispatch = (target, type, pointerId, x, y) => target.dispatchEvent(new PointerEvent(type, { pointerId, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
  const before = { position: game.renderer.camera.position.clone(), yaw: game.player.yaw, marks: JSON.parse(window.render_game_to_text()).workSurface.freeSprayMarks };
  dispatch(move, 'pointerdown', 191, moveRect.left + moveRect.width / 2, moveRect.top + moveRect.height / 2);
  dispatch(move, 'pointermove', 191, moveRect.left + moveRect.width / 2, moveRect.top + 8);
  dispatch(look, 'pointerdown', 192, lookRect.left + lookRect.width / 2, lookRect.top + lookRect.height / 2);
  dispatch(look, 'pointermove', 192, lookRect.right - 8, lookRect.top + lookRect.height / 2);
  window.advanceTime(400);
  const active = { distance: before.position.distanceTo(game.renderer.camera.position), yawDelta: Math.abs(game.player.yaw - before.yaw), move: { ...game.input.mobileMove }, look: { ...game.input.mobileLook }, held: game.input.actionHeld, sprayMarks: JSON.parse(window.render_game_to_text()).workSurface.freeSprayMarks - before.marks };
  dispatch(move, 'pointerup', 191, moveRect.left + moveRect.width / 2, moveRect.top + 8);
  dispatch(look, 'pointerup', 192, lookRect.right - 8, lookRect.top + lookRect.height / 2);
  return { active, released: { move: { ...game.input.mobileMove }, look: { ...game.input.mobileLook } } };
});
if (dualStickCheck.active.distance < 0.2 || dualStickCheck.active.yawDelta < 0.1 || dualStickCheck.active.move.y === 0 || !dualStickCheck.active.held || dualStickCheck.active.sprayMarks < 1) throw new Error(`Move joystick plus drag aim did not produce simultaneous move, aim, and spray: ${JSON.stringify(dualStickCheck)}`);
if (dualStickCheck.released.move.x !== 0 || dualStickCheck.released.move.y !== 0 || dualStickCheck.released.look.x !== 0 || dualStickCheck.released.look.y !== 0) throw new Error(`Dual joysticks did not reset independently: ${JSON.stringify(dualStickCheck)}`);
const simultaneousToolCheck = await mobile.evaluate(async () => {
  const game = window.__wireTheHouse;
  const joystick = document.querySelector('#joystick');
  const next = document.querySelector('[data-tool="hammer"]');
  const rect = joystick.getBoundingClientRect();
  const dispatch = (target, type, pointerId, x, y) => target.dispatchEvent(new PointerEvent(type, { pointerId, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
  dispatch(joystick, 'pointerdown', 193, rect.left + rect.width / 2, rect.top + rect.height / 2);
  dispatch(joystick, 'pointermove', 193, rect.left + rect.width / 2, rect.top + 8);
  dispatch(next, 'pointerdown', 194, 320, 760);
  const before = game.renderer.camera.position.clone();
  window.advanceTime(500);
  const whilePressed = { distance: before.distanceTo(game.renderer.camera.position), move: { ...game.input.mobileMove }, tool: game.selectedTool };
  dispatch(next, 'pointerup', 194, 320, 760);
  dispatch(joystick, 'pointerup', 193, rect.left + rect.width / 2, rect.top + 8);
  return { whilePressed, afterRelease: { ...game.input.mobileMove } };
});
if (simultaneousToolCheck.whilePressed.distance < 0.02 || simultaneousToolCheck.whilePressed.move.y === 0) throw new Error(`Tool press interrupted joystick movement: ${JSON.stringify(simultaneousToolCheck)}`);
if (simultaneousToolCheck.afterRelease.x !== 0 || simultaneousToolCheck.afterRelease.y !== 0) throw new Error(`Joystick did not reset after its own pointer ended: ${JSON.stringify(simultaneousToolCheck)}`);
await mobileTap(mobile, '[data-tool="spray"]');
await aimAtActive(mobile);
await mobileAimAction(mobile);
if ((await state(mobile)).activePoint.stage !== 'marked') throw new Error('Mobile ACTION did not mark the point');
if ((await state(mobile)).workSurface.freeSprayMarks < 1) throw new Error('Free spray did not create a visible wall mark');
const graffiti = await mobile.evaluate(() => {
  const look = document.querySelector('#look-joystick');
  const rect = look.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const dispatch = (target, type, pointerId, x, y) => target.dispatchEvent(new PointerEvent(type, { pointerId, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
  dispatch(look, 'pointerdown', 201, centerX, centerY);
  dispatch(look, 'pointerup', 201, centerX, centerY);
  dispatch(look, 'pointerdown', 202, centerX, centerY);
  for (const [x, y] of [[.12, -.08], [.2, -.12], [.28, -.16], [.34, -.18]]) {
    dispatch(look, 'pointermove', 202, centerX + rect.width * x, centerY + rect.height * y);
    window.advanceTime(100);
  }
  dispatch(look, 'pointerup', 202, centerX + rect.width * .34, centerY - rect.height * .18);
  return JSON.parse(window.render_game_to_text()).workSurface.freeSprayMarks;
});
if (graffiti < 4) throw new Error(`Held mobile spray did not paint a free stroke: ${graffiti} marks`);
await mobile.screenshot({ path: outputPath('mobile-free-spray.png') });
await mobile.waitForTimeout(800);
if (await mobile.locator('#interaction-prompt.visible').isVisible()) throw new Error('Action notification did not dismiss after its short timeout');
await mobileTap(mobile, '[data-tool="hammer"]');
await aimAtActive(mobile);
for (let index = 0; index < 4; index += 1) await mobileAimAction(mobile);
await mobileTap(mobile, '[data-tool="fitting"]');
if (await mobile.locator('#tool-mode-toggle').isVisible() || await mobile.locator('#tool-status').isVisible()) throw new Error('FITTING or an irrelevant mode button still overlaps the right joystick');
await aimAtActive(mobile);
await mobileAimAction(mobile);
await mobileAimAction(mobile);
await mobileTap(mobile, '[data-tool="level"]');
await mobileAimAction(mobile);
if ((await state(mobile)).activePoint.stage !== 'leveling') throw new Error(`Mobile AIM center action did not reach leveling mode: ${JSON.stringify(await state(mobile))}`);
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
console.log(JSON.stringify({ desktop: { movementDeltaZ: Number((afterMove.player.z - beforeMove.player.z).toFixed(2)), pointerLook: true, mouseWheelToolChange: true, missionComplete: complete.mission.complete, points: complete.points }, mobile: { ...touchResult, layout: mobileLayout, aimInput: autoAimUse.inputMode, dragYawDrift: autoAimUse.during.yawDrift, joystickDistance: Number(Math.hypot(mobileAfterMove.player.x - mobileBeforeMove.player.x, mobileAfterMove.player.z - mobileBeforeMove.player.z).toFixed(2)), autoUseImmediate: autoAimUse.heldImmediately, simultaneousSprayMarks: dualStickCheck.active.sprayMarks, proximityAssist, levelingPassed: true } }, null, 2));
