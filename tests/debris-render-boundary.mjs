import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import * as THREE from 'three';
import { createServer } from 'vite';

const output = 'output/debris-render-boundary';
await mkdir(output, { recursive: true });
const baseline = execFileSync('git', ['show', '216a3e3:src/systems/ChasingSystem.ts'], { encoding: 'utf8' })
  .replaceAll("'../data/gameConfig'", "'/src/data/gameConfig'")
  .replaceAll("'./splitDebrisGeometry'", "'/src/systems/splitDebrisGeometry'");
await writeFile(`${output}/ChasingSystem.baseline.ts`, baseline);
const server = await createServer({ server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom', logLevel: 'error' });
const report = { passed: false };
// Independent, exact-coordinate oriented triangle multiset. Opposite duplicate
// faces sum to zero; every surviving surface and its multiplicity must match.
const surface = geometry => {
  const p = geometry.getAttribute('position').array, indices = geometry.index?.array;
  const faces = new Map();
  for (let i = 0; i < (indices?.length ?? p.length / 3); i += 3) {
    const keys = [0, 1, 2].map(n => { const j = (indices ? indices[i + n] : i + n) * 3; return `${p[j]},${p[j + 1]},${p[j + 2]}`; });
    const direction = ((keys[0] > keys[1]) + (keys[0] > keys[2]) + (keys[1] > keys[2])) % 2 ? -1 : 1;
    const key = keys.sort().join(';'); faces.set(key, (faces.get(key) ?? 0) + direction);
  }
  return [...faces].filter(([, balance]) => balance !== 0).sort(([a], [b]) => a.localeCompare(b));
};
const drain = system => {
  const times = []; let passes = 0;
  while (system.pendingFragmentRendering) {
    const start = performance.now(), processed = system.flushFragmentRendering(256, .5);
    assert(processed <= 256, 'All fragments must share a single hard triangle budget');
    times.push(performance.now() - start);
    assert(++passes < 10000, 'Rendering queue must finish');
  }
  return { passes, totalMs: times.reduce((a, b) => a + b, 0), maxSliceMs: Math.max(...times) };
};
try {
  const { ChasingSystem: Before } = await server.ssrLoadModule(`/${output}/ChasingSystem.baseline.ts`);
  const { ChasingSystem: After } = await server.ssrLoadModule('/src/systems/ChasingSystem.ts');
  const { MasonryVolume } = await server.ssrLoadModule('/src/world/MasonryVolume.ts');
  const volume = new MasonryVolume({ seed: 1234 });
  const system = new After(new THREE.Scene(), { isSolidAt: () => false, processPendingSupport: () => null });
  let emittedTriangles = 0;
  for (let blow = 0; blow < 36; blow++) {
    const hit = volume.raycast({ x: .72 + blow * .003, y: 1.55 + Math.sin(blow * .6) * .008, z: -2 }, { x: 0, y: 0, z: -1 }, .8);
    if (!hit) continue;
    const impact = volume.impact({ point: hit.point, direction: { x: 0, y: 0, z: -1 }, edge: { x: 1, y: 0, z: 0 }, chisel: 'flat', widthM: .05, energyJ: 4 });
    emittedTriangles += impact.fragments.reduce((sum, f) => sum + f.positions.length / 9, 0);
    system.spawnDebris(impact);
  }
  assert(system.pendingFragmentRendering > 0);
  assert(system.pendingFragmentRendering <= system.activeFragmentCount, 'Retired fragments must not remain in the queue');
  const ledger = [system.totalEmittedVolume, system.totalRetiredVolume, system.activeFragmentVolume];
  const before = system.particles.map(p => ({ geometry: p.mesh.geometry, positions: p.mesh.geometry.getAttribute('position').array.slice(), normals: p.mesh.geometry.getAttribute('normal').array.slice(), probes: p.collisionProbes?.map(v => v.toArray()), surface: surface(p.mesh.geometry) }));
  const canonicalTriangles = system.canonicalFragmentTriangles;
  assert.equal(system.flushFragmentRendering(256, 0), 32, 'Expired time budget must yield after the first small batch');
  const timing = drain(system);
  assert(system.renderedFragmentTriangles < canonicalTriangles * .7, 'Actual debris must lose a substantial amount of invisible internal triangles');
  for (let i = 0; i < system.particles.length; i++) {
    const p = system.particles[i], expected = before[i], canonical = p.canonicalGeometry ?? p.mesh.geometry;
    assert.equal(canonical.index, null, 'The physical solid must stay unindexed for cuts');
    assert.deepStrictEqual(canonical.getAttribute('position').array, expected.positions);
    assert.deepStrictEqual(canonical.getAttribute('normal').array, expected.normals);
    assert.deepStrictEqual(p.collisionProbes?.map(v => v.toArray()), expected.probes);
    assert.deepStrictEqual(surface(p.mesh.geometry), expected.surface, 'Exact oriented exterior surface must be preserved');
  }
  assert.deepStrictEqual([system.totalEmittedVolume, system.totalRetiredVolume, system.activeFragmentVolume], ledger);
  Object.assign(report, { emittedTriangles, retainedFragments: system.activeFragmentCount, canonicalTriangles, renderedTriangles: system.renderedFragmentTriangles, ...timing });

  // The splitter explicitly rejects indexed input. Exercise actual tool contact
  // and rebreaking after the render index is installed, against the old oracle.
  const box = new THREE.BoxGeometry(.12, .04, .01).toNonIndexed();
  const raw = Array.from(box.getAttribute('position').array); box.dispose();
  // Paired closed zero-volume internal faces model the canonical tetra soup.
  // Exact binary coordinates avoid introducing a tolerance into this fixture.
  const a = [-.03125, -.015625, 0], b = [.03125, -.015625, 0], c = [0, .015625, 0];
  for (let i = 0; i < 7; i++) raw.push(...a, ...b, ...c, ...a, ...c, ...b);
  const positions = new Float32Array(raw), fragment = { position: { x: 0, y: 1.2, z: -2.41 }, size: { x: .12, y: .04, z: .01 }, volume: .12 * .04 * .01, material: 1, detached: true, positions };
  const wall = { contactProvider: () => ({ point: new THREE.Vector3(0, 1.2, -2.51), direction: new THREE.Vector3(0, 0, -1), energyJ: 4 }), volume: { raycast: () => ({ distance: .3 }) }, isSolidAt: () => false, processPendingSupport: () => null, removeAtAim: () => { throw new Error('Canonical loose debris must shield the backing wall'); } };
  const pair = [new Before(new THREE.Scene(), wall), new After(new THREE.Scene(), wall)];
  for (const item of pair) item.spawnDebris({ seed: 42, fragments: [fragment] });
  drain(pair[1]);
  assert(pair[1].particles[0].mesh.geometry.index, 'The actual rebreak fixture must have a render index');
  const camera = new THREE.PerspectiveCamera(), results = pair.map(item => item.freeHit(camera));
  assert.deepStrictEqual(results[1].fragments, results[0].fragments, 'Rebreaking must produce the same exact canonical children');
  assert.equal(pair[1].debrisSplitCount, 1);
  assert.equal(pair[1].activeFragmentVolume, pair[0].activeFragmentVolume);
  const rendered = system.particles.findIndex(p => p.canonicalGeometry);
  const retired = system.particles[rendered]; let physicalDisposed = 0, visibleDisposed = 0;
  retired.mesh.geometry.addEventListener('dispose', () => visibleDisposed++);
  retired.canonicalGeometry.addEventListener('dispose', () => physicalDisposed++);
  system.retireParticle(rendered);
  assert.equal(physicalDisposed, 1); assert.equal(visibleDisposed, 1);
  system.spawnDebris({ seed: 51, fragments: [fragment] });
  const count = system.pendingFragmentRendering;
  system.retireParticle(system.particles.length - 1);
  assert.equal(system.pendingFragmentRendering, count - 1, 'A pending retired geometry must never receive an index later');
  report.passed = true;
  report.checks = ['exact exterior oriented triangles', 'unaltered physical buffers and collision probes', 'unchanged material ledger', 'actual indexed-render rebreak parity', 'bounded work and retirement', 'independent geometry disposal'];
  console.log(JSON.stringify(report, null, 2));
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await server.close();
}
