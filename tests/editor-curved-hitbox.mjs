import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await blockPointerLock(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&template=blank&editor=1&renderer=webgl');
  await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 120000 });
  const report = await page.evaluate(() => {
    const game = window.__wireTheHouse;
    const wing = game.room.mansionWing;
    const wall = wing.addEditorWall('curve-hitbox-test', 'concrete-wall', 3);
    wall.position.set(15, 0, 10);
    const shape = { center: [-1.5, 4], radius: 4, startAngle: -Math.PI / 2,
      sweep: Math.PI / 3, uvStart: 0, capStart: true, capEnd: true };
    wing.applyEditorConcreteCurve(wall, shape);
    const point = fraction => {
      const angle = shape.startAngle + shape.sweep * fraction;
      return wall.localToWorld(new wall.position.constructor(
        shape.center[0] + Math.cos(angle) * shape.radius, 0,
        shape.center[1] + Math.sin(angle) * shape.radius));
    };
    const arcPoint = point(.75), start = point(0), end = point(1);
    const emptyChord = start.clone().add(end).multiplyScalar(.5);
    const obstacle = wing.obstaclesAt(0).find(item => item.id === wall.name);
    const covered = arcPoint.x >= obstacle.minX && arcPoint.x <= obstacle.maxX &&
      arcPoint.z >= obstacle.minZ && arcPoint.z <= obstacle.maxZ;
    const player = game.player;
    player.camera.position.set(emptyChord.x, player.eyeHeight, emptyChord.z);
    player.update(1 / 60);
    const empty = { contacts: [...player.collisionContacts], moved: Math.hypot(
      player.camera.position.x - emptyChord.x, player.camera.position.z - emptyChord.z) };
    player.camera.position.set(arcPoint.x, player.eyeHeight, arcPoint.z);
    player.update(1 / 60);
    const wallContact = { contacts: [...player.collisionContacts], moved: Math.hypot(
      player.camera.position.x - arcPoint.x, player.camera.position.z - arcPoint.z) };
    wall.position.x += 1;
    wall.rotation.y = .35;
    wall.scale.set(1.25, 1, .8);
    wall.updateMatrixWorld(true);
    const movedArc = point(.75);
    const movedObstacle = wing.obstaclesAt(0).find(item => item.id === wall.name);
    player.camera.position.set(movedArc.x, player.eyeHeight, movedArc.z);
    player.update(1 / 60);
    const transformed = { covered: movedArc.x >= movedObstacle.minX && movedArc.x <= movedObstacle.maxX &&
      movedArc.z >= movedObstacle.minZ && movedArc.z <= movedObstacle.maxZ,
    contacts: [...player.collisionContacts], moved: Math.hypot(
      player.camera.position.x - movedArc.x, player.camera.position.z - movedArc.z) };
    return { wall: wall.name, obstacle, arcPoint: arcPoint.toArray(), emptyChord: emptyChord.toArray(),
      covered, empty, wallContact, transformed, renderError: game.renderer.renderError };
  });
  assert(report.covered, `Curved wall visual leaves its hitbox: ${JSON.stringify(report)}`);
  assert(!report.empty.contacts.includes(report.wall) && report.empty.moved < .02,
    `Empty space inside the bend must remain walkable: ${JSON.stringify(report)}`);
  assert(report.wallContact.contacts.includes(report.wall) && report.wallContact.moved > .2,
    `The actual curved concrete must stop the player: ${JSON.stringify(report)}`);
  assert(report.transformed.covered && report.transformed.contacts.includes(report.wall) && report.transformed.moved > .2,
    `Move, rotate and scale must update the curved wall hitbox: ${JSON.stringify(report)}`);
  assert.equal(report.renderError, '');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, wall: report.wall, segments: report.obstacle.segments.length,
    emptyMoved: report.empty.moved, wallMoved: report.wallContact.moved, transformedMoved: report.transformed.moved }));
} finally {
  await browser.close();
}
