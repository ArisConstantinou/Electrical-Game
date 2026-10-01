import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { blockPointerLock } from './browser-safety.mjs';

const dist = process.argv.find(arg => arg.startsWith('--dist='))?.slice(7);
const expectBug = process.argv.includes('--expect-bug');
const benchmarkOnly = process.argv.includes('--benchmark-only');
const anywhere = process.argv.includes('--anywhere');
const beforeSurfaces = process.argv.includes('--before-surfaces');
const label = (expectBug || beforeSurfaces ? 'before' : dist ? 'candidate' : 'live') + (benchmarkOnly ? '-performance' : '');
const out = path.resolve(`output/playwright/${anywhere ? 'spray-anywhere' : 'spray-all-walls'}`, label);
await mkdir(out, { recursive: true });
const report = { label, dist: dist ?? null, url: 'http://127.0.0.1:5365/Electrical-Game/', cases: [], errors: [] };
const census = () => {
  const json = execFileSync('powershell.exe', ['-NoProfile', '-Command',
    'Get-CimInstance Win32_Process -Filter "Name=\'chrome.exe\'" | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress'],
    { windowsHide: true, encoding: 'utf8' }).trim();
  const data = json ? JSON.parse(json) : [];
  return Array.isArray(data) ? data : [data];
};
const server = await chromium.launchServer({ channel: 'chrome', headless: true });
const rootPid = server.process().pid;
const browser = await chromium.connect(server.wsEndpoint());
let owned = [rootPid];
try {
  for (const mobile of expectBug || beforeSurfaces || benchmarkOnly ? [false] : [false, true]) {
    const platform = mobile ? 'mobile-emulation' : 'desktop';
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 720 },
      isMobile: mobile, hasTouch: mobile });
    await blockPointerLock(context);
    if (dist) await context.route('**/Electrical-Game/**', async route => {
      const url = new URL(route.request().url());
      const relative = decodeURIComponent(url.pathname.replace('/Electrical-Game/', '')) || 'index.html';
      const file = path.resolve(dist, relative);
      if (!file.startsWith(path.resolve(dist) + path.sep)) return route.abort();
      if (!(await stat(file).catch(() => null))?.isFile()) return route.continue();
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json' }[path.extname(file)];
      await route.fulfill({ body: await readFile(file), ...(type ? { contentType: type } : {}) });
    });
    const page = await context.newPage();
    await page.routeWebSocket('**', () => {});
    page.on('pageerror', error => report.errors.push({ platform, message: error.message }));
    await page.goto(report.url + '?mansion=preview');
    await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 120000 });
    await page.locator('#apprentice-count').selectOption('0');
    await page.locator('#start-button')[mobile ? 'tap' : 'click']();
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('#start-screen')).opacity) < .01);
    await page.evaluate(anywhere => {
      const g = window.__wireTheHouse;
      window.__sprayStep = g.step.bind(g); g.step = () => {};
      if (anywhere) g.player.update = () => {};
      g.mission.activePoint.setStage('inspect');
    }, anywhere);
    const step = async n => page.evaluate(n => { for (let i = 0; i < n; i++) window.__sprayStep(1 / 60, 1 / 60, false); }, n);
    const aim = async (eye, target) => page.evaluate(({ eye, target }) => {
      const g = window.__wireTheHouse, c = g.renderer.camera;
      c.position.fromArray(eye); c.lookAt(...target);
      g.player.yaw = c.rotation.y; g.player.pitch = c.rotation.x;
      c.updateWorldMatrix(true, false); g.actionCooldown = 0;
      const spray = g.interaction.sprayAim?.(c);
      return { original: Boolean(g.room.brickWall.aim(c)), mansion: g.room.mansionWing.aimMasonry(c)?.wall.group.name ?? null,
        sprayAim: Boolean(spray), surface: spray?.object.name ?? null };
    }, { eye, target });
    const snapshot = async () => page.evaluate(() => {
      const g = window.__wireTheHouse, marks = [];
      g.room.traverse(object => { if (object.userData.sprayPaint) marks.push({ wall: object.parent.name,
        vertices: object.geometry.drawRange.count, capacity: object.geometry.getAttribute('position').count,
        position: object.getWorldPosition(g.renderer.camera.position.clone()).toArray() }); });
      return { original: g.room.brickWall.freeMarkCount, total: g.interaction.freeSprayMarks ?? g.room.brickWall.freeMarkCount,
        marks, points: g.mission.points.map(p => ({ id: p.definition.id, stage: p.stage, position: p.position.toArray() })),
        graphics: g.renderer.lifecycleTelemetry };
    });
    const hold = async () => {
      if (mobile) {
        // Current controls: a short right-stick tap toggles continuous USE;
        // holding the right stick instead requests a jump.
        const button = page.locator('#look-joystick'), box = await button.boundingBox();
        assert(box, 'Mobile action stick missing');
        const cdp = await context.newCDPSession(page);
        const tap = async () => {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 9 }] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        };
        await tap();
        await step(18);
        await tap(); await cdp.detach();
      } else {
        await page.mouse.move(640, 360); await page.mouse.down(); await step(18); await page.mouse.up();
      }
      await step(1);
      await page.evaluate(async () => { const r = window.__wireTheHouse.renderer; await r.waitForFrame(); r.render(); await r.waitForFrame(); });
    };
    const stroke = async (eye, targets) => {
      let tap, cdp;
      if (mobile) {
        const box = await page.locator('#look-joystick').boundingBox(); cdp = await context.newCDPSession(page);
        tap = async () => {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 11 }] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        };
        await tap();
      } else await page.mouse.down();
      for (const target of targets) { await aim(eye, target); await step(1); }
      if (mobile) { await tap(); await cdp.detach(); } else await page.mouse.up();
      await step(1);
    };
    if (mobile) assert.equal(await page.evaluate(() => window.__wireTheHouse.selectedTool), 'spray');
    else await page.keyboard.press('Digit3');
    if (anywhere) {
      const surfaces = [
        { name: 'floor', eye: [0, 1.68, -.4], target: [0, 0, -1.4] },
        { name: 'ceiling', eye: [0, 1.68, .5], target: [0, 3, -.5] },
        { name: 'column', eye: [2.72, 1.68, -1.2], target: [2.72, 1.68, -2.5] },
        { name: 'olive-trunk', eye: [-5.35, .8, 2.8], target: [-6.35, .8, 2.8] },
      ];
      // The scanned court tree intentionally disables gameplay raycasts.
      const court = await page.evaluate(() => {
        const g = window.__wireTheHouse, trunk = g.room.getObjectByName('courtyard_tree_trunk');
        if (!trunk) throw new Error('Scanned court tree not ready');
        trunk.updateWorldMatrix(true, false);
        const tree = g.room.getObjectByName('Existing olive tree retained in open mansion court');
        const wanted = tree.getWorldPosition(g.renderer.camera.position.clone()); wanted.y += 1.4;
        const geometry = trunk.geometry, index = geometry.index, p = geometry.getAttribute('position');
        const a = wanted.clone(), b = wanted.clone(), c = wanted.clone(); let best = Infinity, target, normal;
        for (let i = 0; i < (index?.count ?? p.count); i += 3) {
          a.fromBufferAttribute(p, index ? index.getX(i) : i).applyMatrix4(trunk.matrixWorld);
          b.fromBufferAttribute(p, index ? index.getX(i + 1) : i + 1).applyMatrix4(trunk.matrixWorld);
          c.fromBufferAttribute(p, index ? index.getX(i + 2) : i + 2).applyMatrix4(trunk.matrixWorld);
          const centre = a.clone().add(b).add(c).multiplyScalar(1 / 3), score = centre.distanceToSquared(wanted);
          if (score < best) { best = score; target = centre; normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize(); }
        }
        return { name: 'scanned-trunk', eye: target.clone().addScaledVector(normal, 1).toArray(), target: target.toArray() };
      });
      surfaces.push(court);
      for (const surface of surfaces) {
        const selected = await aim(surface.eye, surface.target), b = await snapshot(); await hold();
        const axis = ['floor', 'ceiling'].includes(surface.name) ? 0 : 1;
        const targets = Array.from({ length: 13 }, (_, i) => { const target = [...surface.target]; target[axis] += -.15 + i * .025; return target; });
        await stroke(surface.eye, targets);
        await aim(surface.eye, surface.target);
        const frames = await page.evaluate(async () => {
          const g = window.__wireTheHouse, r = g.renderer, times = [];
          let previous = performance.now(); const calls = r.gpu.info.calls;
          for (let i = 0; i < 32; i++) {
            await r.waitForFrame(); await new Promise(requestAnimationFrame);
            const now = performance.now(); if (i >= 8) times.push(now - previous); previous = now;
            window.__sprayStep(1 / 60, 1 / 60, true); await r.waitForFrame();
          }
          const fps = 1000 / (times.reduce((a, b) => a + b) / times.length); times.sort((a, b) => a - b);
          g.hud.updateFps(fps); r.render(); await r.waitForFrame();
          return { fps, p95Ms: times[Math.floor(times.length * .95)], maxMs: times.at(-1), renderCalls: r.gpu.info.calls - calls };
        });
        assert(frames.renderCalls >= 32, 'Surface capture did not render actual frames');
        const a = await snapshot();
        await page.screenshot({ path: path.join(out, `${platform}-${surface.name}.png`) });
        const painted = a.total > b.total;
        report.cases.push({ platform, name: surface.name, selected, painted, frames, marks: a.marks.filter(m => !b.marks.some(old => old.wall === m.wall && old.vertices === m.vertices)) });
        if (beforeSurfaces && surface.name !== 'column') assert.equal(painted, false, `${surface.name}: baseline already paints`);
        else assert(painted, `${surface.name}: held input did not paint`);
        if (!beforeSurfaces) assert(selected.sprayAim, `${surface.name}: initial crosshair missed`);
      }
      // A real equipment model in front of a wall must receive the paint.
      // Reuse its authored geometry; no invisible picking box stands in for it.
      await page.evaluate(() => {
        const g = window.__wireTheHouse, bucket = g.mixing.models.bucket.clone(true);
        bucket.name = 'Spray test equipment bucket'; bucket.visible = true;
        bucket.position.set(3.05, 1.1, 0); bucket.rotation.set(0, 0, 0); bucket.scale.setScalar(1);
        g.renderer.scene.add(bucket); window.__sprayBucket = bucket;
      });
      await aim([2.35, 1.35, 0], [3.9, 1.35, 0]);
      const bucketBefore = await snapshot(); await hold(); const bucketAfter = await snapshot();
      const bucketVertices = await page.evaluate(() => {
        let count = 0; window.__sprayBucket.traverse(o => { if (o.userData.sprayPaint) count += o.geometry.drawRange.count; });
        return count;
      });
      if (beforeSurfaces) assert.equal(bucketVertices, 0, 'Baseline already paints equipment');
      else {
        assert(bucketVertices > 0, 'Closest equipment surface was not painted');
        assert.deepEqual(bucketAfter.marks, bucketBefore.marks, 'Spray passed through equipment and painted the wall behind it');
      }
      report.cases.push({ platform, name: 'equipment-occludes-wall', bucketVertices });
      if (!beforeSurfaces) {
        await page.evaluate(() => {
          const bucket = window.__sprayBucket;
          bucket.position.z = .6; bucket.rotation.y = .5; bucket.scale.set(1.2, .8, 1.1);
        });
        await aim([2.35, 1.35, .6], [3.9, 1.35, .6]); await hold();
        const moved = await page.evaluate(() => {
          const bucket = window.__sprayBucket; bucket.updateWorldMatrix(true, true);
          let count = 0, attached = true;
          bucket.traverse(o => { if (o.userData.sprayPaint) { count += o.geometry.drawRange.count; attached &&= o.matrixWorld.equals(o.parent.matrixWorld); } });
          return { count, attached };
        });
        assert(moved.count > bucketVertices && moved.attached, 'Moved/scaled equipment lost its target or detached its paint');
        assert.deepEqual((await snapshot()).marks, bucketBefore.marks, 'Moving equipment exposed the wall to spray');
        report.cases.push({ platform, name: 'equipment-transform', ...moved });
      }
      await page.screenshot({ path: path.join(out, `${platform}-equipment.png`) });
      await page.evaluate(() => {
        window.__sprayBucket.traverse(o => { if (o.userData.sprayPaint) { o.geometry.dispose(); o.material.dispose(); } });
        window.__sprayBucket.removeFromParent();
      });
      await aim([2.7, 1.68, 0], [3.9, 1.68, -.6]);
      // Move once per action tick: this reproduces the elongated, pinched dabs.
      await stroke([2.7, 1.68, 0], Array.from({ length: 13 }, (_, i) => [3.9, 1.68, -.6 + i * .1]));
      await page.evaluate(async () => { const r = window.__wireTheHouse.renderer; await r.waitForFrame(); r.render(); await r.waitForFrame(); });
      await page.screenshot({ path: path.join(out, `${platform}-continuous-line.png`) });
      if (!mobile) {
        const png = (await readFile(path.join(out, `${platform}-continuous-line.png`))).toString('base64');
        const width = await page.evaluate(async png => {
          const img = new Image(); img.src = `data:image/png;base64,${png}`; await img.decode();
          const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
          const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data, widths = [], metres = [];
          const camera = window.__wireTheHouse.renderer.camera;
          const onWall = (x, y) => {
            const direction = camera.position.clone().set(x / canvas.width * 2 - 1, 1 - y / canvas.height * 2, .5)
              .unproject(camera).sub(camera.position).normalize();
            return camera.position.clone().addScaledVector(direction, (3.91 - camera.position.x) / direction.x);
          };
          for (let x = 20; x < 580; x++) {
            let blue = 0;
            for (let y = 344; y < 372; y++) {
              const i = (y * canvas.width + x) * 4;
              if (pixels[i + 2] > pixels[i] + 60 && pixels[i + 2] > pixels[i + 1] + 25) blue++;
            }
            widths.push(blue);
            metres.push(blue * onWall(x, 360).distanceTo(onWall(x, 361)));
          }
          widths.sort((a, b) => a - b);
          metres.sort((a, b) => a - b);
          return { p10: widths[Math.floor(widths.length * .1)], p90: widths[Math.floor(widths.length * .9)],
            metresP10: metres[Math.floor(metres.length * .1)], metresP90: metres[Math.floor(metres.length * .9)],
            gaps: widths.filter(n => !n).length };
        }, png);
        report.cases.push({ platform, name: 'continuous-line', width });
        if (beforeSurfaces) assert(width.metresP10 < width.metresP90 * .7, 'Before fixture did not reproduce the pinched stroke');
        else assert(width.gaps === 0 && width.metresP10 >= width.metresP90 * .8, 'Continuous line has gaps or pinched oval joins');
      } else report.cases.push({ platform, name: 'continuous-line' });
      if (beforeSurfaces) { await context.close(); continue; }
    }
    // Same camera, viewport, tool and held-use sequence for the reported bug.
    const rightAim = await aim([2.7, 1.68, 0], [3.9, 1.68, 0]);
    const before = await snapshot(); await hold(); const after = await snapshot();
    await page.screenshot({ path: path.join(out, `${platform}-right-wall.png`) });
    report.cases.push({ platform, name: 'right-wall-held-spray', aim: rightAim, before, after });
    assert.equal(rightAim.mansion, 'Original room right practice masonry');
    assert.equal(after.original, before.original, 'Side-wall spray changed the original wall');
    assert.deepEqual(after.points, before.points, 'Side-wall spray changed electrical installation points');
    if (expectBug) { assert.equal(after.total, before.total, 'Before fixture no longer reproduces the bug'); }
    else if (!benchmarkOnly) {
    assert(after.total > before.total && after.marks.some(mark => mark.wall === rightAim.mansion && mark.vertices > 0), 'Held spray did not paint the right wall');
    // Original wall keeps its established canvas/chase bookkeeping.
    await aim([0, 1.68, -1.4], [0, 1.68, -2.4]);
    const originalBefore = await snapshot(); await hold(); const originalAfter = await snapshot();
    assert(originalAfter.original > originalBefore.original, 'Original wall no longer paints');
    assert.equal(originalAfter.points[0].stage, 'marked', 'Original installation marking stage lost');
    report.cases.push({ platform, name: 'original-wall', before: originalBefore.original, after: originalAfter.original });
    // A real open window must remain air, including after painting elsewhere.
    const air = await aim([-2.9, 1.68, 2], [-3.91, 1.68, 2]);
    const airBefore = await snapshot(); await hold(); const airAfter = await snapshot();
    assert.equal(air.sprayAim, false, 'Spray selected an invisible wall across the open window');
    assert.equal(airAfter.total, airBefore.total, 'Spray painted empty air');
    report.cases.push({ platform, name: 'window-air', aim: air });
    // Continuous paint across neighbouring bricks, followed by a distinct
    // colour/dot stroke. A released stroke must not bridge to its new start.
    await aim([2.7, 1.68, -.2], [3.9, 1.68, -.2]);
    {
      let mobileTap, mobileCdp;
      if (mobile) {
        const box = await page.locator('#look-joystick').boundingBox();
        mobileCdp = await context.newCDPSession(page);
        mobileTap = async () => {
          await mobileCdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 7 }] });
          await mobileCdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        };
        await mobileTap();
      } else await page.mouse.down();
      for (let i = 0; i < 8; i++) { await aim([2.7, 1.68, 0], [3.9, 1.48 + i * .04, -.28 + i * .08]); await step(3); }
      if (mobile) { await mobileTap(); await mobileCdp.detach(); } else await page.mouse.up();
      await step(1);
      await page.evaluate(() => window.__wireTheHouse.interaction.setSpray('dots', 0xd81b28));
      await aim([2.7, 1.68, 0], [3.9, 1.95, -.3]); await hold();
      await page.evaluate(() => window.__wireTheHouse.interaction.setSpray('live', 0x087fce));
      await aim([2.7, 1.68, 0], [3.9, 1.68, 0]); await hold();
      await page.screenshot({ path: path.join(out, `${platform}-continuous-and-dots.png`) });
      const line = await page.evaluate(() => {
        const wall = window.__wireTheHouse.room.mansionWing.editableWalls.get('Original room right practice masonry');
        const mesh = wall.children.find(object => object.userData.sprayPaint), p = mesh.geometry.getAttribute('position'), c = mesh.geometry.getAttribute('color');
        let min = Infinity, max = -Infinity, red = 0, blue = 0;
        for (let i = 0; i < mesh.geometry.drawRange.count; i++) { min = Math.min(min, p.getZ(i)); max = Math.max(max, p.getZ(i));
          if (c.getX(i) > c.getZ(i)) red++; else blue++; }
        return { span: max - min, red, blue };
      });
      assert(line.span > .5 && line.red > 0 && line.blue > 0, 'Continuous line or selected colour lost');
      report.cases.push({ platform, name: 'continuous-line-and-coloured-dots', ...line });
    }
    // Editor additions must work immediately and follow non-uniform transforms.
    for (const kind of ['brick-wall', 'concrete-wall']) {
      const setup = await page.evaluate(kind => {
        const g = window.__wireTheHouse, wing = g.room.mansionWing;
        const wall = wing.addEditorWall(`spray-${kind}`, kind, 3);
        wall.position.set(1, 0, 1); wall.rotation.y = .47; wall.scale.multiply(g.renderer.camera.position.clone().set(1.1, 1, .85));
        wall.updateWorldMatrix(true, true); wing.obstaclesAt(0);
        window.__sprayEditorWall = wall;
        const target = wall.localToWorld(g.renderer.camera.position.clone().set(.22, 1.68, .12));
        const normal = g.renderer.camera.position.clone().set(0, 0, 1).transformDirection(wall.matrixWorld);
        return { name: wall.name, target: target.toArray(), eye: target.clone().add(normal).toArray() };
      }, kind);
      await aim(setup.eye, setup.target); const b = await snapshot(); await hold(); const a = await snapshot();
      assert(a.total > b.total && a.marks.some(m => m.wall === setup.name), `${kind}: new editor wall not painted`);
      const transform = await page.evaluate(() => {
        const g = window.__wireTheHouse, wall = window.__sprayEditorWall;
        const marks = wall.children.find(o => o.userData.sprayPaint), local = marks.geometry.getAttribute('position').array.slice(0, 9);
        wall.position.x += .5; wall.rotation.y += .3; wall.scale.y = .9; wall.updateWorldMatrix(true, true);
        const follows = marks.matrixWorld.equals(wall.matrixWorld);
        const target = wall.localToWorld(g.renderer.camera.position.clone().set(.22, 1.68, -.12));
        const normal = g.renderer.camera.position.clone().set(0, 0, -1).transformDirection(wall.matrixWorld);
        return { follows, local: Array.from(local), target: target.toArray(), eye: target.clone().add(normal).toArray() };
      });
      assert(transform.follows, 'Paint detached after editor transform');
      await aim(transform.eye, transform.target); const rb = await snapshot(); await hold(); const ra = await snapshot();
      assert(ra.total > rb.total, `${kind}: reverse face not painted`);
      await page.screenshot({ path: path.join(out, `${platform}-${kind}.png`) });
      await page.evaluate(() => { window.__sprayEditorWall.visible = false; });
      const hidden = await snapshot(); await hold(); assert.equal((await snapshot()).total, hidden.total, 'Hidden wall was painted');
      await page.evaluate(() => { window.__wireTheHouse.room.mansionWing.removeEditorWall(window.__sprayEditorWall); });
      report.cases.push({ platform, name: kind, before: b.total, after: a.total, reverse: ra.total, transform, hiddenRejected: true });
    }
    // Authored concrete walls are registered as assets, not editor walls.
    const asset = await page.evaluate(() => {
      const g = window.__wireTheHouse, wing = g.room.mansionWing;
      const wall = wing.addEditorWall('spray-authored-concrete', 'concrete-wall', 3);
      wall.position.set(1, 0, 1); wall.userData.levelEditorKind = 'asset';
      wall.userData.levelEditorLabel = 'Concrete retaining wall';
      wing.editableWalls.delete(wall.name); wing.editableAssets.set(wall.name, wall);
      window.__sprayAsset = wall;
      return wall.name;
    });
    await aim([1, 1.68, 2], [1, 1.68, 1]); const assetBefore = await snapshot(); await hold(); const assetAfter = await snapshot();
    assert(assetAfter.total > assetBefore.total && assetAfter.marks.some(m => m.wall === asset), 'Authored concrete wall asset not painted');
    await page.evaluate(() => { const g = window.__wireTheHouse; g.room.mansionWing.editableAssets.delete(window.__sprayAsset.name);
      g.room.mansionWing.removeEditorWall(window.__sprayAsset); });
    report.cases.push({ platform, name: 'authored-concrete-asset', painted: true });
    }
    if (!mobile) {
      await aim([2.7, 1.68, 0], [3.9, 1.68, 0]);
      report.gpu = await page.evaluate(async () => {
        const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        return { vendor: adapter.info.vendor, architecture: adapter.info.architecture, device: adapter.info.device,
          description: adapter.info.description, fallback: adapter.isFallbackAdapter };
      });
      // CPU ray selection is measured separately from rendered-frame pacing.
      report.aimMs = !expectBug ? await page.evaluate(() => {
        const g = window.__wireTheHouse;
        for (let i = 0; i < 10; i++) g.interaction.sprayAim(g.renderer.camera);
        const start = performance.now(); for (let i = 0; i < 100; i++) g.interaction.sprayAim(g.renderer.camera);
        return (performance.now() - start) / 100;
      }) : null;
      const performanceCase = async held => {
        if (held) await page.mouse.down();
        const result = await page.evaluate(async () => {
          const g = window.__wireTheHouse, intervals = []; let previous = performance.now(), maxDrawCalls = 0;
          const beforeCalls = g.renderer.gpu.info.calls;
          for (let i = 0; i < 180; i++) {
            await g.renderer.waitForFrame(); await new Promise(requestAnimationFrame); const now = performance.now();
            if (i >= 30) intervals.push(now - previous); previous = now;
            window.__sprayStep(1 / 60, 1 / 60, true);
            await g.renderer.waitForFrame();
            maxDrawCalls = Math.max(maxDrawCalls, g.renderer.gpu.info.render.drawCalls);
          }
          await g.renderer.waitForFrame(); intervals.sort((a, b) => a - b);
          return { fps: 1000 / (intervals.reduce((a, b) => a + b) / intervals.length),
            p50Ms: intervals[Math.floor(intervals.length * .5)], p95Ms: intervals[Math.floor(intervals.length * .95)],
            maxMs: intervals.at(-1), over50Ms: intervals.filter(ms => ms > 50).length,
            graphics: g.renderer.lifecycleTelemetry, drawCalls: maxDrawCalls || null,
            renderCalls: g.renderer.gpu.info.calls - beforeCalls, gpuAllocatedBytes: g.renderer.gpu.info.memory.total,
            meshes: g.renderer.webgl.info.memory.geometries, textureCount: g.renderer.webgl.info.memory.textures };
        });
        if (held) await page.mouse.up(); return result;
      };
      report.performance = { idle: await performanceCase(false), spraying: await performanceCase(true) };
      const batches = (await snapshot()).marks.filter(m => m.wall === rightAim.mansion);
      if (!expectBug) assert.equal(batches.length, 1, 'Spray allocated a new draw-call batch on every dab');
      assert.equal(report.performance.spraying.graphics.graphicsFault, false);
      assert.equal(report.performance.spraying.graphics.deviceLost, false);
      assert(report.performance.spraying.renderCalls >= 180, 'Benchmark did not submit rendered frames');
      if (!expectBug) {
        await page.mouse.down(); await step(24);
        const saturated = (await snapshot()).marks.find(m => m.wall === rightAim.mansion);
        await step(600);
        const heldStill = (await snapshot()).marks.find(m => m.wall === rightAim.mansion);
        await page.mouse.up(); await step(1);
        assert.equal(heldStill.vertices, saturated.vertices, 'Holding still kept allocating overlapping paint triangles');
        assert.equal(heldStill.capacity, saturated.capacity, 'Holding still grew the paint buffer');
        report.stationary = { simulatedHeldSeconds: 10, vertices: heldStill.vertices, capacity: heldStill.capacity };
        await page.evaluate(async fps => { const g = window.__wireTheHouse; g.hud.updateFps(fps);
          await g.renderer.waitForFrame(); g.renderer.render(); await g.renderer.waitForFrame(); }, report.performance.spraying.fps);
        await page.screenshot({ path: path.join(out, 'desktop-final-right-wall.png') });
      }
    }
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} finally {
  let processes = census();
  for (let i = 0; i < 8; i++) for (const process of processes)
    if (owned.includes(process.ParentProcessId) && !owned.includes(process.ProcessId)) owned.push(process.ProcessId);
  const root = processes.find(process => process.ProcessId === rootPid);
  report.browser = { rootPid, profile: root?.CommandLine.match(/--user-data-dir=([^ ]+)/)?.[1], owned };
  await browser.close(); await server.close();
  report.browser.remaining = census().filter(process => owned.includes(process.ProcessId)).map(process => process.ProcessId);
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  assert.deepEqual(report.browser.remaining, [], 'QA Chrome processes leaked');
}
console.log(JSON.stringify({ passed: report.passed, label, cases: report.cases.length, gpu: report.gpu, aimMs: report.aimMs, performance: report.performance, report: path.join(out, 'report.json') }));
