import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { blockPointerLock } from './browser-safety.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5362/Electrical-Game/';
const out = resolve(process.argv[3] ?? 'output/throw-timing-ui');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { url, browser: browser.version(), mobileIsEmulation: true, clock: 'Only game.step is gated after startup; real native input and rendering RAF remain active.', scenarios: [], errors: [] };

async function advance(page, seconds) {
  await page.evaluate(seconds => {
    let remaining = seconds;
    while (remaining > 1e-8) { const dt = Math.min(remaining, 1 / 60); window.__throwTestStep(dt); remaining -= dt; }
    if (!seconds) window.__throwTestStep(0);
  }, seconds);
}
async function frame(page) {
  await page.evaluate(async () => { const g = window.__wireTheHouse; g.renderer.render(); await g.renderer.waitForFrame(); });
}
async function sample(page) {
  return page.evaluate(() => {
    const g = window.__wireTheHouse, q = selector => document.querySelector(selector);
    const visible = element => { const r = element.getBoundingClientRect(), s = getComputedStyle(element); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
    const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const selectors = ['#mortar-panel', '#trowel-swing-gauge', '#throw-timing-track', '#top-hud'];
    const bounds = selectors.map(selector => ({ selector, visible: visible(q(selector)), ...rect(q(selector)) }));
    const labels = [...document.querySelectorAll('#mortar-panel strong,#mortar-panel small,#mortar-panel button,#mortar-panel b,#mortar-panel span,#trowel-swing-gauge output,#trowel-swing-gauge span,#trowel-swing-gauge b')].filter(e => visible(e) && e.textContent.trim());
    const badFonts = labels.filter(e => parseFloat(getComputedStyle(e).fontSize) < 12).map(e => ({ text: e.textContent, font: getComputedStyle(e).fontSize }));
    const rig = g.fpsRig.tools.get('trowel');
    const toolPose = { position: rig.position.toArray(), rotation: rig.rotation.toArray(), scale: rig.scale.toArray(), loadVisible: rig.getObjectByName('trowel-load').visible };
    const arm = g.fpsRig.armSets.get('trowel').find(a => a.side === 1);
    const Vector = g.renderer.camera.position.constructor;
    const worldOrientation = rig.getWorldQuaternion(g.renderer.camera.quaternion.clone());
    const handOrientation = arm.hand.getWorldQuaternion(worldOrientation.clone());
    const straightArm = {
      shoulder: arm.shoulder.toArray(), elbow: arm.elbow.toArray(), wrist: arm.wrist.toArray(),
      forearmAxis: arm.wrist.clone().sub(arm.elbow).normalize().toArray(),
      handAxis: new Vector(0, 1, 0).applyQuaternion(handOrientation).toArray(),
      toolHeading: new Vector(0, 0, -1).applyQuaternion(worldOrientation).toArray(),
      bladeNormal: new Vector().fromArray(rig.userData.bladeNormal).applyQuaternion(worldOrientation).toArray(),
      cameraForward: g.renderer.camera.getWorldDirection(new Vector()).toArray(),
    };
    const compact = { unified: q('#mortar-panel').contains(q('#trowel-swing-gauge')), floatingButtons: q('#mortar-panel').querySelectorAll('button').length, dialVisible: visible(q('.swing-gauge-dial')), missionHeight: q('#top-hud').getBoundingClientRect().height, panelHeight: q('#mortar-panel').getBoundingClientRect().height };
    return { toolPose, straightArm, feedback: g.mortar.throwFeedback, mass: g.mortar.launchedMass, projectiles: g.mortar.projectiles.map(p => ({ mass: p.mass, bond: p.bond, velocity: p.velocity.toArray() })), rig: { degrees: g.fpsRig.mortarSwingDegrees, holding: g.fpsRig.mortarHolding, rotation: rig.rotation.toArray() }, ui: { quality: q('#mortar-flow').dataset.quality, holding: q('#mortar-flow').dataset.holding, cursor: parseFloat(q('#throw-timing-cursor').style.left), meter: Number(q('#throw-timing-track').getAttribute('aria-valuenow')), degrees: parseFloat(q('#trowel-swing-degrees').textContent.replace('−', '-')), strength: parseFloat(q('#trowel-swing-strength').textContent), splash: Number(q('#mortar-face-splash').style.opacity), flowVisible: visible(q('#mortar-flow')), gaugeVisible: visible(q('#trowel-swing-gauge')) }, layout: { compact, width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, bounds, badFonts }, rendererError: g.renderer.lastError ?? '' };
  });
}
function checkUI(data, name) {
  const f = data.feedback, u = data.ui;
  assert.equal(u.quality, f.quality, `${name}: timing quality diverged`);
  assert.equal(u.holding, String(f.holding), `${name}: holding marker diverged`);
  assert(Math.abs(u.cursor - f.phase * 100) < .001, `${name}: cursor diverged from real timing`);
  assert.equal(u.meter, Math.round(f.phase * 100));
  assert.equal(u.degrees, Math.round(f.swingDegrees), `${name}: displayed swing degrees diverged`);
  assert.equal(u.strength, Math.round(f.strength * 100), `${name}: displayed strength diverged`);
  assert(Math.abs(data.rig.degrees - f.swingDegrees) < .001, `${name}: animated tool and gauge diverged`);
  assert.equal(f.swingDegrees, f.motion.rollDegrees, `${name}: gauge must show axial roll`);
  const arm = data.straightArm;
  const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
  const distance = (a, b) => Math.hypot(...a.map((value, i) => value - b[i]));
  assert(dot(arm.forearmAxis, arm.handAxis) > .99999, `${name}: wrist bends away from the forearm`);
  assert(dot(arm.forearmAxis, arm.toolHeading) > .99999, `${name}: tool twists away from the straight forearm axis`);
  assert(Math.abs(distance(arm.shoulder, arm.elbow) - .31) < 1e-6, `${name}: upper arm stretched`);
  assert(Math.abs(distance(arm.elbow, arm.wrist) - .27) < 1e-6, `${name}: forearm stretched`);
  assert.equal(data.rig.holding, f.holding);
  assert(u.flowVisible && u.gaugeVisible, `${name}: timing gauge hidden`);
  assert.equal(data.layout.badFonts.length, 0, `${name}: unreadable labels ${JSON.stringify(data.layout.badFonts)}`);
  assert(data.layout.scrollWidth <= data.layout.width + 1 && data.layout.scrollHeight <= data.layout.height + 1, `${name}: viewport overflow`);
  for (const b of data.layout.bounds) assert(b.visible && b.x >= -1 && b.y >= -1 && b.right <= data.layout.width + 1 && b.bottom <= data.layout.height + 1, `${name}: clipped ${b.selector}: ${JSON.stringify(b)}`);
  assert(data.layout.compact.unified, `${name}: swing readouts must share the timing panel`);
  assert.equal(data.layout.compact.floatingButtons, 0, `${name}: old mortar buttons obstruct the wall`);
  assert(!data.layout.compact.dialVisible, `${name}: duplicate large dial is visible`);
  if (!name.startsWith('desktop')) {
    assert(data.layout.compact.missionHeight <= 52, `${name}: mission header too large`);
    assert(data.layout.compact.panelHeight <= 90, `${name}: mortar panel too large`);
  }
  assert.equal(data.rendererError, '', `${name}: renderer error`);
}

function checkStraightFlick(reference, data, name) {
  const a = reference.straightArm, b = data.straightArm;
  const dot = (u, v) => u.reduce((sum, value, i) => sum + value * v[i], 0);
  assert(dot(a.toolHeading, b.toolHeading) > .99999, `${name}: flick changed tool heading instead of axial rotation`);
  assert(Math.abs(dot(a.bladeNormal, b.bladeNormal) - Math.cos(data.feedback.motion.rollDegrees * Math.PI / 180)) < 1e-5, `${name}: actual blade normal does not follow the forearm roll`);
  const wristTravel = b.wrist.map((value, i) => value - a.wrist[i]);
  const elbowTravel = b.elbow.map((value, i) => value - a.elbow[i]);
  assert(Math.hypot(...wristTravel) < .1, `${name}: flick became a long arm swing`);
  assert(Math.hypot(...wristTravel.map((value, i) => value - elbowTravel[i])) < .001, `${name}: wrist bent independently of the forearm`);
  if (data.feedback.stage === 'follow-through') assert(dot(wristTravel, a.cameraForward) > .01, `${name}: no measurable short forward flick`);
}

try {
  for (const config of [{ name: 'desktop', width: 1366, height: 768, mobile: false }, { name: 'mobile', width: 390, height: 844, mobile: true }, { name: 'landscape', width: 844, height: 390, mobile: true }]) {
    const context = await browser.newContext({ viewport: { width: config.width, height: config.height }, isMobile: config.mobile, hasTouch: config.mobile, deviceScaleFactor: 1 });
    await blockPointerLock(context);
    const page = await context.newPage();
    page.on('pageerror', e => report.errors.push(`${config.name}: ${e.message}`));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(window.__wireTheHouse));
    await page.locator('#start-button')[config.mobile ? 'tap' : 'click']();
    await page.evaluate(() => document.exitPointerLock());
    await page.waitForTimeout(80);
    await page.evaluate(() => {
      const g = window.__wireTheHouse;
      window.__throwTestStep = g.step.bind(g); g.step = () => {};
      const camera = g.renderer.camera; camera.position.set(0, 1.65, -1); camera.lookAt(0, 1.45, -2.41);
      g.player.yaw = camera.rotation.y; g.player.pitch = camera.rotation.x; camera.updateMatrixWorld(true);
    });
    const cdp = config.mobile ? await page.context().newCDPSession(page) : null;
    let heldTouch = null;
    const select = async tool => {
      if (config.mobile && heldTouch) {
        const button = page.locator(`button[data-tool="${tool}"]`);
        await button.scrollIntoViewIfNeeded();
        const r = await button.boundingBox(); assert(r);
        // A second finger switches tools while the first continues holding aim.
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [heldTouch, {x:r.x+r.width/2,y:r.y+r.height/2,id:2}] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [heldTouch] });
      } else if (config.mobile) await page.locator(`button[data-tool="${tool}"]`).tap();
      else await page.keyboard.press(tool === 'trowel' ? 'Digit7' : 'Digit8');
      await advance(page, 0);
    };
    const hold = async held => {
      if (!config.mobile) await page.keyboard[held ? 'down' : 'up']('KeyE');
      else {
        const r = await page.locator('#look-joystick').boundingBox(); assert(r);
        heldTouch = held ? { x: r.x + r.width / 2, y: r.y + r.height / 2, id: 1 } : null;
        await cdp.send('Input.dispatchTouchEvent', { type: held ? 'touchStart' : 'touchEnd', touchPoints: heldTouch ? [heldTouch] : [] });
      }
      await page.waitForFunction(held => window.__wireTheHouse.input.actionHeld === held, held);
    };
    await select('trowel');
    const item = { platform: config.name, phases: [], cancellations: [] }; report.scenarios.push(item);
    for (const [quality, phase] of [['early', .2], ['perfect', .5], ['late', .94]]) {
      await advance(page, 1.2);
      const before = await sample(page);
      checkUI(before, `${config.name}-${quality}-ready`);
      assert.equal(before.feedback.swingDegrees, 0, 'Idle trowel and live gauge must return to zero degrees');
      await hold(true); await advance(page, phase * .95);
      const held = await sample(page); checkUI(held, `${config.name}-${quality}`);
      checkStraightFlick(before, held, `${config.name}-${quality}-holding`);
      assert.equal(held.feedback.quality, quality);
      assert.equal(held.mass, before.mass, 'Holding must not throw automatically');
      await frame(page); await page.screenshot({ path: join(out, `${config.name}-${quality}-holding.png`) });
      await hold(false); await advance(page, 0);
      const committed = await sample(page); checkUI(committed, `${config.name}-${quality}-committed`);
      assert.equal(committed.mass, before.mass, 'Button-up commits the wrist motion without immediately releasing mortar');
      assert.equal(committed.feedback.lastRelease, before.feedback.lastRelease);
      assert(committed.feedback.casting && committed.feedback.motion.loadVisible);
      await advance(page, .15);
      const flipping = await sample(page); checkUI(flipping, `${config.name}-${quality}-flipping`);
      assert.equal(flipping.mass, before.mass, 'Mortar must stay on the blade until the .16-second release');
      await advance(page, .01);
      const released = await sample(page); checkUI(released, `${config.name}-${quality}-released`);
      checkStraightFlick(before, released, `${config.name}-${quality}-released`);
      assert(Math.abs(released.mass - before.mass - .65) < 1e-8, 'Release must consume exactly one scoop');
      assert.equal(released.feedback.lastRelease, before.feedback.lastRelease + 1);
      if (quality === 'late') { assert(released.feedback.splash > .8); assert(released.ui.splash > .65); }
      else assert.equal(released.feedback.splash, 0);
      await frame(page); await page.screenshot({ path: join(out, `${config.name}-${quality}-released.png`) });
      assert.equal(released.feedback.motion.loadVisible, false);
      await advance(page, .165);
      const recovering = await sample(page); checkUI(recovering, `${config.name}-${quality}-recovering`);
      checkStraightFlick(before, recovering, `${config.name}-${quality}-follow-through`);
      assert.equal(recovering.feedback.stage, 'follow-through');
      assert(recovering.feedback.motion.rollDegrees >= 150, 'Follow-through must keep the emptied blade turned over');
      assert(recovering.feedback.swingDegrees > released.feedback.swingDegrees, 'Wrist must finish its forward arc before returning');
      assert.equal(recovering.mass, released.mass, 'Follow-through must not emit a second scoop');
      await advance(page, .495);
      const reset = await sample(page); checkUI(reset, `${config.name}-${quality}-reset`);
      checkStraightFlick(before, reset, `${config.name}-${quality}-reset`);
      assert(Math.abs(reset.feedback.swingDegrees) < .001 && Math.abs(reset.feedback.motion.rollDegrees) < .001, 'The .82-second cast must return to the ready pose');
      assert.equal(reset.feedback.lastRelease, before.feedback.lastRelease + 1);
      item.phases.push({ quality, held, committed, flipping, released, recovering, reset });
    }
    await advance(page, 5);
    const beforeEnd = await sample(page);
    await hold(true); await advance(page, 1.3);
    const heldEnd = await sample(page); checkUI(heldEnd, `${config.name}-full-charge-grace`);
    assert.equal(heldEnd.feedback.phase, 1); assert.equal(heldEnd.feedback.overheld, false);
    assert.equal(heldEnd.mass, beforeEnd.mass, 'Full bar must wait for release during grace');
    await advance(page, .46);
    const expired = await sample(page); checkUI(expired, `${config.name}-expired-charge`);
    assert.equal(expired.feedback.phase, 0); assert.equal(expired.feedback.overheld, true);
    assert.equal(expired.feedback.holding, true); assert.equal(expired.feedback.casting, false);
    assert.equal(expired.feedback.stage, 'prepare'); assert.equal(expired.mass, beforeEnd.mass);
    assert.deepEqual(expired.feedback.motion, heldEnd.feedback.motion, 'Bar expiry must preserve the loaded full-charge trowel pose');
    assert.deepEqual(expired.rig.rotation, heldEnd.rig.rotation, 'Bar expiry must not reset the physical trowel rotation');
    assert.deepEqual(expired.toolPose, heldEnd.toolPose, 'Bar expiry must preserve the actual loaded tool position, rotation and scale');
    assert.equal(expired.feedback.motion.loadVisible, true);
    assert.equal(await page.locator('#throw-quality').textContent(), 'RESET · RELEASE', 'Expired gauge must explain how to rearm');
    if(config.mobile) assert.equal(await page.locator('#mobile-use-status').textContent(), 'RELEASE TO RESET');
    assert.equal(await page.evaluate(() => window.__wireTheHouse.input.actionHeld), true, 'Expiry test must keep the native input held');
    await frame(page); await page.screenshot({ path: join(out, `${config.name}-overheld-reset.png`) });
    await advance(page, 2.4);
    const stillExpired = await sample(page);
    assert.equal(stillExpired.feedback.phase, 0); assert.equal(stillExpired.feedback.overheld, true);
    assert.deepEqual(stillExpired.feedback.motion, heldEnd.feedback.motion, 'Continued hold must keep the same loaded trowel pose after bar reset');
    assert.deepEqual(stillExpired.toolPose, heldEnd.toolPose, 'Continued expired hold must not reset the actual loaded tool transform');
    assert.equal(stillExpired.mass, beforeEnd.mass, 'Expired hold must not auto-rearm or auto-throw');
    await hold(false); await advance(page, 0);
    await advance(page, .9);
    const releasedExpiry = await sample(page); checkUI(releasedExpiry, `${config.name}-expired-released`);
    assert.equal(releasedExpiry.feedback.overheld, false); assert.equal(releasedExpiry.mass, beforeEnd.mass, 'Release after expiry must not throw');
    assert.equal(await page.locator('#throw-quality').textContent(), 'HOLD TO SWING');
    await hold(true); await advance(page, .475);
    const rearmed = await sample(page); checkUI(rearmed, `${config.name}-fresh-charge`);
    assert.equal(rearmed.feedback.quality, 'perfect'); assert.equal(rearmed.feedback.holding, true);
    await hold(false); await advance(page, 0);
    await advance(page, .16);
    assert(Math.abs((await sample(page)).mass - beforeEnd.mass - .65) < 1e-8);
    item.barEnd = { graceSeconds: .8, expiresAfterSeconds: 1.75, noAutomaticThrow: true, releaseAfterExpiryDoesNotThrow: true, nativeInputRearmed: true, expired, releasedExpiry, rearmed };
    await advance(page, 5);
    for (const kind of ['tool-switch', 'blur', ...(config.mobile ? ['pointer-cancel'] : [])]) {
      const before = await sample(page); await hold(true); await advance(page, .3);
      if (kind === 'tool-switch') await select('hose');
      else if (kind === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      else { await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); heldTouch = null; }
      if (kind !== 'pointer-cancel') await hold(false);
      await advance(page, .9);
      assert.equal((await sample(page)).mass, before.mass, `${config.name}: ${kind} accidentally launched`);
      item.cancellations.push(kind); await select('trowel');
    }
    const beforeSettingsCancel = await sample(page);
    await hold(true); await advance(page, .475); await hold(false); await advance(page, .08);
    assert.equal((await sample(page)).feedback.casting, true);
    await page.locator('#settings-toggle')[config.mobile ? 'tap' : 'click']();
    await page.waitForFunction(() => document.querySelector('#settings-toggle').getAttribute('aria-expanded') === 'true');
    await advance(page, .9);
    assert.equal((await sample(page)).mass, beforeSettingsCancel.mass, 'Opening settings must cancel a pending cast before its release');
    assert.equal((await sample(page)).feedback.casting, false);
    await page.locator('#settings-close')[config.mobile ? 'tap' : 'click']();
    item.cancellations.push('settings-pending-cast');
    await select('trowel');
    assert.equal(await page.locator('#mortar-pack').count(), 0, 'Press-to-pack control must be removed');
    const relocated = ['#mortar-angle-down', '#mortar-angle-up', '#mortar-swing', '#work-height'];
    for (const selector of relocated) assert(!(await page.locator(selector).isVisible()), `${config.name}: ${selector} should be out of the work view`);
    await page.locator('#settings-toggle')[config.mobile ? 'tap' : 'click']();
    await page.locator('#mortar-settings summary')[config.mobile ? 'tap' : 'click']();
    for (const selector of relocated) {
      await page.locator(selector).scrollIntoViewIfNeeded();
      assert(await page.locator(selector).isVisible(), `${config.name}: relocated ${selector} inaccessible`);
      const box = await page.locator(selector).boundingBox(); assert(box && box.height >= 44, `${selector}: touch target too small`);
    }
    await page.locator('#mortar-angle-up').scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(out, `${config.name}-settings-before.png`) });
    const useSetting = async selector => {
      await page.locator(selector).scrollIntoViewIfNeeded();
      // The settings panel uses smooth scrolling; wait for the real button to
      // become hit-testable instead of clicking during an intermediate scroll.
      await page.waitForFunction(selector => { const e=document.querySelector(selector),r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); }, selector);
      const target = await page.locator(selector).evaluate(e => { const r=e.getBoundingClientRect(), x=r.x+r.width/2, y=r.y+r.height/2; return {x,y,hit:e.contains(document.elementFromPoint(x,y))}; });
      assert(target.hit, `${config.name}: ${selector} is visually obstructed`);
      if (config.mobile) await page.touchscreen.tap(target.x,target.y); else await page.mouse.click(target.x,target.y);
    };
    const angleBefore = await page.evaluate(() => window.__wireTheHouse.mortar.angleDegrees);
    await useSetting('#mortar-angle-up');
    assert.equal(await page.evaluate(() => window.__wireTheHouse.mortar.angleDegrees), angleBefore + 5, 'Settings angle control must remain functional');
    await useSetting('#mortar-angle-down');
    assert.equal(await page.evaluate(() => window.__wireTheHouse.mortar.angleDegrees), angleBefore);
    item.settings = { relocated, nativeAngleAdjustment: true };
    await page.screenshot({ path: join(out, `${config.name}-settings.png`) });
    await page.locator('#settings-close')[config.mobile ? 'tap' : 'click']();
    await select('hose');
    const hose = await sample(page); assert(!hose.ui.flowVisible && !hose.ui.gaugeVisible, 'Trowel timing must not obscure hose controls');
    assert(await page.locator('#mortar-panel').isVisible(), 'Hose moisture panel must remain');
    await frame(page); await page.screenshot({ path: join(out, `${config.name}-hose.png`) });
    item.hose = hose;
    assert.equal(await page.evaluate(() => document.pointerLockElement), null);
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify({ passed: report.scenarios.map(s => ({ platform: s.platform, phases: s.phases.map(p => p.quality), cancellations: s.cancellations, barEnd: s.barEnd })), errors: report.errors }, null, 2));
} finally {
  await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
