import assert from 'node:assert/strict';
import { createServer } from 'vite';
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { MasonryVolume, MaterialId } = await server.ssrLoadModule('/src/world/MasonryVolume.ts');
  const v = new MasonryVolume({ seed: 1234 });
  const front = v.frontZ;
  const x = -.128, y = 1.5;
  const beforeRear = v.sampleMaterial(x, y, front - .175);
  assert.notEqual(beforeRear, MaterialId.Air);
  let hole = false;
  const impacts = [];
  for (let i = 0; i < 45; i++) {
    const hit = v.raycast({ x, y, z: front + .3 }, { x: 0, y: 0, z: -1 }, .7);
    if (!hit) { hole = true; break; }
    const impact = v.impact({ point: hit.point, direction: { x: 0, y: 0, z: -1 }, chisel: 'pointed', energyJ: 4 });
    impacts.push({ removed: impact.removedNodes, depth: Math.round((front - hit.point.z) * 1000), ms: Math.round(impact.stats.milliseconds * 100) / 100, islands: impact.stats.detachedNodes });
    assert.equal(impact.fragments.reduce((sum, f) => sum + f.volume, 0).toFixed(10), impact.removedVolume.toFixed(10), 'Fragment volume must account for all removed nodes once');
    for (const fragment of impact.fragments) {
      let meshVolume = 0; const p = fragment.positions;
      assert(p?.length, 'Every removed fragment has actual local geometry');
      for (let j = 0; j < p.length; j += 9) meshVolume += (p[j] * (p[j + 4] * p[j + 8] - p[j + 5] * p[j + 7]) + p[j + 1] * (p[j + 5] * p[j + 6] - p[j + 3] * p[j + 8]) + p[j + 2] * (p[j + 3] * p[j + 7] - p[j + 4] * p[j + 6])) / 6;
      assert(Math.abs(Math.abs(meshVolume) - fragment.volume) < Math.max(1e-12, fragment.volume * .0001), 'Fragment triangle volume must match actual removed volume');
    }
    if (i === 0) assert.equal(v.sampleMaterial(x, y, front - .175), beforeRear, 'First shell impact must not teleport damage into rear shell');
  }
  assert(v.removedNodeCount > 0, 'Repeated impacts must permanently remove material');
  const save = JSON.parse(JSON.stringify(v.serialize()));
  const restored = new MasonryVolume({ seed: 1234 }); restored.restore(save);
  assert.deepEqual(restored.serialize(), v.serialize(), 'Persistent damage and weakness must roundtrip');
  const hitA = v.raycast({ x, y, z: front + .3 }, { x: 0, y: 0, z: -1 }, .7);
  const hitB = restored.raycast({ x, y, z: front + .3 }, { x: 0, y: 0, z: -1 }, .7);
  assert.deepEqual(hitA, hitB);
  const specimen = new MasonryVolume({ width: .12, height: .12, depth: .064, solidMaterial: MaterialId.Clay, seed: 44 });
  for (let i = 0; i < 3; i++) {
    const hit = specimen.raycast({ x: 0, y: .06, z: front + .1 }, { x: 0, y: 0, z: -1 }, .3);
    specimen.impact({ point: hit.point, direction: { x: 0, y: 0, z: -1 }, chisel: 'flat', energyJ: 4 });
  }
  for (const z of [-2.417, -2.416, -2.415]) {
    const point = { x: -.03, y: .064, z };
    assert.equal(specimen.cavityBox(point, point).clear, !specimen.isOccupied(point.x, point.y, point.z), 'Fit and ray/visual occupancy agree at diagonal fracture faces');
  }
  function anglePattern(direction, edge) {
    const volume = new MasonryVolume({ seed: 2026 });
    const point = { x: .8, y: 1.55, z: front };
    for (let i = 0; i < 6; i++) {
      const origin = { x: point.x - direction.x * .15, y: point.y - direction.y * .15, z: point.z - direction.z * .15 };
      const hit = volume.raycast(origin, direction, .4);
      if (hit) volume.impact({ point: hit.point, direction, edge, chisel: 'flat', energyJ: 4 });
    }
    return volume.serialize();
  }
  const straight = anglePattern({ x: 0, y: 0, z: -1 }, { x: 1, y: 0, z: 0 });
  const rotated = anglePattern({ x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
  const tilted = anglePattern({ x: 0, y: -Math.sin(70 * Math.PI / 180), z: -Math.cos(70 * Math.PI / 180) }, { x: 1, y: 0, z: 0 });
  assert.notDeepEqual(straight.chunks, rotated.chunks, 'Independent flat blade rotation must change fracture orientation');
  assert.notDeepEqual(straight.chunks, tilted.chunks, 'Hammer attack tilt must change the true contact/fracture field');
  assert.deepEqual(straight, anglePattern({ x: 0, y: 0, z: -1 }, { x: 1, y: 0, z: 0 }), 'Replay with explicit seed and identical impacts must match');
  const limited = new MasonryVolume({ seed: 111, maxConnectivityNodes: 1 });
  for (let i = 0; i < 4; i++) {
    const hit = limited.raycast({ x: .8, y: 1.55, z: front + .1 }, { x: 0, y: 0, z: -1 }, .4);
    limited.impact({ point: hit.point, direction: { x: 0, y: 0, z: -1 }, chisel: 'flat', energyJ: 4 });
  }
  assert(limited.pendingSupportCount > 0, 'Exhausted support budget retains resumable work');
  const limitedSave = limited.serialize(), limitedRestored = new MasonryVolume({ seed: 111, maxConnectivityNodes: 1 });
  limitedRestored.restore(limitedSave); assert.equal(limitedRestored.pendingSupportCount, limited.pendingSupportCount);
  for (let i = 0; i < 100 && limitedRestored.pendingSupportCount; i++) limitedRestored.processPendingSupport(300);
  assert.equal(limitedRestored.pendingSupportCount, 0, 'Deferred support work completes after later frames');
  const dirty = v.takeDirtyChunks();
  let meshMs = 0, triangles = 0, snapshotMs = 0;
  const { buildMeshJob } = await server.ssrLoadModule('/src/world/masonryMesher.ts');
  for (const key of dirty) {
    const started = performance.now(), job = v.exportMeshJob(key); snapshotMs += performance.now() - started;
    const mesh = buildMeshJob(job); assert(mesh.positions.every(Number.isFinite), 'Worker snapshot mesher produces finite actual geometry');
  }
  for (const key of dirty) { const start = performance.now(); const mesh = v.buildChunkMesh(key); meshMs += performance.now() - start; triangles += mesh.positions.length / 9; assert(mesh.positions.every(Number.isFinite)); }
  const start = performance.now(); let pristineTriangles = 0;
  for (const key of new MasonryVolume().chunkKeys) pristineTriangles += v.buildPristineChunkMesh(key).positions.length / 9;
  console.log(JSON.stringify({ impacts, hole, removedNodes: v.removedNodeCount, removedVolumeCm3: v.removedVolume * 1e6, sparseBytes: v.memoryBytes, dirty: dirty.length, triangles, meshMs: Math.round(meshMs), snapshotMs: Math.round(snapshotMs), pristineTriangles, pristineMs: Math.round(performance.now() - start) }, null, 2));
} finally { await server.close(); }
