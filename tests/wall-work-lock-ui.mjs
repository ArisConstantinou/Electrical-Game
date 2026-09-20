import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const url = process.argv[2] ?? 'http://127.0.0.1:5365/Electrical-Game/';
const out = process.argv[3] ?? 'output/wall-work-lock-ui';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { url, mobileIsEmulation: true, fixture: 'Only initial camera placement/re-aim is diagnostic. Walking, release, hammer strokes, tiny aim drags and settings use native keyboard/pointer/touch input.', scenarios: [] };
const read = page => page.evaluate(() => JSON.parse(window.render_game_to_text()));
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const click = (page, mobile, selector) => page.locator(selector)[mobile ? 'tap' : 'click']();
async function step(page, frames) { return page.evaluate(n => { const g = window.__wireTheHouse; for (let i = 0; i < n; i++) g.step(1 / 60); return JSON.parse(g.renderState()); }, frames); }
async function aim(page, initial = false) {
  await page.evaluate(initial => {
    const g = window.__wireTheHouse, c = g.renderer.camera;
    g.hammerWorkStance.restore(c);
    if (initial) c.position.set(-.8, g.player.eyeHeight, -.45);
    c.lookAt(c.position.x, 1.3, g.room.brickWall.volume.frontZ);
    g.player.yaw = c.rotation.y; g.player.pitch = c.rotation.x;
    c.updateMatrixWorld(true); g.step(0);
  }, initial);
}
function checkArms(pose) {
  assert.equal(pose.arms.length, 2);
  for (const a of pose.arms) {
    assert(Math.abs(distance(a.shoulder, a.elbow) - a.upperLengthM) < 1e-5, 'Upper arm stretched');
    assert(Math.abs(distance(a.elbow, a.wrist) - a.forearmLengthM) < 1e-5, 'Forearm stretched');
    assert.equal(a.fingers, 5);
  }
}
async function gripAnchors(page) {
  return page.evaluate(() => {
    const g = window.__wireTheHouse, h = g.fpsRig.getObjectByName('FPS hammer tool');
    return {
      rear: h.localToWorld(g.fpsRig.chiselTipWorld.clone().fromArray(h.userData.gripPoint)).toArray(),
      auxiliary: h.localToWorld(g.fpsRig.chiselTipWorld.clone().fromArray(h.userData.secondaryGripPoint)).toArray(),
    };
  });
}
function checkGripRoles(body, anchors, degrees) {
  for (const arm of body.arms) {
    const expected = (degrees > 0 ? arm.side < 0 : arm.side > 0) ? 'rear' : 'auxiliary';
    assert.equal(arm.gripRole, expected, `${degrees} degrees: wrong grip for ${arm.side < 0 ? 'left' : 'right'} hand`);
    assert.equal(arm.gripping, true, 'Settled hand must hold its tool');
    assert(distance(arm.grip, anchors[expected]) < 1e-5, 'Hand is detached from its authored handle anchor');
  }
}
async function touch(page, selector, x = .5, y = .5) {
  const session = await page.context().newCDPSession(page), r = await page.locator(selector).boundingBox(); assert(r);
  const p = { x: r.x + r.width * x, y: r.y + r.height * y, id: 4 };
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
  return { session, p, end: async () => { await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await session.detach(); } };
}
async function move(page, mobile, direction) {
  if (mobile) return (await touch(page, '#joystick', direction === 'right' ? .88 : .5, direction === 'forward' ? .12 : direction === 'back' ? .88 : .5)).end;
  const key = { forward: 'KeyW', back: 'KeyS', right: 'KeyD' }[direction];
  await page.keyboard.down(key); return () => page.keyboard.up(key);
}
async function hammer(page, mobile, frames = 60) {
  let end;
  if (mobile) {
    const first = await touch(page, '#look-joystick'); await first.end();
    const second = await touch(page, '#look-joystick'); end = second.end;
  } else { await page.keyboard.down('KeyE'); end = () => page.keyboard.up('KeyE'); }
  await page.waitForFunction(() => window.__wireTheHouse.input.actionHeld);
  const result = await step(page, frames); await end();
  assert.equal(await page.evaluate(() => window.__wireTheHouse.input.actionHeld), false);
  return result;
}
async function shot(page, name) {
  await page.evaluate(async () => { const g = window.__wireTheHouse; await g.renderer.waitForFrame(); g.renderer.render(); await g.renderer.waitForFrame(); });
  await page.screenshot({ path: `${out}/${name}.png` });
}
async function inspectObstruction(page) { return page.evaluate(() => {
      const g = window.__wireTheHouse, r = g.room.brickWall.raycaster;
      const hammer = g.fpsRig.getObjectByName('FPS hammer tool');
      // The three direct unnamed meshes are the shaft/flat/pointed blade.
      // Everything else, including gearbox/chuck, hands and battery, can hide work.
      const pieces = hammer.children.filter(o => !(o.isMesh && !o.name));
      const eye = g.renderer.camera.getWorldPosition(g.renderer.camera.position.clone());
      const tip = g.fpsRig.chiselTipWorld.clone(), direction = tip.clone().sub(eye);
      const length = direction.length();
      r.set(eye, direction.normalize()); r.far = length - .01;
      const tipBlocker = r.intersectObjects(pieces, true)[0]?.object.name ?? null;
      r.setFromCamera({ x: 0, y: 0 }, g.renderer.camera);
      const reticleBlocker = r.intersectObjects(pieces, true)[0]?.object.name ?? null;
      r.far = Infinity;
      return { tipBlocker, reticleBlocker, tip: tip.toArray() };
    }); }
