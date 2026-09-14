import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { blockPointerLock } from './browser-safety.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5362/Electrical-Game/';
const out = process.argv[3] ?? 'output/trowel-motion';
await mkdir(out, { recursive: true });
const report = { url, mobileIsEmulation: true, fixture: 'Real native keyboard/touch hold and release. Only initial camera and masonry excavation are authored; production Game.step, rig, timed scoop and projectile launch remain intact. Pointer Lock blocked before navigation.', cases: [], errors: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const near = (a, b, label, tolerance = 1e-7) => assert(Math.abs(a - b) < tolerance, `${label}: ${a} != ${b}`);
const platforms = [
  { name: 'desktop', viewport: { width: 1366, height: 768 }, mobile: false },
  { name: 'mobile', viewport: { width: 390, height: 844 }, mobile: true },
  { name: 'landscape', viewport: { width: 844, height: 390 }, mobile: true },
];
try {
  for (const platform of platforms) {
    if (process.env.QA_PLATFORM && process.env.QA_PLATFORM !== platform.name) continue;
    const context = await browser.newContext({ viewport: platform.viewport, isMobile: platform.mobile, hasTouch: platform.mobile });
    await blockPointerLock(context);
    const page = await context.newPage();
    await page.routeWebSocket('**',()=>{});
    page.on('pageerror', e => report.errors.push({ platform: platform.name, message: e.message }));
    await page.goto(url);
    await page.waitForFunction(() => window.__wireTheHouse?.renderer.renderCamera, null, { timeout: 120000 });
    await page.locator('#start-button')[platform.mobile ? 'tap' : 'click']();
    await page.evaluate(async () => {
      const g = window.__wireTheHouse, v = g.room.brickWall.volume;
      window.__trowelStep = g.step.bind(g); g.step = () => {};
      for (let pass = 0; pass < 3; pass++) for (let x = -.18; x <= .1801; x += .045) for (let y = 1.30; y <= 1.5701; y += .045) {
        const hit = v.raycast({ x, y, z: v.frontZ + .08 }, { x: 0, y: 0, z: -1 }, .24);
        if (hit && v.frontZ - hit.point.z < .07) v.impact({ point: hit.point, direction: { x: 0, y: 0, z: -1 }, chisel: 'flat', widthM: .05, energyJ: 8 });
      }
      g.room.brickWall.flushGeometry(); await g.room.brickWall.waitForGeometry();
      window.__trowelLaunches = [];
      const spawn = g.mortar.spawnClod.bind(g.mortar);
      g.mortar.spawnClod = (point, velocity, mass, ...rest) => {
        const t = g.fpsRig.tools.get('trowel'), V = g.renderer.camera.position.constructor;
        t.updateWorldMatrix(true, true);
        const anchor = t.localToWorld(new V().fromArray(t.userData.releasePoint));
        window.__trowelLaunches.push({ point: point.toArray(), anchor: anchor.toArray(), mass, motion: structuredClone(g.mortar.throwFeedback.motion) });
        return spawn(point, velocity, mass, ...rest);
      };
    });
    if (platform.mobile) await page.locator('[data-tool="trowel"]').tap(); else await page.keyboard.press('Digit7');
    const cdp = platform.mobile ? await context.newCDPSession(page) : null;
    const step = seconds => page.evaluate(seconds => {
      const count = Math.ceil(seconds * 120 - 1e-9);
      if (!count) { window.__trowelStep(0); return; }
      for (let i = 0; i < count; i++) window.__trowelStep(seconds / count);
    }, seconds);
    const held = async down => {
      if (cdp) {
        if (down) {
          const box = await page.locator('#look-joystick').boundingBox();
          assert(box, 'Mobile tool input is absent');
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 17, x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
        } else await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else await page.keyboard[down ? 'down' : 'up']('KeyE');
    };
    const state = () => page.evaluate(() => {
      const g = window.__wireTheHouse, rig = g.fpsRig, t = rig.tools.get('trowel'), load = t.getObjectByName('trowel-load');
      const V = g.renderer.camera.position.constructor, Q = g.renderer.camera.quaternion.constructor;
      t.updateWorldMatrix(true, true);
      const normal = new V(0, 1, 0).applyQuaternion(t.getWorldQuaternion(new Q())).applyQuaternion(rig.getWorldQuaternion(new Q()).invert());
      const p = load.geometry.getAttribute('position'), rest = load.geometry.getAttribute('restPosition');
      let bottomMotion = 0, shapeChange = 0, signature = 0;
      for (let i = 0; i < p.count; i++) {
        const vertex=load.getVertexPosition(i,new V());
        const movement = Math.hypot(vertex.x - rest.getX(i), vertex.y - rest.getY(i), vertex.z - rest.getZ(i));
        if (rest.getY(i) <= 0) bottomMotion = Math.max(bottomMotion, movement);
        shapeChange = Math.max(shapeChange, movement);
        signature += vertex.x * (i % 7 + 1) + vertex.y * (i % 13 + 1) + vertex.z * (i % 17 + 1);
      }
      const masses = g.mortar.telemetry;
      return {
        selected: g.selectedTool, motion: structuredClone(g.mortar.throwFeedback.motion), feedback: structuredClone(g.mortar.throwFeedback),
        handForward: new V(0,1,0).applyQuaternion(rig.armSets.get('trowel').find(a=>a.side===1).hand.getWorldQuaternion(new Q())).toArray(),
        normal: normal.toArray(), grip: t.localToWorld(new V().fromArray(t.userData.gripPoint)).toArray(), pose: rig.debugPose(),
        frontmost: Math.min(...[[.125,-.17,-.025],[.241,-.17,-.025],[.183,-.17,-.260]].map(p=>t.localToWorld(new V().fromArray(p)).z)),
        tip: t.localToWorld(new V().fromArray(t.userData.tipPoint)).toArray(), releaseAnchor: t.localToWorld(new V().fromArray(t.userData.releasePoint)).toArray(),
        screen: {grip: t.localToWorld(new V().fromArray(t.userData.gripPoint)).project(g.renderer.camera).toArray(), tip: t.localToWorld(new V().fromArray(t.userData.tipPoint)).project(g.renderer.camera).toArray(), load: load.getWorldPosition(new V()).project(g.renderer.camera).toArray()},
        camera: g.renderer.camera.position.toArray(), wallFront: g.room.brickWall.volume.frontZ,
        loadVisible: load.visible, loadCount: t.children.filter(o => o.name === 'trowel-load').length, bottomMotion, shapeChange, signature,
        mass: masses.launchedKg, stuck: masses.stuckKg, stored: masses.stuckKg + masses.floorKg + masses.restingKg + masses.movingKg,
        launches: window.__trowelLaunches.slice(), renderError: g.renderer.renderError, pointerLock: document.pointerLockElement?.id ?? null,
        viewport: {width:innerWidth,height:innerHeight}, toolbarTop: document.querySelector('#mobile-tool-slider')?.getBoundingClientRect().height ? document.querySelector('#mobile-tool-slider').getBoundingClientRect().top : innerHeight,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    const capture = async name => {
      await page.evaluate(async () => { const r = window.__wireTheHouse.renderer; await r.waitForFrame(); r.render(); await r.waitForFrame(); });
      await page.screenshot({ path: `${out}/${platform.name}-${name}.png` });
    };
    const verifyPose = (s, label) => {
      report.lastState={label,state:s};
      assert.equal(s.selected, 'trowel', `${label}: selection changed without tool input`);
      assert(s.frontmost>s.wallFront+.01, `${label}: blade penetrated wall (clearance ${s.frontmost-s.wallFront}m)`);
      assert.equal(s.loadCount, 1, `${label}: duplicate mortar load`);
      if(s.viewport.height<520)assert((1-s.screen.grip[1])*s.viewport.height*.5 < s.toolbarTop-12, `${label}: hand hidden by landscape tool belt`);
      assert.equal(s.pointerLock, null); assert.equal(s.renderError, ''); assert(!s.overflow, `${label}: horizontal overflow`);
      const primary = s.pose.arms.find(a => a.gripRole === 'primary'); assert(primary, `${label}: no hand on handle`);
      const handAxis=s.handForward, forearmAxis=primary.wrist.map((v,i)=>v-primary.elbow[i]);
      s.wristBendDegrees=Math.acos(Math.max(-1,Math.min(1,handAxis.reduce((sum,v,i)=>sum+v*forearmAxis[i],0)/Math.hypot(...handAxis)/Math.hypot(...forearmAxis))))*180/Math.PI;
      assert(s.wristBendDegrees<.5, `${label}: wrist/metacarpal axis diverges from forearm (${s.wristBendDegrees}deg)`);
      if(['ready','prepare'].includes(s.motion.stage))assert(primary.elbow[0] > s.camera[0], `${label}: right elbow crosses left of torso`);
      assert(distance(primary.grip, s.grip) < .001, `${label}: hand separated from grip`);
      for (const arm of s.pose.arms) {
        near(distance(arm.shoulder, arm.elbow), .31, `${label}: upper arm`, 1e-5);
        near(distance(arm.elbow, arm.wrist), .27, `${label}: forearm`, 1e-5);
      }
      near(s.mass, s.stored, `${label}: mortar mass conservation`, 1e-6);
    };
    for (const wallDistance of [.45, .8, 1.4]) {
      await page.evaluate(d => {
        const g = window.__wireTheHouse, c = g.renderer.camera;
        g.hammerWorkStance.restore(c);
        g.player.workPosition.locked = false; g.player.workPosition.released = false;
        c.position.set(0, g.player.eyeHeight, g.room.brickWall.volume.frontZ + d);
        c.lookAt(0, 1.44, g.room.brickWall.volume.frontZ - .04);
        g.player.yaw = c.rotation.y; g.player.pitch = c.rotation.x;
      }, wallDistance);
      await step(.25);
      const phases = [], record = async (name, screenshot = true) => {
        const s = await state(); phases.push({ name, state: s });
        if (screenshot) await capture(`${wallDistance}-${name}`);
        verifyPose(s, `${platform.name}/${wallDistance}/${name}`);
        return s;
      };
      const idle = await record('open'); assert(idle.normal[1] > .9); assert(idle.loadVisible);
      for (const [part, projected] of Object.entries(idle.screen)) assert(Math.abs(projected[0]) < .94 && Math.abs(projected[1]) < .94, `${platform.name}/${wallDistance}: open ${part} lies outside visible gameplay frame (${projected})`);
      await page.keyboard.press('KeyP');
      await page.evaluate(() => dispatchEvent(new CustomEvent('wirehouse:mortar-pack')));
      await step(.05);
      const noPack = await state(); near(noPack.mass, idle.mass, 'Pack/P must not add mortar'); near(noPack.stored, idle.stored, 'Pack/P must not inject mortar');
      await held(true); await step(.475);
      const prepare = await record('prepare'); assert(prepare.feedback.holding); assert(prepare.normal[1] > .85); near(prepare.mass, idle.mass, 'Hold must not cast');
      await held(false); await step(0);
      const released = await record('button-up', false); near(released.mass, idle.mass, 'Button-up must wait for wrist release');
      await step(.08);
      const drive = await record('drive'); near(drive.mass, idle.mass, 'Drive must retain scoop'); assert(drive.loadVisible);
      assert(Math.abs(drive.signature - prepare.signature) > .0001, 'Load remained rigid during acceleration');
      assert(drive.shapeChange > .0002, 'Load did not deform'); assert(drive.bottomMotion < 1e-6, 'Load contact patch slid through blade');
      await step(.08);
      const flip = await record('flip'); near(flip.mass - idle.mass, .65, 'Exactly one scoop at wrist flip'); assert(flip.normal[1] < -.45, 'Blade did not turn over at release'); assert(!flip.loadVisible, 'Released scoop remains on blade');
      const launches = flip.launches.slice(idle.launches.length); near(launches.reduce((sum, p) => sum + p.mass, 0), .65, 'Physical projectile mass');
      for (const launch of launches) assert(distance(launch.point, launch.anchor) < .08, `Projectile detached far from blade: ${JSON.stringify(launch)}`);
      await step(.08);
      const follow = await record('follow-through'); assert(!follow.loadVisible); assert(follow.normal[1] < -.4); near(follow.mass, flip.mass, 'Follow-through duplicated scoop');
      await step(.59);
      const reset = await record('reset'); assert(reset.normal[1] > .9); assert(reset.loadVisible); near(reset.mass, flip.mass, 'Reset duplicated scoop');
      report.cases.push({ platform: platform.name, wallDistance, phases });
      console.log(JSON.stringify({ platform: platform.name, wallDistance, passed: true, scoopKg: flip.mass - idle.mass, releaseNormal: flip.normal, deformationM: drive.shapeChange }));
    }
    await context.close();
  }
  assert.deepEqual(report.errors, []); report.passed = true;
} catch (e) { report.failure = String(e.stack ?? e); throw e; }
finally { await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); await browser.close(); }
