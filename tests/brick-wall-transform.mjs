import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await blockPointerLock(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&renderer=webgl');
  await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 120_000 });
  const result = await page.evaluate(() => {
    const game = window.__wireTheHouse;
    const wall = game.room.brickWall;
    const camera = game.renderer.camera;
    const point = game.mission.points[0];
    const initialFit = { boxes: wall.canFitBoxes(point), conduit: wall.canFitConduit(point) };
    const columnFace = wall.localToWorld(wall.position.clone().set(2.72, 1.4, wall.volume.frontZ));
    camera.position.copy(columnFace).add(wall.position.clone().set(0, 0, 1));
    camera.lookAt(columnFace);
    const originalColumnBlocked = !wall.aim(camera, 1.5);
    const pivot = wall.parent;
    pivot.position.x += 1.25;
    pivot.position.z += 0.4;
    pivot.rotation.y = Math.PI / 5;
    pivot.scale.set(1.2, 1, 0.85);
    wall.updateWorldMatrix(true, true);
    game.mission.root.matrix.copy(wall.matrixWorld);
    game.mission.root.matrixAutoUpdate = false;
    game.mission.root.updateMatrixWorld(true);
    const movedFit = { boxes: wall.canFitBoxes(point), conduit: wall.canFitConduit(point) };
    const edgeFace = wall.localToWorld(wall.position.clone().set(2.72, 1.4, wall.volume.frontZ));
    const edgeOutward = wall.getWorldDirection(wall.position.clone()).normalize();
    camera.position.copy(edgeFace).addScaledVector(edgeOutward, 1.0);
    camera.lookAt(edgeFace);
    camera.updateWorldMatrix(true, false);
    const movedEdgeAim = wall.aim(camera, 1.5)?.point.toArray() ?? null;
    const localFace = wall.position.clone().set(1.8, 1.4, wall.volume.frontZ);
    const worldFace = wall.localToWorld(localFace.clone());
    const outward = wall.getWorldDirection(localFace.clone()).normalize();
    camera.position.copy(worldFace).addScaledVector(outward, 1.0);
    camera.lookAt(worldFace);
    camera.updateWorldMatrix(true, false);
    const aim = wall.aim(camera, 1.5);
    const localAim = aim ? wall.worldToLocal(aim.point.clone()) : null;
    let knownSolid = null;
    for (let x = -2.5; x <= -1.5 && !knownSolid; x += 0.1)
      for (let y = 1; y <= 2 && !knownSolid; y += 0.1)
        for (let depth = 0.005; depth < 0.12 && !knownSolid; depth += 0.01)
          if (wall.volume.isOccupied(x, y, wall.volume.frontZ - depth))
            knownSolid = wall.localToWorld(worldFace.clone().set(x, y, wall.volume.frontZ - depth));
    const solidAtWorldFace = knownSolid && wall.isSolidAt(knownSolid.x, knownSolid.y, knownSolid.z);
    const knownLocal = knownSolid && wall.worldToLocal(knownSolid.clone());
    const bench = query => {
      for (let i = 0; i < 500; i++) query();
      const start = performance.now();
      let occupied = 0;
      for (let i = 0; i < 5000; i++) occupied += Number(query());
      return { ms: performance.now() - start, occupied };
    };
    const occupancyBench = knownSolid && knownLocal ? {
      local: bench(() => wall.volume.isOccupied(knownLocal.x, knownLocal.y, knownLocal.z)),
      transformed: bench(() => wall.isSolidAt(knownSolid.x, knownSolid.y, knownSolid.z)),
    } : null;
    const before = wall.volume.removedNodeCount;
    const edge = camera.position.clone().set(1, 0, 0).transformDirection(wall.matrixWorld);
    const impact = aim && game.chasing.hitContact({ point: aim.point, direction: outward.clone().negate(),
      edge, energyJ: 8, chisel: 'flat', widthM: 0.05 });
    const debris = game.chasing.particles.map(particle => particle.mesh.position.toArray());
    const sprayPoint = wall.spray(camera, 'transform-check');
    const spraySample = wall.samples.get('transform-check')?.at(-1);
    return {
      worldFace: worldFace.toArray(), aim: aim?.point.toArray() ?? null,
      initialFit, movedFit, originalColumnBlocked, movedEdgeAim,
      localAim: localAim?.toArray() ?? null,
      changedNodes: wall.volume.removedNodeCount - before,
      impactPoint: impact?.points[0]?.toArray() ?? null,
      fragmentCount: impact?.fragments.length ?? 0,
      debrisCount: debris.length,
      debrisLocalPositions: debris.slice(0, 3).map(position =>
        wall.worldToLocal(camera.position.clone().fromArray(position)).toArray()),
      fragmentLocalPositions: impact?.fragments.slice(0, 3).map(fragment =>
        wall.worldToLocal(camera.position.clone().set(fragment.position.x, fragment.position.y, fragment.position.z)).toArray()) ?? [],
      sprayPoint: sprayPoint?.toArray() ?? null,
      spraySample: spraySample?.toArray() ?? null,
      solidAtWorldFace,
      occupancyBench,
    };
  });
  assert(result.aim, `Moved and rotated wall could not be aimed: ${JSON.stringify(result)}`);
  assert.deepEqual(result.movedFit, result.initialFit,
    `Installation cavity tests must remain aligned with moved wall and point: ${JSON.stringify(result)}`);
  assert(result.originalColumnBlocked && result.movedEdgeAim,
    `Concrete occlusion must follow actual columns, not wall-local x bands: ${JSON.stringify(result)}`);
  assert(Math.abs(result.localAim[0] - 1.8) < 0.04, JSON.stringify(result));
  assert(result.changedNodes > 0, `World-space hammer contact did not damage moved wall: ${JSON.stringify(result)}`);
  assert(result.fragmentCount > 0 && result.debrisCount > 0,
    `Moved wall damage did not produce real debris: ${JSON.stringify(result)}`);
  assert(result.impactPoint && Math.hypot(...result.impactPoint.map((n, i) => n - result.aim[i])) < 0.05,
    `Impact event did not return world coordinates: ${JSON.stringify(result)}`);
  assert(result.solidAtWorldFace, `World-space occupancy did not follow the wall: ${JSON.stringify(result)}`);
  assert(result.occupancyBench?.local.occupied === 5000 && result.occupancyBench.transformed.occupied === 5000,
    `Repeated moved-wall occupancy differs from masonry volume: ${JSON.stringify(result)}`);
  assert(result.sprayPoint && result.spraySample && Math.abs(result.spraySample[0] - 1.8) < 0.04,
    `Spray guide did not use masonry-local canvas coordinates: ${JSON.stringify(result)}`);
  assert(result.fragmentLocalPositions.every(position => Math.abs(position[0]) < 3.2 &&
    position[1] >= -.1 && position[1] <= 3.1 && position[2] > -2.8 && position[2] < -2.2),
    `Debris positions escaped the moved wall: ${JSON.stringify(result)}`);
  assert(result.debrisLocalPositions.every(position => Math.abs(position[0]) < 3.2 &&
    position[1] >= -.1 && position[1] <= 3.1 && position[2] > -2.8 && position[2] < -2.2),
    `Spawned debris did not follow the moved wall: ${JSON.stringify(result)}`);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result, errors }));
  await context.close();
} finally { await browser.close(); }