try {
  for (const mobile of [false, true]) {
    const name = mobile ? 'mobile' : 'desktop';
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 768 }, hasTouch: mobile, isMobile: mobile });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(url); await page.waitForFunction(() => window.__wireTheHouse);
    await click(page, mobile, '#start-button'); await page.evaluate(() => document.exitPointerLock());
    if (mobile) {
      await click(page, true, '[data-tool="hammer"]');
      await click(page, true, '#settings-toggle'); await click(page, true, '#aim-control-mode'); await click(page, true, '#settings-close');
    } else await page.keyboard.press('Digit4');
    await aim(page, true);
    const far = await read(page), afterFar = await hammer(page, mobile);
    assert.equal(afterFar.workSurface.impactCount, far.workSurface.impactCount, 'Distant wall must remain out of reach');
    assert.equal(afterFar.workSurface.removedNodes, far.workSurface.removedNodes);
    let end = await move(page, mobile, 'forward');
    const approached = await page.evaluate(() => {
      const g = window.__wireTheHouse;
      for (let i = 0; i < 200; i++) { g.step(1 / 60); if (JSON.parse(g.renderState()).workPosition?.locked) break; }
      return JSON.parse(g.renderState());
    });
    await end(); assert.equal(approached.workPosition?.locked, true, `${name}: native approach did not enter the wall work position`);
    await step(page, 40); await aim(page);
    const near = await read(page);
    checkArms(near.body);
    end = await move(page, mobile, 'forward'); const pushed = await step(page, 30); await end();
    assert.equal(pushed.workPosition.locked, true);
    assert(Math.abs(pushed.player.z - near.player.z) < .005, 'Walking forward must hold the working distance');
    end = await move(page, mobile, 'right'); const lateral = await step(page, 24); await end();
    assert(lateral.player.x > pushed.player.x + .2, 'Wall work must still permit walking sideways');
    assert.equal(lateral.workPosition.locked, true);
    assert(Math.abs(lateral.player.z - pushed.player.z) < .005, 'Sideways walking changed the locked wall distance');
    await aim(page);
    const tipContact = await page.evaluate(() => {
      const g = window.__wireTheHouse, c = g.fpsRig.contact(g.renderer.camera, g.room.brickWall);
      if (!c) return null;
      const hammer = g.fpsRig.getObjectByName('FPS hammer tool');
      const visible = hammer.localToWorld(g.fpsRig.tipAnchor.clone()).addScaledVector(c.edge, c.bladeOffsetM ?? 0);
      return { visible: visible.toArray(), physical: c.point.toArray(), width: c.widthM };
    });
    assert(tipContact && distance(tipContact.visible, tipContact.physical) < 1e-6, 'Visible cutting edge and physical impact diverged');
    const nearBefore = await read(page), nearAfter = await hammer(page, mobile, 55);
    assert(nearAfter.workSurface.impactCount > nearBefore.workSurface.impactCount, `${name}: locked working pose cannot chisel`);
    checkArms(nearAfter.body);
    await shot(page, `${name}-locked-hammer`);
    const obstruction = await inspectObstruction(page);
    await writeFile(`${out}/${name}-obstruction.json`, JSON.stringify(obstruction, null, 2));
    assert.equal(obstruction.tipBlocker, null, 'Hammer or hand blocks the visible cutting tip');
    assert.equal(obstruction.reticleBlocker, null, 'Hammer or hand blocks the central work target');
    // Repeated one-pixel input must not send the hammer in/out of its resting
    // pose or jump it across the screen. Test on fresh shell after lateral walk.
    end = await move(page, mobile, 'right'); await step(page, 15); await end(); await aim(page);
    const jitter = [];
    let drag;
    if (mobile) drag = await touch(page, '#look-joystick');
    else {
      await page.mouse.click(683, 384, { button: 'right' });
      await page.waitForFunction(() => document.pointerLockElement);
      // Pointer lock recentres the native cursor. Absolute automation positions
      // must therefore be centred too, otherwise every "1px" change is a large
      // movement from the centre and would test a different user action.
      await page.mouse.move(683, 384);
    }
    await step(page, 30);
    for (let i = 0; i < 8; i++) {
      if (mobile) await drag.session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...drag.p, x: drag.p.x + (i % 2 ? 0 : 1) }] });
      else await page.mouse.move(683 + (i % 2 ? 0 : 1), 384);
      await step(page, 2);
      jitter.push(await page.evaluate(() => {
        const g = window.__wireTheHouse, hammer = g.fpsRig.getObjectByName('FPS hammer tool');
        return { pose: g.fpsRig.debugPose(), position: hammer.getWorldPosition(g.renderer.camera.position.clone().set(0, 0, 0)).toArray(), lock: JSON.parse(g.renderState()).workPosition, player: JSON.parse(g.renderState()).player };
      }));
    }
    if (mobile) await drag.end(); else await page.evaluate(() => document.exitPointerLock());
    await writeFile(`${out}/${name}-jitter.json`, JSON.stringify(jitter, null, 2));
    jitter.forEach(s => { checkArms(s.pose); assert.equal(s.lock.locked, true); });
    const maxJitterStep = Math.max(...jitter.slice(1).map((s, i) => distance(s.position, jitter[i].position)));
    assert(maxJitterStep < .015, `${name}: one-pixel input jumped tool by ${maxJitterStep}m`);
    assert(Math.max(...jitter.map(s => s.player.pitch)) - Math.min(...jitter.map(s => s.player.pitch)) < .005, 'Horizontal one-pixel input changed vertical aim');
    assert.equal(new Set(jitter.map(s => s.pose.reachable)).size, 1, 'Small input toggles between resting and working poses');
    assert.equal(jitter[0].pose.reachable, true, 'Jitter must be measured in an actual working pose');
    const sides = [];
    for (const degrees of [-65, 65, 0]) {
      await click(page, mobile, '#settings-toggle');
      for (let i = 0; i < 5 && (await read(page)).workSurface.chiselSideDegrees !== degrees; i++) await click(page, mobile, '#chisel-side');
      await click(page, mobile, '#settings-close');
      await step(page, 60); await aim(page); await step(page, 30);
      const state = await read(page), visibility = await inspectObstruction(page), anchors = await gripAnchors(page);
      checkArms(state.body);
      checkGripRoles(state.body, anchors, degrees);
      await shot(page, `${name}-side-${degrees}`);
      sides.push({ degrees, body: state.body, anchors, workPosition: state.workPosition, visibility });
      await writeFile(`${out}/${name}-side-visibility.json`, JSON.stringify(sides, null, 2));
      assert.equal(state.workSurface.chiselSideDegrees, degrees);
      assert.equal(state.body.reachable, true, `${name}: selected ${degrees} degree side stance cannot reach its working area`);
      assert.equal(visibility.tipBlocker, null, `${name}: ${degrees} degree side stance hides the cutting tip`);
      assert.equal(visibility.reticleBlocker, null, `${name}: ${degrees} degree side stance hides the work target`);
    }
    // Native held action with a diagnostic requested-side change permits exact
    // frame-level assertions during the regrip; ordinary side controls above
    // already verify the complete UI -> stance -> final hands path.
    let finishGripAction;
    if (mobile) {
      const first = await touch(page, '#look-joystick'); await first.end();
      const held = await touch(page, '#look-joystick'); finishGripAction = held.end;
    } else { await page.keyboard.down('KeyE'); finishGripAction = () => page.keyboard.up('KeyE'); }
    await page.waitForFunction(() => window.__wireTheHouse.input.actionHeld);
    const regrip = await page.evaluate(() => {
      const g = window.__wireTheHouse, result = [];
      g.room.brickWall.chiselSideDegrees = 65;
      for (let i = 0; i < 55; i++) {
        const blendBefore = g.fpsRig.hammerGripBlend, impactsBefore = g.room.brickWall.telemetry.impactCount;
        g.step(1 / 60);
        result.push({ blendBefore, blendAfter: g.fpsRig.hammerGripBlend, impactsBefore, impactsAfter: g.room.brickWall.telemetry.impactCount, body: g.fpsRig.debugPose() });
      }
      return result;
    });
    await finishGripAction();
    await writeFile(`${out}/${name}-regrip.json`, JSON.stringify(regrip, null, 2));
    assert(regrip.some(s => s.blendBefore > 0 && s.blendBefore < 1), 'Did not observe a real hand-switch transition');
    for (const sample of regrip) {
      checkArms(sample.body);
      assert(sample.body.arms.some(a => a.gripping), 'Both hands released the hammer simultaneously');
      if (sample.blendBefore > 0 && sample.blendBefore < 1) assert.equal(sample.impactsAfter, sample.impactsBefore, 'Percussion continued while changing hands');
    }
    checkGripRoles((await read(page)).body, await gripAnchors(page), 65);
    await shot(page, `${name}-left-body-regripped`);
    await page.evaluate(() => { window.__wireTheHouse.room.brickWall.chiselSideDegrees = 0; }); await step(page, 60);
    end = await move(page, mobile, 'back'); const backed = await step(page, 12); await end();
    assert.equal(backed.workPosition.locked, false, 'Backward walking did not release the working position');
    assert(backed.player.z > lateral.player.z + .03, 'Backward input did not physically step away');
    const idle = await step(page, 90);
    assert.equal(idle.workPosition.locked, false, 'Work position instantly re-latched after stepping backward');
    if (mobile) await click(page, true, '[data-tool="trowel"]'); else await page.keyboard.press('Digit7');
    await shot(page, `${name}-compact-trowel`);
    assert.equal(await page.locator('#mortar-panel button:visible').count(), 0, 'Removed mortar buttons still occupy the playing view');
    const hud = await page.locator('#mortar-panel').boundingBox(); assert(hud);
    if (mobile) { assert(hud.height < 140, `Mobile mortar readout remains ${hud.height}px tall`); assert(hud.y + hud.height < 844 * .42, 'Mobile readout covers central working area'); }
    await click(page, mobile, '#settings-toggle');
    assert(await page.locator('#settings-close').isVisible(), 'Settings cannot be opened');
    await click(page, mobile, '#settings-close');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight), false, 'Page overflows viewport');
    assert.deepEqual(errors, []);
    report.scenarios.push({ name, approached: approached.workPosition, locked: near.workPosition, forwardZ: pushed.player.z, lateral: lateral.player, tipContact, obstruction, sides, regripPausedFrames: regrip.filter(s => s.blendBefore > 0 && s.blendBefore < 1).length, nearImpacts: nearAfter.workSurface.impactCount - nearBefore.workSurface.impactCount, maxJitterStep, jitterReachable: jitter.map(s => s.pose.reachable), backed: backed.workPosition, idle: idle.workPosition, mortarBounds: hud, errors });
    await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); await page.close();
  }
  report.passed = true; await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log('PASS: native approach locks wall distance, lateral working and close chiseling work, tiny aim stays stable, backward movement releases without re-latching, compact HUD retains settings.');
} finally { await browser.close(); }
