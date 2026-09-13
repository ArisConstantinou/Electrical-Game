import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:5362/Electrical-Game/';
const out = resolve(process.argv[3] ?? 'output/free-work');
const uiOnly = process.argv.includes('--ui-only');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { url, browser: browser.version(), mobileIsEmulation: true, scenarios: [], errors: [] };
const state = page => page.evaluate(() => JSON.parse(window.render_game_to_text()));
const advance = (page, ms) => page.evaluate(ms => window.advanceTime(ms), ms);
const tap = (page, mobile, selector) => page.locator(selector)[mobile ? 'tap' : 'click']();
const select = async (page, mobile, tool) => {
  if (mobile) await tap(page, true, `[data-tool="${tool}"]`);
  else await page.keyboard.press(tool === 'hammer' ? 'Digit4' : 'Digit5');
  await advance(page, 17);
};
async function aim(page, target) {
  await page.evaluate(target => {
    const g = window.__wireTheHouse, camera = g.renderer.camera, wall = g.room.brickWall;
    camera.position.set(target.x, g.player.eyeHeight, -1.0);
    let x = target.x, y = target.y;
    if (g.selectedTool === 'hammer' && target.z < wall.volume.frontZ) {
      const tilt = wall.chiselTiltDegrees * Math.PI / 180, side = wall.chiselSideDegrees * Math.PI / 180;
      const d = { x: Math.sin(side) * Math.cos(tilt), y: -Math.sin(tilt), z: -Math.cos(side) * Math.cos(tilt) };
      const travel = (target.z - wall.volume.frontZ) / d.z;
      x -= d.x * travel; y -= d.y * travel;
    }
    camera.lookAt(x, y, wall.volume.frontZ);
    g.player.yaw = camera.rotation.y; g.player.pitch = camera.rotation.x;
    camera.updateMatrixWorld(true); g.step(0);
  }, target);
}
async function touchSession(page) {
  const session = await page.context().newCDPSession(page);
  return async (held, drag = true) => {
    const r = await page.locator('#look-joystick').boundingBox();
    assert(r, 'Mobile aim pad missing');
    const p = { x: r.x + r.width / 2, y: r.y + r.height / 2, id: 11 };
    await session.send('Input.dispatchTouchEvent', { type: held ? 'touchStart' : 'touchEnd', touchPoints: held ? [p] : [] });
    if (held && drag) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...p, x: p.x + 8 }] });
      // Native pointermove delivery is synchronized to browser frames. Simulated
      // game time alone must not release the touch before that event is handled.
      await page.waitForFunction(() => window.__wireTheHouse.input.actionHeld, undefined, { timeout: 1500 });
    }
  };
}
async function setSpeed(page, mobile, percent) {
  if (!mobile) { await page.evaluate(() => document.exitPointerLock()); await page.waitForTimeout(40); }
  const previousImpacts=(await state(page)).workSurface.impactCount;
  await tap(page, mobile, '#settings-toggle');
  const slider = page.locator('#hammer-speed');
  await slider.scrollIntoViewIfNeeded();
  if (mobile) {
    const r = await slider.boundingBox(); assert(r, 'Native speed slider missing');
    // Use the native range thumb track, including its endcap radius. Never set value by JS.
    await page.touchscreen.tap(r.x + 8 + (r.width - 16) * percent / 250, r.y + r.height / 2);
  } else {
    await slider.focus(); await page.keyboard.press('Home');
    for (let i = 0; i < percent / 25; i++) await page.keyboard.press('ArrowRight');
  }
  assert.equal(Number(await slider.inputValue()), percent, 'Native slider input did not reach requested speed');
  assert.equal((await state(page)).hammer.speedMultiplier, percent / 100);
  assert.equal((await state(page)).workSurface.impactCount, previousImpacts, 'Operating settings must not fire the demolition hammer');
  await page.waitForTimeout(220);
  const layout = await page.evaluate(() => {
    const panel = document.querySelector('#settings-panel').getBoundingClientRect();
    return { right: panel.right, bottom: panel.bottom, width: innerWidth, height: innerHeight, sliderFont: parseFloat(getComputedStyle(document.querySelector('.hammer-speed-setting')).fontSize), helpFont: parseFloat(getComputedStyle(document.querySelector('.hammer-speed-setting small')).fontSize) };
  });
  assert(layout.right <= layout.width + 1 && layout.bottom <= layout.height + 1 && layout.sliderFont >= 14 && layout.helpFont >= 12, 'Speed control must fit and remain readable');
  await page.screenshot({ path: join(out, `${mobile ? 'mobile' : 'desktop'}-speed-${percent}.png`) });
  await tap(page, mobile, '#settings-close');
}
async function action(page, mobile, touch) {
  if (mobile) { await touch(true, false); await advance(page, 17); await touch(false); }
  else await page.keyboard.press('KeyE');
  await advance(page, 267);
}
async function clearBox(page, mobile, touch) {
  let strokes = 0;
  let previousImpacts=-1, stalled=0;
  for (; strokes < 900; strokes++) {
    const probe = await page.evaluate(() => {
      const g = window.__wireTheHouse, wall = g.room.brickWall, v = wall.volume, point = g.mission.activePoint, p = point.position;
      if (wall.canFitBoxes(point)) return { clear: true };
      const min = { x: p.x - point.boxGroup.groupWidth / 2 - .010, y: p.y - .049, z: p.z - .050 };
      const max = { x: p.x + point.boxGroup.groupWidth / 2 + .010, y: p.y + .049, z: p.z + .001 };
      const coordinates = p => ({ x: Math.round((p.x + v.width / 2) / v.hx + .5), y: Math.round(p.y / v.hy + .5), z: Math.round((v.frontZ - p.z) / v.hz + .5) });
      const a = coordinates(min), b = coordinates(max);
      for (let z = Math.min(a.z, b.z); z <= Math.max(a.z, b.z); z++) for (let y = a.y; y <= b.y; y++) for (let x = a.x; x <= b.x; x++) if (v.nodeMaterial(x, y, z)) return { clear: false, target: v.nodePosition(x, y, z) };
      // Tetrahedral fracture faces can enter the box from a surviving node just
      // outside its rounded grid bounds. Chase those edge nodes as well; never
      // keep aiming at an already empty center when physical clearance is false.
      for (let z = Math.min(a.z, b.z) - 1; z <= Math.max(a.z, b.z) + 1; z++) for (let y = a.y - 1; y <= b.y + 1; y++) for (let x = a.x - 1; x <= b.x + 1; x++) if (v.nodeMaterial(x, y, z)) return { clear: false, target: v.nodePosition(x, y, z), edgeProbe: true };
      return { clear: false, target: { ...p, z: p.z - .025 }, noNodeFound: true };
    });
    if (probe.clear) return strokes;
    await aim(page, { ...probe.target, z: probe.target.z - .002 });
    if (mobile) {
      await touch(true);await aim(page, { ...probe.target, z: probe.target.z - .002 });
      // The drag can request a strike before the inspection fixture recenters
      // its aim. Allow one real cadence interval for the next held strike.
      await advance(page, (await state(page)).hammer.impactIntervalSeconds * 1000 + 35);
      await touch(false);
    }
    else { await page.keyboard.down('KeyE'); await advance(page, 30); await page.keyboard.up('KeyE'); }
    await advance(page, 270);
    const impacts=(await state(page)).workSurface.impactCount;
    stalled=impacts===previousImpacts?stalled+1:0;previousImpacts=impacts;
    if(stalled>=12){
      const diagnostic=await page.evaluate(()=>{
        const g=window.__wireTheHouse,w=g.room.brickWall,c=w.contactProvider(g.renderer.camera);
        const origin=c?c.point.clone().addScaledVector(c.direction,-.012):null;
        return{selectedTool:g.selectedTool,hammerSpeed:g.hammerSpeed,cooldown:g.actionCooldown,contact:c,recontact:c?w.volume.raycast(origin,c.direction,.028):null,save:w.volume.serialize(),point:g.mission.activePoint.position.toArray()};
      });
      await writeFile(join(out,'stalled-contact.json'),JSON.stringify({probe,...diagnostic},null,2));
      throw Error(`Actual hammer produced no contact for 12 aimed inputs; see stalled-contact.json at ${JSON.stringify(probe)}`);
    }
    if (strokes % 100 === 99) console.log(JSON.stringify({ excavating: mobile ? 'mobile' : 'desktop', strokes: strokes + 1, probe, workSurface:(await state(page)).workSurface }));
  }
  throw Error(`Unmarked cavity did not clear after ${strokes} actual inputs`);
}
try {
  for (const mobile of [false, true]) {
    const cadence = [];
    for (const percent of uiOnly ? [25] : [0, 25, 250]) {
      console.log(JSON.stringify({ starting: mobile ? 'mobile-emulated' : 'desktop', percent }));
      const page = await browser.newPage(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1366, height: 768 } });
      page.on('pageerror', error => report.errors.push(error.message));
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => Boolean(window.__wireTheHouse));
      await page.evaluate(async () => { await Promise.race([window.__wireTheHouse.ready, new Promise((_, reject) => setTimeout(() => reject(Error('Game.ready did not settle within 30 seconds')), 30000))]); });
      await tap(page, mobile, '#start-button');
      const touch = await touchSession(page);
      await select(page, mobile, 'fitting');
      await aim(page, { x: .8, y: 1.55, z: -2.41 });
      await action(page, mobile, touch);
      const intact = await state(page);
      const prompt = await page.locator('#interaction-prompt').textContent();
      assert.equal(intact.activePoint.stage, 'inspect', 'Intact material must prevent unmarked box placement');
      assert.match(prompt, /remaining masonry|widen|deepen|touches/i, 'Failure must report physical collision, not a mandatory spray step');
      assert.equal(intact.workSurface.freeSprayMarks, 0);
      await select(page, mobile, 'hammer');
      await setSpeed(page, mobile, percent);
      if (percent === 25 && !mobile) {
        await page.keyboard.press('Minus'); assert.equal((await state(page)).hammer.speedMultiplier, 0);
        await page.keyboard.press('Equal'); assert.equal((await state(page)).hammer.speedMultiplier, .25);
      }
      if (uiOnly) {
        await setSpeed(page, mobile, 250);
        report.scenarios.push({ platform: mobile ? 'mobile-emulated' : 'desktop', nativeSettingsNoImpacts: true, percentages: [25, 250] });
        await page.close();
        continue;
      }
      await aim(page, { x: .8, y: 1.55, z: -2.41 });
      const before = (await state(page)).workSurface.impactCount;
      if (mobile) await touch(true); else await page.keyboard.down('KeyE');
      for (let i = 0; i < 15; i++) { await aim(page, { x: .8 + i * .009, y: 1.55, z: -2.41 }); await advance(page, 100); }
      if (mobile) await touch(false); else await page.keyboard.up('KeyE');
      const released = await state(page);
      await advance(page, 1200);
      const settled = await state(page);
      assert.equal(settled.workSurface.impactCount, released.workSurface.impactCount, 'Impacts continued after release');
      const hits = settled.workSurface.impactCount - before;
      if (!percent) assert.equal(hits, 0, '0% must fully stop impacts');
      else assert(hits > 0 && settled.activePoint.stage !== 'inspect', 'Hammer must start on unmarked masonry');
      assert.equal(settled.workSurface.freeSprayMarks, 0);
      const result = { platform: mobile ? 'mobile-emulated' : 'desktop', percent, hits, releaseStopped: true, intactPlacementPrompt: prompt };
      if (percent === 250) {
        result.excavationStrokes = await clearBox(page, mobile, touch);
        const point = await page.evaluate(() => ({ ...window.__wireTheHouse.mission.activePoint.position }));
        await select(page, mobile, 'fitting'); await aim(page, point); await action(page, mobile, touch);
        const fitted = await state(page);
        assert.equal(fitted.activePoint.stage, 'fitted', 'A physically cleared unmarked cavity must accept a box');
        assert.equal(fitted.workSurface.freeSprayMarks, 0);
        result.unmarkedFitted = true;
        await page.evaluate(async () => { const g=window.__wireTheHouse;await g.room.brickWall.waitForGeometry();await g.renderer.waitForFrame();g.renderer.render();await g.renderer.waitForFrame(); });
        await page.screenshot({ path: join(out, `${mobile ? 'mobile' : 'desktop'}-unmarked-fitted.png`) });
      }
      cadence.push(hits); report.scenarios.push(result); console.log(JSON.stringify(result));
      await page.close();
    }
    if (!uiOnly) assert(cadence[2] >= cadence[1] * 3, '250% cadence must be clearly faster than 25% on fresh material');
  }
  assert.deepEqual(report.errors, []);
} catch(error) {
  report.failure=String(error.stack??error);report.failureStates=[];
  for(const context of browser.contexts())for(const page of context.pages()){try{report.failureStates.push(await state(page));await page.screenshot({path:join(out,'failure.png')});}catch{}}
  throw error;
} finally { await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2)); await browser.close(); }
console.log(uiOnly ? 'Native settings input does not fire hammer: desktop/mobile PASS' : 'Unmarked physical fitting, native chisel speed, keyboard adjustment and release PASS');
