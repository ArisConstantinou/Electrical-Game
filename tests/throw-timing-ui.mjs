import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

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
    const selectors = ['#mortar-panel', '#trowel-swing-gauge', '#throw-timing-track', '#mortar-swing'];
    const bounds = selectors.map(selector => ({ selector, visible: visible(q(selector)), ...rect(q(selector)) }));
    const labels = [...document.querySelectorAll('#mortar-panel strong,#mortar-panel small,#mortar-panel button,#mortar-panel b,#mortar-panel span,#trowel-swing-gauge output,#trowel-swing-gauge span,#trowel-swing-gauge b')].filter(e => visible(e) && e.textContent.trim());
    const badFonts = labels.filter(e => parseFloat(getComputedStyle(e).fontSize) < 12).map(e => ({ text: e.textContent, font: getComputedStyle(e).fontSize }));
    const rig = g.fpsRig.tools.get('trowel');
    return { feedback: g.mortar.throwFeedback, mass: g.mortar.launchedMass, projectiles: g.mortar.projectiles.map(p => ({ mass: p.mass, bond: p.bond, velocity: p.velocity.toArray() })), rig: { degrees: g.fpsRig.mortarSwingDegrees, holding: g.fpsRig.mortarHolding, rotation: rig.rotation.toArray() }, ui: { quality: q('#mortar-flow').dataset.quality, holding: q('#mortar-flow').dataset.holding, cursor: parseFloat(q('#throw-timing-cursor').style.left), meter: Number(q('#throw-timing-track').getAttribute('aria-valuenow')), degrees: parseFloat(q('#trowel-swing-degrees').textContent.replace('−', '-')), strength: parseFloat(q('#trowel-swing-strength').textContent), splash: Number(q('#mortar-face-splash').style.opacity), flowVisible: visible(q('#mortar-flow')), gaugeVisible: visible(q('#trowel-swing-gauge')) }, layout: { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, bounds, badFonts }, rendererError: g.renderer.lastError ?? '' };
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
  assert(Math.abs(data.rig.rotation[0] * 180 / Math.PI - f.swingDegrees) < .001, `${name}: actual visible trowel angle diverged`);
  assert.equal(data.rig.holding, f.holding);
  assert(u.flowVisible && u.gaugeVisible, `${name}: timing gauge hidden`);
  assert.equal(data.layout.badFonts.length, 0, `${name}: unreadable labels ${JSON.stringify(data.layout.badFonts)}`);
  assert(data.layout.scrollWidth <= data.layout.width + 1 && data.layout.scrollHeight <= data.layout.height + 1, `${name}: viewport overflow`);
  for (const b of data.layout.bounds) assert(b.visible && b.x >= -1 && b.y >= -1 && b.right <= data.layout.width + 1 && b.bottom <= data.layout.height + 1, `${name}: clipped ${b.selector}: ${JSON.stringify(b)}`);
  assert.equal(data.rendererError, '', `${name}: renderer error`);
}

try {
  for (const config of [{ name: 'desktop', width: 1366, height: 768, mobile: false }, { name: 'mobile', width: 390, height: 844, mobile: true }, { name: 'landscape', width: 844, height: 390, mobile: true }]) {
    const page = await browser.newPage({ viewport: { width: config.width, height: config.height }, isMobile: config.mobile, hasTouch: config.mobile, deviceScaleFactor: 1 });
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
    const select = async tool => {
      if (config.mobile) await page.locator(`[data-tool="${tool}"]`).tap();
      else await page.keyboard.press(tool === 'trowel' ? 'Digit7' : 'Digit8');
      await advance(page, 0);
    };
    const hold = async held => {
      if (!config.mobile) await page.keyboard[held ? 'down' : 'up']('KeyE');
      else {
        const r = await page.locator('#mortar-swing').boundingBox(); assert(r);
        await cdp.send('Input.dispatchTouchEvent', { type: held ? 'touchStart' : 'touchEnd', touchPoints: held ? [{ x: r.x + r.width / 2, y: r.y + r.height / 2, id: 1 }] : [] });
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
      assert.equal(held.feedback.quality, quality);
      assert.equal(held.mass, before.mass, 'Holding must not throw automatically');
      await frame(page); await page.screenshot({ path: join(out, `${config.name}-${quality}-holding.png`) });
      await hold(false); await advance(page, 0);
      const released = await sample(page); checkUI(released, `${config.name}-${quality}-released`);
      assert(Math.abs(released.mass - before.mass - .65) < 1e-8, 'Release must consume exactly one scoop');
      assert.equal(released.feedback.lastRelease, before.feedback.lastRelease + 1);
      if (quality === 'late') { assert(released.feedback.splash > .8); assert(released.ui.splash > .65); }
      else assert.equal(released.feedback.splash, 0);
      await frame(page); await page.screenshot({ path: join(out, `${config.name}-${quality}-released.png`) });
      await advance(page, .325);
      const recovering = await sample(page); checkUI(recovering, `${config.name}-${quality}-recovering`);
      assert(Math.abs(recovering.feedback.swingDegrees) < Math.abs(released.feedback.swingDegrees), 'Recovery must visibly return the tool and gauge together');
      item.phases.push({ quality, held, released, recovering });
    }
    await advance(page, 5);
    const beforeEnd = await sample(page);
    await hold(true); await advance(page, 2.4);
    const heldEnd = await sample(page); assert.equal(heldEnd.feedback.phase, 1); assert.equal(heldEnd.mass, beforeEnd.mass, 'Full bar must wait for release');
    await hold(false); await advance(page, 0);
    assert(Math.abs((await sample(page)).mass - beforeEnd.mass - .65) < 1e-8);
    item.barEnd = { heldSeconds: 2.4, noAutomaticThrow: true };
    await advance(page, 5);
    for (const kind of ['tool-switch', 'blur', ...(config.mobile ? ['pointer-cancel'] : [])]) {
      const before = await sample(page); await hold(true); await advance(page, .3);
      if (kind === 'tool-switch') await select('hose');
      else if (kind === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      else await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      if (kind !== 'pointer-cancel') await hold(false);
      await advance(page, .1);
      assert.equal((await sample(page)).mass, before.mass, `${config.name}: ${kind} accidentally launched`);
      item.cancellations.push(kind); await select('trowel');
    }
    await select('hose');
    const hose = await sample(page); assert(!hose.ui.flowVisible && !hose.ui.gaugeVisible, 'Trowel timing must not obscure hose controls');
    assert(await page.locator('#mortar-panel').isVisible(), 'Hose moisture panel must remain');
    await frame(page); await page.screenshot({ path: join(out, `${config.name}-hose.png`) });
    item.hose = hose;
    await page.close();
  }
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify({ passed: report.scenarios.map(s => ({ platform: s.platform, phases: s.phases.map(p => p.quality), cancellations: s.cancellations, barEnd: s.barEnd })), errors: report.errors }, null, 2));
} finally {
  await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
