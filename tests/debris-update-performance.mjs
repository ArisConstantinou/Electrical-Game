import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import * as THREE from 'three';
import { createServer } from 'vite';

// A fixed pre-fix implementation is an independent trajectory oracle. This
// checks physical states and mass, not merely the presence of cache fields.
const baselineRef = '216a3e3';
const output = 'output/debris-update-performance';
await mkdir(output, { recursive: true });
const baseline = execFileSync('git', ['show', `${baselineRef}:src/systems/ChasingSystem.ts`], { encoding: 'utf8' })
  .replaceAll("'../data/gameConfig'", "'/src/data/gameConfig'")
  .replaceAll("'./splitDebrisGeometry'", "'/src/systems/splitDebrisGeometry'");
await writeFile(`${output}/ChasingSystem.baseline.ts`, baseline);
const server = await createServer({ server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom', logLevel: 'error' });
const report = { baselineRef, cases: [] };
const state = system => ({ emitted: system.totalEmittedVolume, retired: system.totalRetiredVolume, particles: system.particles.map(p => ({ position: p.mesh.position.toArray(), rotation: p.mesh.quaternion.toArray(), velocity: p.velocity.toArray(), angularVelocity: p.angularVelocity.toArray(), settled: p.settled, wallSupported: p.wallSupported, support: system.particles.indexOf(p.support), life: p.life, volume: p.mesh.userData.volume })) });
const summary = times => { const s = [...times].sort((a, b) => a - b); return { totalMs: times.reduce((a, b) => a + b, 0), medianMs: s[Math.floor(s.length / 2)], p95Ms: s[Math.floor(s.length * .95)], maxMs: s.at(-1) }; };
try {
  const { ChasingSystem: Before } = await server.ssrLoadModule(`/${output}/ChasingSystem.baseline.ts`);
  const { ChasingSystem: After } = await server.ssrLoadModule('/src/systems/ChasingSystem.ts');
  const { MasonryVolume } = await server.ssrLoadModule('/src/world/MasonryVolume.ts');
  const volume = new MasonryVolume({ seed: 1234 });
  const impacts = [];
  for (let i = 0; i < 36; i++) {
    const hit = volume.raycast({ x: .72 + i * .003, y: 1.55 + Math.sin(i * .6) * .008, z: -2 }, { x: 0, y: 0, z: -1 }, .8);
    if (hit) impacts.push(volume.impact({ point: hit.point, direction: { x: 0, y: 0, z: -1 }, edge: { x: 1, y: 0, z: 0 }, chisel: 'flat', widthM: .05, energyJ: 4 }));
  }
  // Actual canonical fragments, dropped just outside the opened wall. Each
  // physics frame, stack contact, retirement and conserved volume must match.
  const wall = { volume: { surfaceRevision: 0 }, isSolidAt: () => false, processPendingSupport: () => null };
  const pair = [new Before(new THREE.Scene(), wall), new After(new THREE.Scene(), wall)];
  const times = [[], []], spawnTimes = [[], []];
  for (let frame = 0; frame < 600; frame++) {
    if (frame % 6 === 0 && frame / 6 < impacts.length) {
      for (const index of frame % 12 ? [1, 0] : [0, 1]) { const start = performance.now(); pair[index].spawnDebris(impacts[frame / 6]); spawnTimes[index].push(performance.now() - start); }
      for (let i = 0; i < pair[0].particles.length; i++) {
        const a = pair[0].particles[i], b = pair[1].particles[i];
        assert.deepStrictEqual(b.mesh.geometry.getAttribute('position').array, a.mesh.geometry.getAttribute('position').array, 'Spawned Float32 fracture vertices must remain exact');
        assert.deepStrictEqual(b.mesh.geometry.getAttribute('normal').array, a.mesh.geometry.getAttribute('normal').array, 'Spawned face normals must remain exact');
        assert.deepStrictEqual(b.mesh.geometry.boundingBox, a.mesh.geometry.boundingBox, 'Physical bounds must remain exact');
        assert.deepStrictEqual(b.mesh.geometry.boundingSphere, a.mesh.geometry.boundingSphere, 'Culling bounds must remain exact');
        assert.deepStrictEqual(b.collisionProbes, a.collisionProbes, 'Triangle collision probes must remain exact');
      }
    }
    for (const index of frame % 2 ? [1, 0] : [0, 1]) { const start = performance.now(); pair[index].update(1 / 60); times[index].push(performance.now() - start); }
    // Rendering work is budgeted once per presentation and must not change
    // trajectories while indices arrive on still-moving or settled bodies.
    pair[1].flushFragmentRendering(2048, .5);
    assert.deepStrictEqual(state(pair[1]), state(pair[0]), `Actual fragment trajectories changed at frame ${frame}`);
  }
  report.cases.push({ name: 'actual-fragment-fall-and-floor-stacking', frames: 600, emittedFragments: impacts.reduce((n, i) => n + i.fragments.length, 0), activeFragments: pair[1].activeFragmentCount, baseline: summary(times[0]), current: summary(times[1]) });
  report.cases.push({ name: 'actual-fragment-mesh-preparation', impacts: impacts.length, baseline: summary(spawnTimes[0]), current: summary(spawnTimes[1]) });

  // Real masonry occupancy queries beneath 96 shell chips, all settled on an
  // unchanged surviving horizontal web. This isolates accumulated rubble cost
  // from impact and meshing, then explicitly removes their support in one frame.
  const geometry = new THREE.BoxGeometry(.008, .008, .008).toNonIndexed();
  let supportY;
  for (let y = 1.2; y < 1.7; y += .002) {
    if (volume.isOccupied(.74, y, volume.frontZ - .07) && !volume.isOccupied(.74, y + .01, volume.frontZ - .07)) { supportY = y; break; }
  }
  assert(supportY, 'A real surviving horizontal web is required');
  const fragment = { position: { x: .74, y: supportY + .0079, z: volume.frontZ - .07 }, size: { x: .008, y: .008, z: .008 }, material: 1, volume: .008 ** 3, detached: true, positions: geometry.getAttribute('position').array };
  let removed = false, revision = 0;
  const queries = [0, 0];
  const settled = [Before, After].map((Type, index) => {
    const fixtureWall = { volume: { get surfaceRevision() { return revision; } }, processPendingSupport: () => null, isSolidAt: (x, y, z) => { queries[index]++; return !removed && volume.isOccupied(x, y, z); } };
    const system = new Type(new THREE.Scene(), fixtureWall);
    system.spawnDebris({ seed: 12, fragments: Array.from({ length: 96 }, () => fragment) });
    for (const p of system.particles) { p.settled = true; p.wallSupported = true; p.velocity.set(0, 0, 0); p.angularVelocity.set(0, 0, 0); }
    assert(system.hasWallSupport(system.particles[0]), 'Fixture shell must really rest on masonry');
    return system;
  });
  const settledTimes = [[], []];
  for (let frame = 0; frame < 360; frame++) {
    for (const index of frame % 2 ? [1, 0] : [0, 1]) { const start = performance.now(); settled[index].update(1 / 60); settledTimes[index].push(performance.now() - start); }
    assert.deepStrictEqual(state(settled[1]), state(settled[0]));
  }
  assert(queries[1] < queries[0] / 100, 'Stationary fragments must not repeatedly sample an unchanged supporting web');
  report.cases.push({ name: 'unchanged-wall-settled-chips', frames: 360, fragments: 96, queries: queries.slice(), baseline: summary(settledTimes[0]), current: summary(settledTimes[1]) });
  removed = true; revision++;
  for (const system of settled) system.update(1 / 60);
  assert.deepStrictEqual(state(settled[1]), state(settled[0]), 'All fragments must wake in the same frame after their wall support changes');
  assert(settled[1].particles.every(p => !p.settled));
  const moved = settled[1].particles[0]; moved.settled = true;
  assert.equal(settled[1].hasWallSupport(moved), false);
  removed = false; revision++; moved.mesh.position.y = supportY + .0079;
  assert.equal(settled[1].hasWallSupport(moved), true);
  moved.mesh.position.y += .03;
  assert.equal(settled[1].hasWallSupport(moved), false, 'Pose edits must invalidate cached support without any masonry edit');
  const collisionQueries = [0, 0], collisionTimes = [[], []];
  const collisionSystems = [Before, After].map((Type, index) => {
    const system = new Type(new THREE.Scene(), { volume: { get surfaceRevision() { return revision; } }, processPendingSupport: () => null, isSolidAt: (x, y, z) => { collisionQueries[index]++; return !removed && volume.isOccupied(x, y, z); } });
    system.spawnDebris({ seed: 19, fragments: [fragment] }); return system;
  });
  for (let sample = 0; sample < 250; sample++) {
    const results = [];
    for (const index of sample % 2 ? [1, 0] : [0, 1]) {
      const system = collisionSystems[index], p = system.particles[0];
      p.mesh.position.set(.72 + sample * .0001, supportY + Math.sin(sample * .3) * .015, volume.frontZ - .07);
      p.mesh.rotation.set(sample * .001, sample * .004, 0);
      const start = performance.now();
      for (let repeat = 0; repeat < 8; repeat++) results[index] = system.overlapsWall(p);
      collisionTimes[index].push(performance.now() - start);
    }
    assert.equal(results[1], results[0], 'Cached collision must match actual triangle occupancy at every pose');
  }
  assert(collisionQueries[1] <= collisionQueries[0] / 7.9, 'Identical successive-axis poses must share a query result');
  report.cases.push({ name: 'repeated-pose-real-wall-collision', queries: collisionQueries.slice(), baseline: summary(collisionTimes[0]), current: summary(collisionTimes[1]) });
  removed = true; revision++;
  for (const system of collisionSystems) assert.equal(system.overlapsWall(system.particles[0]), false, 'Wall edits must invalidate overlap cache immediately');
  geometry.dispose();
  report.passed = true;
  console.log(JSON.stringify(report, null, 2));
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await server.close();
}
