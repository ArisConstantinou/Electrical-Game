import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const url = process.argv[2] ?? 'http://127.0.0.1:5362/Electrical-Game/';
const out = process.argv[3] ?? 'output/one-hand-tools-ui';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { url, mobileIsEmulation: true, fixture: 'Camera and pipe-stage setup are diagnostic fixtures; tool selection and held use are native keyboard/touch input.', scenarios: [], errors: [] };
const keys = { spring: 'Digit1', cutter: 'Digit2', spray: 'Digit3', fitting: 'Digit5', level: 'Digit6', trowel: 'Digit7', hose: 'Digit8', hammer: 'Digit4' };
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const subtract = (a, b) => a.map((v, i) => v - b[i]);
const read = page => page.evaluate(() => {
  const g = window.__wireTheHouse, rig = g.fpsRig, c = g.renderer.camera, group = rig.tools.get(g.selectedTool);
  c.updateMatrixWorld(true); rig.updateWorldMatrix(true, true);
  return { ...rig.debugPose(), action: rig.toolAction, hoseActive: rig.hoseActive, mortarHolding: rig.mortarHolding, mortarDegrees: rig.mortarSwingDegrees,
    cutterAngle: group.getObjectByName('cutter-moving-handle')?.rotation.z,
    actualArms: rig.armSets.get(g.selectedTool).map(arm => ({ side: arm.side,
      parent: arm.hand.parent?.name, bodyParent: arm.hand.parent === arm.group,
      toolParent: arm.hand.parent === group,
      actualWrist: arm.hand.localToWorld(c.position.clone().fromArray(arm.hand.userData.wristPoint)).toArray(),
      screen: arm.hand.getWorldPosition(c.position.clone()).project(c).toArray(),
      gripError: arm.hand.getWorldPosition(c.position.clone()).distanceTo(group.localToWorld(arm.grip.clone())),
    })),
    state: JSON.parse(g.renderState()),
  };
});
function validate(pose, label, hammer = false) {
  assert.equal(pose.arms.length, 2, `${label}: both physical arms remain present`);
  assert.equal(pose.arms.filter(a => a.gripping).length, hammer ? 2 : 1, `${label}: incorrect number of gripping hands`);
  for (const arm of pose.arms) {
    const actual = pose.actualArms.find(a => a.side === arm.side);
    assert.equal(arm.fingers, 5, `${label}: missing digit`);
    assert(Math.abs(distance(arm.shoulder, arm.elbow) - .31) < 1e-5, `${label}: upper arm stretched`);
    assert(Math.abs(distance(arm.elbow, arm.wrist) - .27) < 1e-5, `${label}: forearm stretched`);
    assert(distance(actual.actualWrist, arm.wrist) < .003, `${label}: rendered hand detached from physical wrist`);
    if (!hammer && arm.side < 0) {
      assert.equal(arm.gripping, false, `${label}: left hand grips small tool`);
      assert.equal(arm.gripRole, 'resting', `${label}: left hand has no resting role`);
      assert(actual.bodyParent && !actual.toolParent, `${label}: hanging hand follows tool transform`);
      assert(arm.wrist[1] < arm.shoulder[1] - .42, `${label}: left wrist is raised beside tool`);
      assert(arm.elbow[1] < arm.shoulder[1] - .20, `${label}: left elbow bends upward`);
    } else {
      assert(actual.toolParent, `${label}: grip detached from tool hierarchy`);
      if (!hammer) assert(actual.gripError < .001, `${label}: right hand misses authored grip`);
    }
  }
}
async function shot(page, name) {
  await page.evaluate(async () => { const g = window.__wireTheHouse; g.step(0); g.renderer.render(); await g.renderer.waitForFrame(); });
  await page.screenshot({ path: `${out}/${name}.png` });
}
async function setAim(page, pitch = -.40, yaw = 0) {
  await page.evaluate(({ pitch, yaw }) => {
    const g = window.__wireTheHouse; g.hammerWorkStance.restore(g.renderer.camera);
    g.renderer.camera.position.set(-.55, 1.65, -1.59); g.player.pitch = pitch; g.player.yaw = yaw;
    g.step(1 / 60);
  }, { pitch, yaw });
}
async function hold(page, mobile, callback) {
  let cdp;
  if (mobile) {
    cdp = await page.context().newCDPSession(page);
    const r = await page.locator('#look-joystick').boundingBox(); assert(r);
    const p = { x: r.x + r.width / 2, y: r.y + r.height / 2, id: 7 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
    if (await page.evaluate(() => window.__wireTheHouse.selectedTool !== 'trowel')) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...p, x: p.x + 5 }] });
  } else await page.keyboard.down('KeyE');
  try { await callback(); }
  finally {
    if (mobile) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach(); }
    else await page.keyboard.up('KeyE');
  }
}
try {
  for (const platform of [
    { name: 'desktop', width: 1366, height: 768, mobile: false },
    { name: 'mobile', width: 390, height: 844, mobile: true },
    { name: 'landscape', width: 844, height: 390, mobile: true },
  ]) {
    const { name, width, height, mobile } = platform;
    const page = await browser.newPage({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
    page.on('pageerror', e => report.errors.push(`${name}: ${e.message}`));
    await page.goto(url); await page.waitForFunction(() => window.__wireTheHouse);
    await page.locator('#start-button')[mobile ? 'tap' : 'click']();
    await page.evaluate(() => document.exitPointerLock());
    await page.waitForTimeout(350);
    const select = async tool => { if (mobile) await page.locator(`[data-tool="${tool}"]`).tap(); else await page.keyboard.press(keys[tool]); await setAim(page); };
    const cases = [];
    for (const tool of Object.keys(keys).filter(k => k !== 'hammer')) {
      await select(tool);
      const pose = await read(page); validate(pose, `${name} ${tool}`);
      const rightScreen = pose.actualArms.find(a => a.side > 0).screen;
      assert(Math.abs(rightScreen[0]) < 1 && Math.abs(rightScreen[1]) < 1 && rightScreen[2] < 1, `${name} ${tool}: holding hand outside viewport`);
      const left = pose.arms.find(a => a.side < 0), neutral = subtract(left.wrist, left.shoulder);
      await shot(page, `${name}-${tool}`);
      for (const pitch of [-1.05, .55]) {
        await setAim(page, pitch);
        const changed = await read(page); validate(changed, `${name} ${tool} pitch ${pitch}`);
        const changedLeft = changed.arms.find(a => a.side < 0);
        assert(distance(subtract(changedLeft.wrist, changedLeft.shoulder), neutral) < .012, `${name} ${tool}: hanging arm rotates with head pitch`);
        if (pitch < -1 && tool === 'fitting') await shot(page, `${name}-${tool}-look-down`);
      }
      await setAim(page, -.4, .7);
      const turned = await read(page); validate(turned, `${name} ${tool} yaw`);
      const turnedLeft = turned.arms.find(a => a.side < 0);
      // The free wrist remains on the body's left after turning the torso.
      const offset = subtract(turnedLeft.wrist, turnedLeft.shoulder);
      assert(Math.abs(offset[1] - neutral[1]) < .012, `${name} ${tool}: torso yaw raises free hand`);
      cases.push({ tool, pose, turned });
    }
    for (const tool of ['trowel', 'hose', 'cutter']) {
      await select(tool);
      if (tool === 'cutter') {
        await page.evaluate(() => {
          const g = window.__wireTheHouse, p = g.mission.activePoint;
          p.position.set(-.55, 1.30, -2.05); p.stage = 'conduit'; p.pipeStep = 'cut';
          // Isolate the completed bed prerequisite; this test checks native cutter input and grip motion, not mortar acceptance.
          g.mortar.ready = () => true;
          g.renderer.camera.lookAt(p.position); g.player.yaw = g.renderer.camera.rotation.y; g.player.pitch = g.renderer.camera.rotation.x; g.step(0);
        });
      }
      let samples;
      await hold(page, mobile, async () => {
        samples = await page.evaluate(() => {
          const g = window.__wireTheHouse, result = [];
          for (let i = 0; i < 15; i++) { g.step(1 / 60); result.push({ action: g.fpsRig.toolAction, holding: g.fpsRig.mortarHolding, hose: g.fpsRig.hoseActive, degrees: g.fpsRig.mortarSwingDegrees, cutter: g.fpsRig.tools.get('cutter').getObjectByName('cutter-moving-handle')?.rotation.z }); }
          return result;
        });
        const pose = await read(page); validate(pose, `${name} ${tool} in use`);
        if (tool === 'trowel') assert(samples.some(s => s.holding && Math.abs(s.degrees) > 1), `${name}: native hold did not swing trowel`);
        if (tool === 'hose') assert(samples.some(s => s.hose), `${name}: native hold did not spray hose`);
        if (tool === 'cutter') assert(samples.some(s => s.action > 0 && Math.abs(s.cutter) > .01), `${name}: native input did not actuate cutter`);
        await shot(page, `${name}-${tool}-active`);
      });
      await page.waitForTimeout(60);
      assert.equal(await page.evaluate(() => window.__wireTheHouse.input.actionHeld), false, `${name}: action remains held after release`);
      cases.push({ tool, activeSamples: samples });
    }
    await select('hammer');
    for (const side of [0, 65, -65, 0]) {
      await page.evaluate(side => { const g = window.__wireTheHouse; g.room.brickWall.chiselSideDegrees = side; for (let i = 0; i < 90; i++) g.step(1 / 60); }, side);
      const pose = await read(page); validate(pose, `${name} hammer ${side}`, true);
      const rear = pose.arms.find(a => a.gripRole === 'rear');
      assert.equal(rear?.side, side > 0 ? -1 : 1, `${name}: wrong rear gripping hand after side change`);
      cases.push({ tool: 'hammer', side, pose });
    }
    report.scenarios.push({ platform: name, cases }); await page.close();
  }
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify({ url, platforms: report.scenarios.map(s => s.platform), cases: report.scenarios.reduce((n, s) => n + s.cases.length, 0), errors: report.errors, pass: true }, null, 2));
} finally { await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); await browser.close(); }
