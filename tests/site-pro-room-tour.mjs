import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5365/Electrical-Game/?mansion=basic';
const output = process.argv[3] ?? 'output/site-pro-room-tour';
const only = process.argv.find(value => value.startsWith('--only='))?.slice('--only='.length);
const isolatedRoot = process.env.QA_DIST_ROOT ? path.resolve(process.env.QA_DIST_ROOT) : null;
const devices = [
  { name: 'mobile-portrait', width: 390, height: 844, touch: true },
  { name: 'desktop', width: 1366, height: 768, touch: false },
].filter(device => !only || device.name === only);
const views = [
  { name: 'front-brick-wall', x: 0, z: 0, yaw: 0, pitch: -.05 },
  { name: 'right-brick-wall', x: 0, z: 0, yaw: -Math.PI / 2, pitch: -.05 },
  { name: 'rear-room', x: 0, z: -.25, yaw: Math.PI, pitch: -.06 },
  { name: 'rear-brick-close', x: 0, z: 2.85, yaw: Math.PI, pitch: 0 },
  { name: 'front-brick-close', x: 0, z: -1.85, yaw: 0, pitch: 0 },
  { name: 'front-ceiling-contact', x: 0, z: -1.15, yaw: 0, pitch: .34 },
  { name: 'right-ceiling-contact', x: 1.35, z: -.25, yaw: -Math.PI / 2, pitch: .34 },
  { name: 'rear-ceiling-contact', x: 0, z: 1.25, yaw: Math.PI, pitch: .34 },
  { name: 'left-ceiling-contact', x: -1.35, z: -.25, yaw: Math.PI / 2, pitch: .34 },
  { name: 'floor-detail', x: 0, z: -.25, yaw: Math.PI, pitch: -.83 },
  { name: 'supplies', x: 0, z: -.35, yaw: -2.28, pitch: -.39 },
  { name: 'left-room', x: 0, z: -.35, yaw: 2.28, pitch: -.16 },
  { name: 'open-left-window', x: -1.45, z: 2.0, yaw: Math.PI / 2, pitch: -.04 },
  { name: 'near-open-window', x: -2.90, z: 2.0, yaw: Math.PI / 2, pitch: -.04 },
  { name: 'neighbour-through-opening', x: -2.90, z: 2.0, yaw: 1.1, pitch: -.04 },
  { name: 'far-house-through-opening', x: -2.90, z: 1.2, yaw: 1.68, pitch: -.04 },
];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { url, cases: [], errors: [] };
try {
  for (const device of devices) {
    const context = await browser.newContext({ viewport: { width: device.width, height: device.height }, deviceScaleFactor: 1, isMobile: device.touch, hasTouch: device.touch });
    await blockPointerLock(context);
    const page = await context.newPage();
    if (isolatedRoot) await page.route('http://127.0.0.1:5365/Electrical-Game/**', async route => {
      const relative = decodeURIComponent(new URL(route.request().url()).pathname).slice('/Electrical-Game/'.length) || 'index.html';
      const file = path.resolve(isolatedRoot, relative);
      if (!file.startsWith(isolatedRoot + path.sep)) return route.abort();
      try {
        const extension = path.extname(file).toLowerCase();
        await route.fulfill({ status: 200, body: await readFile(file), contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.svg': 'image/svg+xml' })[extension] || 'application/octet-stream' });
      } catch { await route.fulfill({ status: 404, body: `Missing isolated asset: ${relative}` }); }
    });
    page.on('pageerror', error => report.errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => window.__wireTheHouse?.renderer.renderCamera, null, { timeout: 120000 });
    await page.locator('#apprentice-count').selectOption('0');
    if (device.touch) await page.locator('#start-button').tap();
    else await page.locator('#start-button').click();
    await page.waitForFunction(() => window.__wireTheHouse.started && document.querySelector('#start-screen')?.classList.contains('hidden'));
    await page.waitForTimeout(800);
    for (const view of views) {
      const state = await page.evaluate(async pose => {
        const game = window.__wireTheHouse;
        game.player.camera.position.set(pose.x, game.player.eyeHeight, pose.z);
        game.player.velocity.set(0, 0, 0);
        game.player.yaw = pose.yaw;
        game.player.pitch = pose.pitch;
        game.player.camera.rotation.set(pose.pitch, pose.yaw, 0, 'YXZ');
        await game.renderer.waitForFrame();
        return {
          position: game.renderer.camera.position.toArray(),
          yaw: game.player.yaw,
          pitch: game.player.pitch,
          error: game.renderer.renderError,
        };
      }, view);
      await page.waitForTimeout(250);
      assert.equal(state.error, '', `${device.name}/${view.name}: render error`);
      await page.screenshot({ path: `${output}/${device.name}-${view.name}.png` });
      report.cases.push({ device: device.name, view: view.name, state });
    }
    const rearContact = await page.evaluate(() => {
      const game = window.__wireTheHouse;
      const camera = game.renderer.camera;
      const rear = game.room.referenceWalls.find(wall => wall.userData.studioEntityId === 'world:rear-wall');
      if (!rear) return { registered: false };
      camera.position.set(0, 1.35, 3.0);
      camera.rotation.set(0, Math.PI, 0, 'YXZ');
      camera.updateMatrixWorld(true);
      const walls = game.room.referenceWalls;
      const index = walls.indexOf(rear);
      walls.splice(index, 1);
      game.heightMeasure.update(camera, true, () => true);
      const withoutRear = game.heightMeasure.telemetry.mode;
      walls.splice(index, 0, rear);
      game.heightMeasure.update(camera, true, () => true);
      const withRear = game.heightMeasure.telemetry;
      game.heightMeasure.update(camera, false, () => true);
      return { registered: true, withoutRear, withRear };
    });
    assert.equal(rearContact.registered, true, `${device.name}: rear work surface is registered`);
    assert.equal(rearContact.withoutRear, 'no-wall', `${device.name}: rear surface is required for the hit`);
    assert.equal(rearContact.withRear.mode, 'ready', `${device.name}: rear surface can be measured`);
    assert.equal(rearContact.withRear.targetStable, true, `${device.name}: rear wall has stable backing`);
    assert(Math.abs(rearContact.withRear.target[2] - 3.576) < .005, `${device.name}: tape must contact the visible rear brick face, not the backing`);
    report.cases.push({ device: device.name, view: 'rear-work-contact', state: rearContact });
    const faceContacts = await page.evaluate(() => {
      const game = window.__wireTheHouse, camera = game.renderer.camera;
      const course = 3 / 23;
      const hit = (x, y, z, yaw) => {
        camera.position.set(x, y, z); camera.rotation.set(0, yaw, 0, 'YXZ'); camera.updateMatrixWorld(true);
        game.heightMeasure.update(camera, true, () => true);
        return game.heightMeasure.telemetry;
      };
      return {
        rearBrick: hit(0, 1.35, 3, Math.PI),
        rearJoint: hit(0, course * 10, 3, Math.PI),
        leftBrick: hit(-2.35, 1.35, .18, Math.PI / 2),
        leftJoint: hit(-2.35, course * 10, .18, Math.PI / 2),
        leftOpening: hit(-2.35, 1.65, 2, Math.PI / 2),
        rightBrick: hit(2.35, 1.35, .18, -Math.PI / 2),
      };
    });
    assert(Math.abs(faceContacts.rearBrick.target?.[2] - 3.576) < .005 && Math.abs(faceContacts.rearJoint.target?.[2] - 3.596) < .005,
      `${device.name}: rear clay face and recessed joint do not match the visible geometry: ${JSON.stringify(faceContacts)}`);
    assert(Math.abs(faceContacts.leftBrick.target?.[0] + 3.776) < .005 && Math.abs(faceContacts.leftJoint.target?.[0] + 3.796) < .005,
      `${device.name}: left clay face and recessed joint do not match the visible geometry: ${JSON.stringify(faceContacts)}`);
    assert.equal(faceContacts.leftOpening.mode, 'no-wall', `${device.name}: window opening has an invisible hitbox`);
    assert(Math.abs(faceContacts.rightBrick.target?.[0] - 3.776) < .005,
      `${device.name}: right brick contact misses its visible face: ${JSON.stringify(faceContacts.rightBrick)}`);
    report.cases.push({ device: device.name, view: 'face-joint-and-opening-contact', state: faceContacts });
    const slabBearing = await page.evaluate(() => {
      const room = window.__wireTheHouse.room;
      const ceiling = room.getObjectByName('Concrete slab ceiling');
      if (!ceiling) return null;
      ceiling.geometry.computeBoundingBox();
      const world = ceiling.geometry.boundingBox.clone().applyMatrix4(ceiling.matrixWorld);
      return { min: world.min.toArray(), max: world.max.toArray(), relief: Boolean(ceiling.material.normalMap?.image?.width),
        clayInfill: Boolean(room.getObjectByName('Clay and concrete ribbed soffit preview')) };
    });
    assert(slabBearing && slabBearing.min[0] < -4.03 && slabBearing.max[0] > 4.03 && slabBearing.max[2] > 3.77,
      `${device.name}: concrete slab must bear across both side walls and the rear wall: ${JSON.stringify(slabBearing)}`);
    assert(Math.abs(slabBearing.min[1] - 3) < .015 && slabBearing.relief && !slabBearing.clayInfill,
      `${device.name}: structural slab position or relief is wrong: ${JSON.stringify(slabBearing)}`);
    report.cases.push({ device: device.name, view: 'structural-slab-bearing', state: slabBearing });
    const masonry = await page.evaluate(() => {
      const room = window.__wireTheHouse.room;
      const left = room.referenceWalls.find(wall => wall.name === 'Left concrete wall');
      const right = room.referenceWalls.find(wall => wall.name === 'Right concrete wall');
      const rear = room.getObjectByName('Full staggered rear clay courses');
      const front = room.brickWall.getObjectByName('Batched untouched masonry');
      const practice = room.intactPracticeWall.getObjectByName('Batched untouched masonry');
      const leftBricks = left?.getObjectByName('Left fired-clay courses cut around unglazed opening');
      const rightBricks = right?.getObjectByName('Right fired-clay courses');
      const patchAttribute = rear?.geometry?.getAttribute('brickPatch');
      const patchRectangles = patchAttribute ? Array.from({ length: rear.count }, (_, index) =>
        Array.from({ length: 4 }, (_, component) => patchAttribute.getComponent(index, component))) : [];
      const leftWindowBlocked = (() => {
        if (!leftBricks?.isInstancedMesh) return true;
        const matrix = new leftBricks.matrixWorld.constructor();
        leftBricks.updateMatrixWorld(true);
        for (let i = 0; i < leftBricks.count; i++) {
          leftBricks.getMatrixAt(i, matrix);
          const z = matrix.elements[14], y = matrix.elements[13];
          const halfZ = Math.abs(matrix.elements[10]) / 2, halfY = Math.abs(matrix.elements[5]) / 2;
          if (z + halfZ > 1.0501 && z - halfZ < 2.9499 && y + halfY > 1.0501 && y - halfY < 2.3499) return true;
        }
        return false;
      })();
      return {
        front: Boolean(front), rightPractice: Boolean(practice), rear: rear?.count ?? 0,
        left: leftBricks?.count ?? 0, right: rightBricks?.count ?? 0,
        source: rear?.userData.textureSource ?? '',
        uniqueClayFaces: new Set(patchRectangles.map(rect => `${rect[0].toFixed(4)},${rect[1].toFixed(4)}`)).size,
        validClayCrops: patchRectangles.length > 0 && patchRectangles.every(([u, v, width, height]) =>
          u >= 0 && v >= 0 && width >= 0 && height > 0 && u + width <= 1 && v + height <= 1),
        rearPlaster: Boolean(room.getObjectByName('Trowelled plaster lift with unfinished masonry edge')),
        leftWindowBlocked,
      };
    });
    assert(masonry.front && masonry.rightPractice && masonry.left > 300 && masonry.right > 400 && masonry.rear >= 480, `${device.name}: missing fired-clay wall: ${JSON.stringify(masonry)}`);
    assert(masonry.source.includes('human-laid-brick-face-atlas.png') && !masonry.rearPlaster && !masonry.leftWindowBlocked, `${device.name}: wrong material or window obstruction: ${JSON.stringify(masonry)}`);
    assert(masonry.uniqueClayFaces >= 60 && masonry.validClayCrops, `${device.name}: clay faces repeat or sample outside the source: ${JSON.stringify(masonry)}`);
    report.cases.push({ device: device.name, view: 'four-masonry-walls', state: masonry });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
