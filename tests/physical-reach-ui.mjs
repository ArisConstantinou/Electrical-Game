import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const url = process.argv[2] ?? 'http://127.0.0.1:5362/Electrical-Game/';
const out = process.argv[3] ?? 'output/physical-reach-ui';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { url, mobileIsEmulation: true, fixture: 'Initial camera placements and pose sweeps are diagnostic fixtures. Walking, tool selection and hammer strikes use native keyboard/touch input.', scenarios: [] };
const read = page => page.evaluate(() => JSON.parse(window.render_game_to_text()));
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const click = (page, mobile, selector) => page.locator(selector)[mobile ? 'tap' : 'click']();
const keys = { spray: 'Digit3', hammer: 'Digit4', fitting: 'Digit5', level: 'Digit6', spring: 'Digit1', cutter: 'Digit2', trowel: 'Digit7', hose: 'Digit8' };
async function aim(page, { x = .8, z = -.45, targetX = x, targetY = 1.5, crouched = false } = {}) {
  await page.evaluate(p => {
    const g = window.__wireTheHouse, camera = g.renderer.camera;
    g.hammerWorkStance.restore(camera); g.player.crouched = p.crouched;
    camera.position.set(p.x, g.player.eyeHeight, p.z);
    camera.lookAt(p.targetX, p.targetY, g.room.brickWall.volume.frontZ);
    g.player.yaw = camera.rotation.y; g.player.pitch = camera.rotation.x;
    camera.updateMatrixWorld(true); g.step(0);
  }, { x, z, targetX, targetY, crouched });
}
function validatePose(pose, label) {
  assert.equal(pose.arms.length, 2, `${label}: both body arms should remain present`);
  for (const arm of pose.arms) {
    for (const vector of [arm.shoulder, arm.elbow, arm.wrist, arm.grip]) assert(vector.length === 3 && vector.every(Number.isFinite), `${label}: invalid joint transform`);
    assert(Math.abs(distance(arm.shoulder, arm.elbow) - .31) < 1e-5, `${label}: upper arm stretched`);
    assert(Math.abs(distance(arm.elbow, arm.wrist) - .27) < 1e-5, `${label}: forearm stretched`);
    assert.equal(arm.fingers, 5, `${label}: hand needs four fingers and a thumb`);
    if (arm.gripping) assert(distance(arm.wrist, arm.grip) <= .10, `${label}: hand detached from tool grip`);
  }
}
async function shot(page, name) {
  await page.evaluate(async () => { const g = window.__wireTheHouse; g.step(0); await g.renderer.waitForFrame(); g.renderer.render(); await g.renderer.waitForFrame(); });
  await page.screenshot({ path: `${out}/${name}.png` });
}
async function hold(page, mobile, frames = 70) {
  let cdp;
  if (mobile) {
    cdp = await page.context().newCDPSession(page);
    const r = await page.locator('#look-joystick').boundingBox(); assert(r);
    const p = { x: r.x + r.width / 2, y: r.y + r.height / 2, id: 9 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
  } else await page.keyboard.down('KeyE');
  await page.waitForFunction(() => window.__wireTheHouse.input.actionHeld);
  const samples = await page.evaluate(n => {
    const g = window.__wireTheHouse, samples = [];
    for (let i = 0; i < n; i++) { g.step(1 / 60); samples.push(g.fpsRig.debugPose()); }
    return samples;
  }, frames);
  if (mobile) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach(); }
  else await page.keyboard.up('KeyE');
  assert.equal(await page.evaluate(() => window.__wireTheHouse.input.actionHeld), false, 'Release must stop hammering');
  samples.forEach((p, i) => validatePose(p, `held ${i}`));
  return samples;
}
try {
  for (const platform of [
    { name: 'desktop', width: 1366, height: 768, mobile: false },
    { name: 'mobile', width: 390, height: 844, mobile: true },
    { name: 'landscape', width: 844, height: 390, mobile: true },
  ]) {
    const { name, width, height, mobile } = platform;
    const page = await browser.newPage({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(url); await page.waitForFunction(() => window.__wireTheHouse);
    await click(page, mobile, '#start-button'); await page.evaluate(() => document.exitPointerLock());
    if (mobile) {
      await click(page, true, '[data-tool="hammer"]');
      await click(page, true, '#settings-toggle');
      await click(page, true, '#aim-control-mode');
      await click(page, true, '#settings-close');
    } else await page.keyboard.press(keys.hammer);
    await aim(page);
    const farBefore = await read(page);
    const farSamples = await hold(page, mobile);
    const farAfter = await read(page);
    assert.equal(farAfter.workSurface.impactCount, farBefore.workSurface.impactCount, `${name}: hammer hit from almost two metres away`);
    assert.equal(farAfter.workSurface.removedNodes, farBefore.workSurface.removedNodes, `${name}: far action removed masonry`);
    assert(farSamples.every(p => !p.reachable), `${name}: distant wall accepted by physical reach solver`);
    await shot(page, `${name}-far-resting-arms`);
    if (mobile) await click(page, true, '[data-tool="fitting"]'); else await page.keyboard.press(keys.fitting);
    const distantBoxBefore = await page.evaluate(() => {
      const p = window.__wireTheHouse.mission.activePoint;
      return { position: p.position.toArray(), definition: { ...p.definition }, visible: p.boxGroup.visible };
    });
    await hold(page, mobile, 20);
    const distantBoxAfter = await page.evaluate(() => {
      const p = window.__wireTheHouse.mission.activePoint;
      return { position: p.position.toArray(), definition: { ...p.definition }, visible: p.boxGroup.visible };
    });
    assert.deepEqual(distantBoxAfter, distantBoxBefore, `${name}: fitting a box modified a distant work point`);
    if (mobile) await click(page, true, '[data-tool="hammer"]'); else await page.keyboard.press(keys.hammer);
    // Actual forward input must let the player close the distance; no camera
    // teleport or unbounded arm extension substitutes for walking here.
    let movementSession;
    if (mobile) {
      movementSession = await page.context().newCDPSession(page);
      const r = await page.locator('#joystick').boundingBox(); assert(r);
      await movementSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x + r.width / 2, y: r.y + r.height * .12, id: 3 }] });
    } else await page.keyboard.down('KeyW');
    await page.evaluate(() => {
      const g = window.__wireTheHouse;
      for (let i = 0; i < 150 && g.renderer.camera.position.z > -1.59; i++) g.step(1 / 60);
    });
    if (mobile) { await movementSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await movementSession.detach(); }
    else await page.keyboard.up('KeyW');
    const afterWalk = await read(page);
    assert(afterWalk.player.z < farAfter.player.z - .9, `${name}: real walking did not close the gap`);
    // Re-aim after walking, preserving the position reached by native movement.
    await aim(page, { x: afterWalk.player.x, z: afterWalk.player.z, targetY: 1.30 });
    const nearBefore = await read(page);
    const nearSamples = await hold(page, mobile);
    const nearAfter = await read(page);
    assert(nearAfter.workSurface.impactCount > nearBefore.workSurface.impactCount, `${name}: reachable wall received no strikes`);
    assert(nearSamples.some(p => p.reachable), `${name}: normal close hammer pose rejected`);
    await shot(page, `${name}-close-hammer`);
    const poses = [];
    for (const configuration of [
      { targetY: 1.3, tilt: 0, side: 0 }, { targetY: 1.3, tilt: 25, side: -35 },
      { targetY: 1.3, tilt: 25, side: 35 }, { targetY: 1.3, tilt: -25, side: 0 },
      { targetY: 2.95, tilt: 25, side: 0 }, { targetY: .65, tilt: 25, side: 0, crouched: true },
    ]) {
      await page.evaluate(p => { const w = window.__wireTheHouse.room.brickWall; w.chiselTiltDegrees = p.tilt; w.chiselSideDegrees = p.side; }, configuration);
      await aim(page, { z: -1.59, ...configuration });
      const pose = await page.evaluate(() => { const g = window.__wireTheHouse; for (let i = 0; i < 40; i++) g.step(1 / 60); return { ...g.fpsRig.debugPose(), stanceOffset: g.hammerWorkStance.offset.toArray() }; });
      validatePose(pose, `${name} stance ${JSON.stringify(configuration)}`);
      assert(Math.hypot(...pose.stanceOffset) <= .48, `${name}: stance exceeded the bounded torso/head lean`);
      if (configuration.targetY === 2.95) {
        assert.equal(pose.reachable, false, 'Ceiling-height wall must require a higher body position');
        const before = await read(page); await hold(page, mobile); const after = await read(page);
        assert.equal(after.workSurface.impactCount, before.workSurface.impactCount, 'Looking upward extended body reach to top of wall');
      }
      poses.push({ configuration, pose });
      await shot(page, `${name}-stance-${poses.length}`);
    }
    await page.evaluate(() => { const w = window.__wireTheHouse.room.brickWall; w.chiselTiltDegrees = 25; w.chiselSideDegrees = 0; });
    await aim(page, { z: -1.96, targetY: 1.3 });
    const tooCloseBefore = await read(page); const tooClosePoses = await hold(page, mobile); const tooCloseAfter = await read(page);
    assert.equal(tooCloseAfter.workPosition.locked, true, `${name}: close approach did not enter the work stance`);
    assert(Math.abs(tooCloseAfter.workPosition.distanceM-tooCloseAfter.workPosition.targetDistanceM)<.005, `${name}: close approach failed to settle at working distance`);
    assert(tooClosePoses.some(p=>p.reachable), `${name}: settled stance cannot work`);
    assert(tooCloseAfter.workSurface.impactCount>tooCloseBefore.workSurface.impactCount, `${name}: settled stance received no strikes`);
    await shot(page, `${name}-too-close-settled`);
    await aim(page, { z: -1.59, targetY: 1.3 });
    const toolPoses = [];
    for (const tool of Object.keys(keys)) {
      if (mobile) await click(page, true, `[data-tool="${tool}"]`); else await page.keyboard.press(keys[tool]);
      await page.waitForTimeout(100);
      const pose = await page.evaluate(() => {
        const g = window.__wireTheHouse; g.step(0); const pose = g.fpsRig.debugPose();
        return { ...pose, gripProjection: pose.arms.map(a => g.renderer.camera.position.clone().fromArray(a.grip).project(g.renderer.camera).toArray()) };
      });
      assert.equal(pose.tool, tool); validatePose(pose, `${name} ${tool}`);
      assert(pose.arms.some(a => a.gripping), `${tool}: neither hand grips the tool`);
      if (tool === 'trowel') {
        // The wrist must follow the real swing while the upper/lower bones
        // keep their lengths; a convincing static hand pose is insufficient.
        const swing = await hold(page, mobile, 35);
        assert(swing.some(s => distance(s.arms[0].grip, pose.arms[0].grip) > .005), `${name}: trowel swing did not move its gripping hand`);
        pose.swingGripTravel = Math.max(...swing.map(s => distance(s.arms[0].grip, pose.arms[0].grip)));
      }
      toolPoses.push(pose); await shot(page, `${name}-tool-${tool}`);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight), false, `${name}: page overflow`);
    assert.deepEqual(errors, []);
    report.scenarios.push({ platform, farImpacts: farAfter.workSurface.impactCount - farBefore.workSurface.impactCount, distantBoxUnchanged: true, walkedMetres: farAfter.player.z - afterWalk.player.z, nearImpacts: nearAfter.workSurface.impactCount - nearBefore.workSurface.impactCount, farPose: farSamples[0], nearPose: nearSamples.at(-1), poses, toolPoses, errors });
    await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); await page.close();
  }
  report.passed = true; await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log('PASS: body-limited reach, native walk-to-work, distant/high wall rejection, fixed arm lengths and five-finger grips across all tools on desktop/mobile/landscape.');
} finally { await browser.close(); }
