import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const url = process.argv[2] ?? 'http://127.0.0.1:5362/Electrical-Game/';
const out = process.argv[3] ?? 'output/hammer-stance';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 768 }, isMobile: mobile, hasTouch: mobile });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url);
    await page.locator('#start-button')[mobile ? 'tap' : 'click']();
    await page.evaluate(() => document.exitPointerLock());
    await page.waitForTimeout(100);
    await page.keyboard.press('Digit4');
    // Position/aim only; stance selection uses the real keyboard or touch UI.
    await page.evaluate(() => {
      const g = window.__wireTheHouse;
      g.renderer.camera.position.set(0, 1.65, -1.25);
      g.player.yaw = 0; g.player.pitch = -.1; g.step(1 / 60);
    });
    await page.waitForTimeout(200);
    const read = () => page.evaluate(() => {
      const g = window.__wireTheHouse, c = g.renderer.camera, d = c.getWorldDirection(c.position.clone());
      return { pos: c.position.toArray(), focus: c.position.clone().addScaledVector(d, (-2.41 - c.position.z) / d.z).toArray(), side: g.hammerWorkStance.sideDegrees, offset: g.hammerWorkStance.offset.toArray() };
    });
    const initial = await read(), prefix = mobile ? 'mobile' : 'desktop';
    await page.evaluate(async()=>{await window.__wireTheHouse.renderer.waitForFrame();});
    await page.screenshot({ path: `${out}/${prefix}-straight.png` });
    const selectSide = async side => {
      if (mobile) {
        await page.locator('#settings-toggle').tap();
        for (let i = 0; i < 8; i++) {
          if (await page.evaluate(() => window.__wireTheHouse.room.brickWall.chiselSideDegrees) === side) break;
          await page.locator('#chisel-side').tap();
        }
        await page.locator('#settings-close').tap();
      } else {
        let current = await page.evaluate(() => window.__wireTheHouse.room.brickWall.chiselSideDegrees);
        while (current !== side) {
          await page.keyboard.press(current < side ? 'KeyK' : 'KeyJ');
          current = await page.evaluate(() => window.__wireTheHouse.room.brickWall.chiselSideDegrees);
        }
      }
    };
    for (const side of (mobile ? [65, -65, 0] : [70, -70, 0])) {
      await selectSide(side); await page.waitForTimeout(1000);
      const state = await read();
      assert(Math.abs(state.side - side) < .02);
      assert(Math.hypot(...state.focus.map((n, i) => n - initial.focus[i])) < .002, 'Aim moved during stance');
      if (side) {
        assert(Math.sign(state.offset[0]) === -Math.sign(side));
        assert(Math.abs(state.offset[0]) > .35, 'Camera never moved to handle side');
      } else assert(Math.hypot(...state.pos.map((n, i) => n - initial.pos[i])) < .002, 'Stance accumulated walking drift');
      await page.evaluate(async()=>{await window.__wireTheHouse.renderer.waitForFrame();});
      await page.screenshot({ path: `${out}/${prefix}-${side}.png` });
      results.push({ mobile, ...state });
    }
    await selectSide(mobile ? 65 : 70); await page.waitForTimeout(700);
    // Changing tool releases the stance while retaining the selected side for later.
    if (mobile) await page.locator('[data-tool="spray"]').tap();
    else await page.keyboard.press('Digit3');
    await page.waitForTimeout(1000);
    assert(Math.hypot(...(await read()).pos.map((n, i) => n - initial.pos[i])) < .002, 'Tool switch did not restore normal camera');
    if (mobile) await page.locator('[data-tool="hammer"]').tap();
    else await page.keyboard.press('Digit4');
    await page.waitForTimeout(1000);
    assert(Math.abs((await read()).offset[0]) > .35, 'Hammer did not restore its working stance');
    const transition = await page.evaluate(() => {
      const g = window.__wireTheHouse, samples = [];
      window.dispatchEvent(new CustomEvent('wirehouse:side-chisel', { detail: -g.room.brickWall.chiselSideDegrees }));
      for (let i = 0; i < 60; i++) { g.step(1 / 60); samples.push({ side: g.hammerWorkStance.sideDegrees, pos: g.renderer.camera.position.toArray() }); }
      return samples;
    });
    assert(transition[0].side > 1 && transition[0].side < (mobile ? 65 : 70), 'Transition snapped instead of easing');
    assert(transition.at(-1).side === 0);
    assert(transition.every((s, i) => !i || Math.abs(s.side) <= Math.abs(transition[i - 1].side)), 'Return transition oscillates');
    assert(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight), 'Layout overflow');
    assert.deepEqual(errors, []);
    await page.close();
  }
  await writeFile(`${out}/report.json`, JSON.stringify({ url, passed: true, mobileIsEmulation: true, results }, null, 2));
  console.log('PASS: desktop/touch left-right camera orbit, fixed aim, reversible stance, tool switching, smooth transitions and layout');
} finally { await browser.close(); }
