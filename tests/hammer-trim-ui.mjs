import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const url = process.argv[2] ?? 'http://127.0.0.1:5365/Electrical-Game/';
const out = process.argv[3] ?? 'output/hammer-trim-ui';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { url, mobileIsEmulation: true, fixture: 'Production hollow wall opened through ordinary impact API. Camera placement is diagnostic; upward selection and held strokes use native keyboard/touch controls.', scenarios: [] };
async function inspect(page, path, target) {
  const data = await page.evaluate(async t => {
    const g = window.__wireTheHouse, c = g.renderer.camera.clone(false), visible = g.fpsRig.visible;
    c.position.set(t.x + .075, t.y + .05, g.room.brickWall.volume.frontZ + .35);
    c.lookAt(t.x, t.y, g.room.brickWall.volume.frontZ - .038); c.fov = 38;
    c.updateProjectionMatrix(); c.updateMatrixWorld(true);
    await g.renderer.waitForFrame(); g.renderer.prepareMaterials();
    try { g.fpsRig.visible = false; await g.renderer.webgl.render(g.renderer.scene, c); return g.renderer.webgl.domElement.toDataURL('image/png'); }
    finally { g.fpsRig.visible = visible; }
  }, target);
  await writeFile(path, Buffer.from(data.split(',')[1], 'base64'));
}
try {
  for (const mobile of [false, true]) {
    const name = mobile ? 'mobile' : 'desktop';
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 768 }, isMobile: mobile, hasTouch: mobile });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(url); await page.waitForFunction(() => window.__wireTheHouse);
    await page.locator('#start-button')[mobile ? 'tap' : 'click']();
    await page.evaluate(() => document.exitPointerLock());
    if (mobile) await page.locator('[data-tool="hammer"]').tap(); else await page.keyboard.press('Digit4');
    const fixture = await page.evaluate(async () => {
      const g = window.__wireTheHouse, w = g.room.brickWall, v = w.volume, c = g.renderer.camera.clone(false), provider = w.contactProvider;
      // Stop only at the outer-shell depth; do not delete or invent rib nodes.
      w.contactProvider = null; let strikes = 0;
      try {
        for (let pass = 0; pass < 9; pass++) for (let x = .65; x < .98; x += .028) for (let y = 1.39; y < 1.65; y += .028) {
          c.position.set(x, y, v.frontZ + .6); c.lookAt(x, y, v.frontZ); c.updateMatrixWorld(true);
          const hit = v.raycast(c.position, c.getWorldDirection(c.position.clone().set(0, 0, 0)), 1);
          if (hit && v.frontZ - hit.point.z < .027) { w.removeAtAim(c); strikes++; }
        }
      } finally { w.contactProvider = provider; }
      while (v.pendingSupportCount) w.processPendingSupport();
      await w.waitForGeometry();
      window.__trimQA = {
        aim(x, y) {
          const camera = g.renderer.camera;
          camera.position.set(x, g.player.eyeHeight, -1.65); camera.lookAt(x, y, v.frontZ);
          g.player.yaw = camera.rotation.y; g.player.pitch = camera.rotation.x;
          camera.updateMatrixWorld(true); g.step(0);
        },
        protected(floorZ) {
          // Compare every persisted weakness/removal behind the plane, not the
          // displayed depth counter. Missing edits mean pristine material.
          return v.serialize().chunks.flatMap(c => c.edits.filter(e => v.nodePosition(0, 0, e[0] % (v.nz + 2)).z <= floorZ + v.hz + 1e-9).map(e => [c.key, ...e])).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        },
        sample() { const contact = w.contactProvider(g.renderer.camera); return { camera: [...g.renderer.camera.position.toArray(), ...g.renderer.camera.quaternion.toArray()], contact: contact ? { ...contact.point } : null, recoil: g.fpsRig.strikeAmount, rigRotation: g.fpsRig.rotation.x, nodes: v.removedNodeCount, fit:g.fpsRig.hammerFit, tip:g.fpsRig.chiselTipWorld.toArray(), inAir:g.fpsRig.chiselInAir, trimming: v.trimmingState }; }
      };
      return { strikes, removedNodes: v.removedNodeCount, cellDepth: v.hz };
    });
    if (mobile) {
      await page.locator('#settings-toggle').tap();
      for (let i = 0; i < 9 && await page.evaluate(() => window.__wireTheHouse.room.brickWall.chiselTiltDegrees) !== -30; i++) await page.locator('#chisel-tilt').tap();
      assert.equal(await page.locator('#chisel-tilt b').textContent(), '30 deg UP');
      // Select the supported stationary double-tap hold so camera stability is
      // measured without user drag input or a corrective camera reset.
      await page.locator('#aim-control-mode').tap();
      await page.locator('#settings-close').tap();
    } else for (let i = 0; i < 9; i++) await page.keyboard.press('BracketLeft');
    assert.equal(await page.evaluate(() => window.__wireTheHouse.room.brickWall.chiselTiltDegrees), -30);
    const target = await page.evaluate(() => {
      const g = window.__wireTheHouse, w = g.room.brickWall, v = w.volume;
      const candidates = [];
      for (let x = .70; x < .93; x += .008) for (let y = 1.43; y < 1.61; y += .008) {
        window.__trimQA.aim(x, y); const c = w.contactProvider(g.renderer.camera); if (!c) continue;
        const floorZ = v.establishTrimPlane(c.point);
        if (floorZ !== null && c.point.z < v.frontZ - .020 && c.point.z > floorZ + v.hz * 3) candidates.push({ x, y, point: { ...c.point }, floorZ, protrusion: c.point.z - floorZ });
      }
      candidates.sort((a, b) => b.protrusion - a.protrusion);
      // Validate the exposed rib from the settled eye position; the new body
      // stance changes the sight line inside a hollow cell during its approach.
      for(const candidate of candidates){
        window.__trimQA.aim(candidate.x,candidate.y);
        for(let i=0;i<120;i++)g.step(1/60);
        const c=w.contactProvider(g.renderer.camera);if(!c)continue;
        const floorZ=v.establishTrimPlane(c.point);
        if(floorZ!==null&&c.point.z<v.frontZ-.020&&c.point.z>floorZ+v.hz*3)return {...candidate,point:{...c.point},floorZ,protrusion:c.point.z-floorZ};
      }
      return null;
    });
    assert(target, `${name}: no actual exposed inner rib candidate`);
    // Settle the new ergonomic stance before isolating percussion camera movement.
    await page.evaluate(()=>{for(let i=0;i<150;i++)window.__wireTheHouse.step(1/60);});
    await page.waitForTimeout(450);
    await page.evaluate(async () => { await window.__wireTheHouse.renderer.waitForFrame(); });
    await page.screenshot({ path: `${out}/${name}-before.png` });
    await inspect(page, `${out}/${name}-inspection-before.png`, target);
    const before = await page.evaluate(floor => ({ ...window.__trimQA.sample(), protected: window.__trimQA.protected(floor) }), target.floorZ);
    let session;
    if (mobile) {
      session = await page.context().newCDPSession(page);
      const r = await page.locator('#look-joystick').boundingBox(); assert(r);
      const p = { x: r.x + r.width / 2, y: r.y + r.height / 2, id: 9 };
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
      await page.waitForFunction(() => window.__wireTheHouse.input.actionHeld);
    } else await page.keyboard.down('KeyE');
    const samples = await page.evaluate(() => {
      const samples = [];
      for (let i = 0; i < 240; i++) { window.__wireTheHouse.step(1 / 60); samples.push(window.__trimQA.sample()); }
      return samples;
    });
    if (mobile) await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); else await page.keyboard.up('KeyE');
    await page.evaluate(async () => { const g = window.__wireTheHouse; while (g.room.brickWall.volume.pendingSupportCount) g.room.brickWall.processPendingSupport(); await g.room.brickWall.waitForGeometry(); await g.renderer.waitForFrame(); });
    const after = await page.evaluate(floor => ({ ...window.__trimQA.sample(), protected: window.__trimQA.protected(floor), telemetry: window.__wireTheHouse.room.brickWall.telemetry }), target.floorZ);
    const maxCameraDelta = Math.max(...samples.flatMap(s => s.camera.map((n, i) => Math.abs(n - samples[0].camera[i]))));
    const recoilRange = Math.max(...samples.map(s => s.rigRotation)) - Math.min(...samples.map(s => s.rigRotation));
    // A removed rib can expose a backing face beyond the fixed arm workspace.
    // Measure material recession along the original contact line independently
    // of whether the player can still seat the tool on that newly exposed face.
    const materialBehindRidge = await page.evaluate(({ camera, contact }) => {
      if (!contact) return null;
      const g = window.__wireTheHouse, origin = g.renderer.camera.position.clone().fromArray(camera);
      const direction = origin.clone().set(contact.x, contact.y, contact.z).sub(origin).normalize();
      return g.room.brickWall.volume.raycast(origin, direction, 2.35)?.point ?? null;
    }, { camera: before.camera.slice(0, 3), contact: before.contact });
    const ridgeRecession = before.contact ? before.contact.z - (materialBehindRidge?.z ?? target.floorZ) : 0;
    await page.screenshot({ path: `${out}/${name}-after.png` });
    await inspect(page, `${out}/${name}-inspection-after.png`, target);
    const scenario = { mobile, fixture, target, removedNodes: after.nodes - before.nodes, ridgeRecession, materialBehindRidge, maxCameraDelta, recoilRange, before, after, errors };
    report.scenarios.push(scenario); await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
    assert(after.nodes > before.nodes + 3, `${name}: upward native strokes did not shave the protrusion`);
    assert(ridgeRecession >= fixture.cellDepth - 1e-9, `${name}: targeted ridge did not recede by at least one material cell (${ridgeRecession}m)`);
    assert.deepEqual(after.protected, before.protected, `${name}: material or accumulated weakness changed behind the existing cavity floor`);
    assert(samples.some(s => s.trimming), `${name}: native upward tool did not enter trim mode`);
    assert(maxCameraDelta < 1e-9, `${name}: held demolition camera shook by ${maxCameraDelta}`);
    assert(recoilRange > .01, `${name}: removing camera shake also removed tool recoil`);
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight), false);
    await page.close();
  }
  report.passed = true; await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log('PASS: native desktop/touch upward trimming removes actual exposed ribs, preserves all deeper damage/material, holds the camera still and retains tool recoil.');
} finally { await browser.close(); }
