import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const url = process.argv[2] ?? 'http://127.0.0.1:5362/Electrical-Game/';
const out = process.argv[3] ?? 'output/chisel-width-ui';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { url, mobileIsEmulation: true, fixture: 'Camera placement only; width/type/roll and held strikes use native controls.', scenarios: [] };
const read = page => page.evaluate(() => JSON.parse(window.render_game_to_text()));
const click = async (page, mobile, selector) => {
  await page.locator(selector)[mobile ? 'tap' : 'click']();
  if (selector === '#settings-toggle') await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('#settings-panel')).opacity) > .999);
};
const blade = page => page.evaluate(() => {
  const g = window.__wireTheHouse, w = g.room.brickWall, contact = g.fpsRig.contact(g.renderer.camera, w), mesh = g.fpsRig.flatTip;
  const point = (x, y, z) => mesh.localToWorld(mesh.position.clone().set(x, y, z));
  const left = point(-.0225, 0, -.035), right = point(.0225, 0, -.035);
  return { widthM: left.distanceTo(right), edge: right.clone().sub(left).normalize().toArray(), tip: g.fpsRig.chiselTipWorld.toArray(), axis: contact?.direction.toArray(), contactEdge: contact?.edge.toArray(), visible: mesh.visible };
});
async function settledShot(page, path) {
  await page.evaluate(async () => { const g = window.__wireTheHouse; g.step(0); await g.renderer.waitForFrame(); g.renderer.render(); await g.renderer.waitForFrame(); });
  await page.screenshot({ path });
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
    await click(page, mobile, '#start-button');
    await page.evaluate(() => document.exitPointerLock());
    if (mobile) await click(page, mobile, '[data-tool="hammer"]'); else await page.keyboard.press('Digit4');
    await page.evaluate(() => {
      const g = window.__wireTheHouse, camera = g.renderer.camera;
      camera.position.set(.8, g.player.eyeHeight, -1.3); camera.lookAt(.8, 1.55, g.room.brickWall.volume.frontZ);
      g.player.yaw = camera.rotation.y; g.player.pitch = camera.rotation.x; camera.updateMatrixWorld(true); g.step(0);
    });
    // Present the cutting edge obliquely instead of hiding it behind the body
    // in a straight-on view. Tilt remains a real user-selected tool setting.
    await click(page, mobile, '#settings-toggle');
    await click(page, mobile, '#chisel-tilt'); await click(page, mobile, '#chisel-tilt');
    await click(page, mobile, '#settings-close');
    assert.equal((await read(page)).workSurface.chiselWidthMm, 25, 'Flat blade must default to 2.5cm');
    const widths = [];
    async function settingsWidth(mm) {
      const impacts = (await read(page)).workSurface.impactCount;
      await click(page, mobile, '#settings-toggle');
      const slider = page.locator('#chisel-width'); await slider.scrollIntoViewIfNeeded();
      assert.equal(await slider.getAttribute('min'), '10'); assert.equal(await slider.getAttribute('max'), '50'); assert.equal(await slider.getAttribute('step'), '5');
      if (mobile) {
        const r = await slider.boundingBox(); assert(r);
        await page.touchscreen.tap(r.x + 8 + (r.width - 16) * (mm - 10) / 40, r.y + r.height / 2);
      } else {
        await slider.focus(); await page.keyboard.press('Home');
        for (let i = 10; i < mm; i += 5) await page.keyboard.press('ArrowRight');
      }
      assert.equal(Number(await slider.inputValue()), mm, 'Native width control must select the requested millimetres');
      assert.equal((await read(page)).workSurface.chiselWidthMm, mm);
      assert.equal((await read(page)).workSurface.impactCount, impacts, 'Changing blade width must not strike the wall');
      const layout = await slider.evaluate(input => {
        const r = input.getBoundingClientRect(), p = document.querySelector('#settings-panel').getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, panelBottom: p.bottom, font: parseFloat(getComputedStyle(input.closest('label') ?? input.parentElement).fontSize), width: innerWidth, height: innerHeight, rangeEndIsTopmost: document.elementFromPoint(r.right - 8, r.top + r.height / 2) === input };
      });
      assert(layout.left >= 0 && layout.right <= width + 1 && layout.top >= 0 && layout.bottom <= height + 1 && layout.panelBottom <= height + 1, 'Blade control must fit the viewport');
      assert(layout.font >= 12, 'Blade control label is too small');
      assert(layout.rangeEndIsTopmost, 'Mobile controls or other content cover the 5cm end of the width slider');
      await settledShot(page, `${out}/${name}-settings-${mm}mm.png`);
      await click(page, mobile, '#settings-close');
      await page.waitForTimeout(250);
      const actual = await blade(page);
      assert(Math.abs(actual.widthM - mm / 1000) < 1e-6, `Rendered edge must measure ${mm}mm, measured ${actual.widthM * 1000}`);
      if (widths.length) {
        assert(Math.hypot(...actual.tip.map((n, i) => n - widths[0].tip[i])) < 1e-6, 'Resizing moved the seated chisel tip');
        assert(Math.hypot(...actual.axis.map((n, i) => n - widths[0].axis[i])) < 1e-6, 'Resizing changed the attack axis');
      }
      widths.push({ mm, ...actual, layout });
      await settledShot(page, `${out}/${name}-blade-${mm}mm.png`);
    }
    await settingsWidth(10); await settingsWidth(15); await settingsWidth(50);
    await click(page, mobile, '#settings-toggle');
    await page.locator('#chisel-width').scrollIntoViewIfNeeded();
    await page.locator('#chisel-width').focus();
    await page.keyboard.press('End'); await page.keyboard.press('ArrowRight');
    assert.equal(Number(await page.locator('#chisel-width').inputValue()), 50, 'Native range exceeded 5cm');
    await page.keyboard.press('Comma');
    assert.equal((await read(page)).workSurface.chiselWidthMm, 50, 'Global shortcut must ignore a focused input');
    const unchanged = (await read(page)).workSurface.impactCount;
    await click(page, mobile, '#chisel-type');
    await page.waitForFunction(() => document.querySelector('#chisel-width').disabled);
    assert(await page.locator('#chisel-width').isDisabled(), 'Pointed chisel must disable the blade width control');
    const reason = await page.locator('#chisel-width').evaluate(input => input.parentElement.textContent);
    assert.match(reason, /point|flat/i, 'Disabled blade width must explain pointed/flat distinction');
    assert.equal((await read(page)).workSurface.chiselWidthMm, 50, 'Pointed mode discarded stored blade width');
    await click(page, mobile, '#chisel-type');
    await page.waitForFunction(() => !document.querySelector('#chisel-width').disabled);
    assert(await page.locator('#chisel-width').isEnabled());
    assert.equal(Number(await page.locator('#chisel-width').inputValue()), 50);
    await click(page, mobile, '#chisel-angle');
    if (mobile) await click(page, mobile, '#aim-control-mode');
    await click(page, mobile, '#settings-close');
    const rolled = await blade(page);
    assert(Math.abs(rolled.widthM - .05) < 1e-6);
    assert(Math.abs(rolled.edge.reduce((sum, value, i) => sum + value * rolled.contactEdge[i], 0)) > .9999, 'Visible rolled edge and fracture edge diverged');
    assert.equal((await read(page)).workSurface.impactCount, unchanged, 'Settings interaction fired a strike');
    if (!mobile) {
      await page.keyboard.press('Comma'); assert.equal((await read(page)).workSurface.chiselWidthMm, 45);
      await page.keyboard.press('Period'); await page.keyboard.press('Period'); assert.equal((await read(page)).workSurface.chiselWidthMm, 50);
      for (let i = 0; i < 10; i++) await page.keyboard.press('Comma');
      assert.equal((await read(page)).workSurface.chiselWidthMm, 10, 'Keyboard width must clamp at 1cm');
      for (let i = 0; i < 8; i++) await page.keyboard.press('Period');
      assert.equal((await read(page)).workSurface.chiselWidthMm, 50);
      await page.keyboard.press('Digit3'); await page.keyboard.press('Comma'); assert.equal((await read(page)).workSurface.chiselWidthMm, 50, 'Width shortcut changed another selected tool');
      await page.keyboard.press('Digit4');
    }
    await page.waitForTimeout(400);
    const before = await read(page);
    let session;
    if (mobile) {
      session = await page.context().newCDPSession(page);
      const r = await page.locator('#look-joystick').boundingBox(); assert(r);
      const p = { x: r.x + r.width / 2, y: r.y + r.height / 2, id: 7 };
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
      await page.waitForFunction(() => window.__wireTheHouse.input.actionHeld);
    } else await page.keyboard.down('KeyE');
    const samples = await page.evaluate(() => {
      const g = window.__wireTheHouse, samples = [];
      for (let i = 0; i < 100; i++) { g.step(1 / 60); samples.push([...g.renderer.camera.position.toArray(), ...g.renderer.camera.quaternion.toArray()]); }
      return samples;
    });
    if (mobile) await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); else await page.keyboard.up('KeyE');
    const after = await read(page);
    const maxCameraDelta = Math.max(...samples.flatMap(s => s.map((n, i) => Math.abs(n - samples[0][i]))));
    assert(after.workSurface.impactCount > before.workSurface.impactCount, 'Held 5cm blade produced no physical strike');
    assert(maxCameraDelta < 1e-9, 'Wide blade reintroduced camera shake');
    await settledShot(page, `${out}/${name}-wide-held-impact.png`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight), false, 'Page overflow');
    assert.deepEqual(errors, []);
    report.scenarios.push({ platform, widths, rolled, maxCameraDelta, nativeWideImpacts: after.workSurface.impactCount - before.workSurface.impactCount, errors });
    await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
    await page.close();
  }
  report.passed = true; await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log('PASS: native 1–5cm blade width controls, physical rendered edge, roll alignment, pointed preservation, stable contact and camera, held strikes and desktop/mobile/landscape layouts.');
} finally { await browser.close(); }
