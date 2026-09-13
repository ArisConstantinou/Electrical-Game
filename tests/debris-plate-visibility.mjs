import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { ChasingSystem } = await server.ssrLoadModule('/src/systems/ChasingSystem.ts');
  const frontZ = -2.41;
  const openWall = { isSolidAt: () => false, processPendingSupport: () => null };
  const box = (width, height, depth, x = 0, y = 0) => {
    const indexed = new THREE.BoxGeometry(width, height, depth), geometry = indexed.toNonIndexed();
    indexed.dispose(); geometry.translate(x, y, 0);
    const positions = geometry.getAttribute('position').array.slice(); geometry.dispose();
    return positions;
  };
  const fragment = (positions, volume, detached = true) => ({ position: { x: 0, y: 1.2, z: frontZ }, size: { x: .07, y: .06, z: .003 }, material: 1, volume, detached, positions });
  const spawn = (system, fragments, seed = 1234) => system.spawnDebris({ fragments, seed });
  // This thin L-shaped shell has a genuinely empty upper-right area. Its
  // bounding-box centre lies there, so the old box-probe collision pins it to
  // a neighbouring web even though every triangle is already detached.
  const left = box(.02, .06, .003, -.025, 0), bottom = box(.05, .018, .003, .01, -.021);
  const positions = new Float32Array([...left, ...bottom]);
  const plateVolume = (.02 * .06 + .05 * .018) * .003;
  const wall = { ...openWall, isSolidAt: (x, y, z) => x > -.013 && y > 1.19 && Math.abs(z - frontZ) < .05 };
  const system = new ChasingSystem(new THREE.Scene(), wall);
  spawn(system, [fragment(positions, plateVolume)]);
  const plate = system.particles[0];
  assert(wall.isSolidAt(plate.mesh.position.x, plate.mesh.position.y, plate.mesh.position.z), 'Fixture must exercise an empty box-centre occupied by a neighbouring web');
  assert.equal(system.overlapsWall(plate), false, 'Empty parts of an irregular plate must not collide with the wall');
  const birth = plate.mesh.position.clone();
  system.update(1 / 60);
  assert(plate.mesh.position.z > birth.z, 'A detached outward plate must leave its exact birth position');
  assert.equal(plate.settled, false, 'False bounding-box support must not leave the plate hanging');
  plate.mesh.position.set(.02, 1.2, frontZ);
  assert.equal(system.overlapsWall(plate), true, 'Real plate triangles must still collide with a surviving web');
  assert.deepEqual(plate.mesh.scale.toArray(), [1, 1, 1], 'Large fragments must not be enlarged visually');
  assert.equal(plate.mesh.geometry.getAttribute('position').count, positions.length / 3);
  assert.equal(plate.mesh.userData.volume, plateVolume);
  assert(plate.collisionProbes.length <= 54, 'Collision queries must remain bounded');

  let inwardPlates = 0, inwardFines = 0;
  const largeShape = box(.07, .04, .003), smallShape = box(.008, .008, .008);
  for (let seed = 1; seed <= 100; seed++) {
    const release = new ChasingSystem(new THREE.Scene(), openWall);
    const impactSeed = Math.imul(seed, 2654435761) >>> 0;
    spawn(release, [fragment(largeShape, .07 * .04 * .003)], impactSeed);
    spawn(release, [fragment(smallShape, .008 ** 3, false)], impactSeed);
    inwardPlates += Number(release.particles[0].mesh.userData.inward);
    inwardFines += Number(release.particles[1].mesh.userData.inward);
  }
  assert(inwardPlates < 20 && inwardFines > 25, 'Most shell plates should fall outside while fines can still enter chambers');

  // A broad, very thin shell contains less volume than the old 8 cm3 fines
  // threshold, but must survive long enough to fall and remain visible.
  const thin = new ChasingSystem(new THREE.Scene(), openWall);
  spawn(thin, [fragment(box(.07, .04, .001), .07 * .04 * .001, false)]);
  assert.equal(thin.particles[0].transient, false);
  for (let frame = 0; frame < 360; frame++) thin.update(1 / 60);
  assert.equal(thin.activeFragmentCount, 1, 'Broad thin plates must survive the short fines lifetime');
  assert.equal(thin.settledFragmentCount, 1);
  assert.equal(thin.unsupportedSettledFragmentCount, 0);
  assert(Math.abs(thin.particles[0].halfHeight * 2 - .001) < 1e-7, 'Thin wall plates must rest on their broad face rather than stand vertically');
  const restingSize = new THREE.Box3().setFromObject(thin.particles[0].mesh).getSize(new THREE.Vector3());
  assert(Math.abs(restingSize.y - .001) < 1e-7, 'Rendered resting height must match the physical broad-face support height at any floor yaw');

  const impulse = new ChasingSystem(new THREE.Scene(), openWall);
  impulse.spawnDebris({ fragments: Array.from({ length: 8 }, () => fragment(largeShape, .0005)), seed: 912324, releaseDirection: { x: 0, y: .6, z: .8 }, releaseEnergyJ: 4 });
  const kineticEnergy = impulse.particles.reduce((sum, p) => {
    const mass = p.mesh.userData.massKg, w = p.angularVelocity;
    return sum + mass * p.velocity.lengthSq() / 2 + mass / 6 * ((p.halfHeight ** 2 + p.halfDepth ** 2) * w.x ** 2 + (p.halfWidth ** 2 + p.halfDepth ** 2) * w.y ** 2 + (p.halfWidth ** 2 + p.halfHeight ** 2) * w.z ** 2);
  }, 0);
  assert(kineticEnergy <= .4800001, 'The combined debris release must not multiply the available blow energy by piece count');
  assert(impulse.particles.filter(p => p.velocity.y > 0 && p.velocity.z > 0).length >= 6, 'Angled outward release must lift most plates toward the same opening they were struck through');

  // Under sustained work the hard budget keeps the large existing shell while
  // retiring smaller settled pieces; retirement still accounts for all volume.
  const budget = new ChasingSystem(new THREE.Scene(), openWall);
  spawn(budget, [fragment(box(.09, .05, .012), .09 * .05 * .012)]);
  const retained = budget.particles[0]; retained.settled = true;
  for (let i = 0; i < 170; i++) {
    spawn(budget, [fragment(box(.01, .01, .01), .000001)], i + 1);
    budget.particles.at(-1).settled = true;
  }
  assert(budget.particles.includes(retained), 'Budget pressure must not remove the largest plate before settled little chips');
  assert(budget.activeFragmentCount <= budget.fragmentBudget);
  assert(Math.abs(budget.totalEmittedVolume - budget.activeFragmentVolume - budget.totalRetiredVolume) < 1e-12);
  console.log(JSON.stringify({ passed: true, inwardPlates, inwardFines, thinPlateSurvivesSeconds: 6, retainedLargePlate: true, checks: ['actual concave mesh collision', 'real obstacle collision', 'outward plate release', 'thin plate lifetime', 'volume-conserving size-aware budget'] }, null, 2));
} finally {
  await server.close();
}
