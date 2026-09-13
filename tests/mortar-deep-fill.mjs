import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import * as THREE from 'three';

const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
const out = process.argv[2] ?? 'output/mortar-deep-fill';
await mkdir(out, { recursive: true });
const report = { fixture: 'Real rounded-five clay volume, broad impact-cut recess; sighted finite scoops at four fixed targets on initially dry masonry. No authored mortar or adaptive deepest-cell targeting.', loads: [], timing: {} };
try {
  const { MasonryVolume } = await server.ssrLoadModule('/src/world/MasonryVolume.ts');
  const { MortarSystem } = await server.ssrLoadModule('/src/systems/MortarSystem.ts');
  const volume = new MasonryVolume({ seed: 260913 }), front = volume.frontZ;
  for (let pass = 0; pass < 4; pass++) for (let x = -.105; x <= .10501; x += .035) for (let y = 1.33; y <= 1.47001; y += .035) {
    const hit = volume.raycast({ x, y, z: front + .08 }, { x: 0, y: 0, z: -1 }, .24);
    if (hit && front - hit.point.z < .07) volume.impact({ point: hit.point, direction: { x: 0, y: 0, z: -1 }, chisel: 'flat', widthM: .05, energyJ: 8 });
  }
  const columns = [];
  for (let x = -.096; x <= .09601; x += .016) for (let y = 1.336; y <= 1.46401; y += .016) {
    const hit = volume.raycast({ x, y, z: front + .02 }, { x: 0, y: 0, z: -1 }, .24);
    if (hit && front - hit.point.z > .016) columns.push({ x, y, back: hit.point.z });
  }
  assert(columns.length > 80);
  report.columns = columns.length;
  report.depthRangeMm = [Math.min(...columns.map(c => front - c.back)) * 1000, Math.max(...columns.map(c => front - c.back)) * 1000];
  const mortar = new MortarSystem(new THREE.Scene(), { volume }, []), camera = new THREE.PerspectiveCamera();
  const instrument = (object, key) => {
    const original = object[key].bind(object), timing = report.timing[key] = { calls: 0, totalMs: 0, maxMs: 0 };
    object[key] = (...args) => { const start = performance.now(); const result = original(...args); const elapsed = performance.now() - start; timing.calls++; timing.totalMs += elapsed; timing.maxMs = Math.max(timing.maxMs, elapsed); return result; };
  };
  instrument(mortar, 'deposit'); instrument(mortar, 'syncFieldGeometry'); instrument(mortar.field, 'add'); instrument(mortar.field, 'raycast');
  const targets = [[-.05, 1.36], [.05, 1.36], [-.05, 1.44], [.05, 1.44]];
  for (let load = 0; load < 16; load++) {
    const [x, y] = targets[load % targets.length];
    camera.position.set(0, 1.65, front + .55); camera.lookAt(x, y, front - .05); camera.updateMatrixWorld(true);
    const origin = mortar.releaseOrigin(camera, new THREE.Vector3(.035, 1.5, front + .18));
    mortar.launch(origin, mortar.velocity(camera, .5, origin), .65);
    for (let frame = 0; frame < 100; frame++) mortar.update(1 / 60);
    let flush = 0, filled = 0, count = 0;
    for (const c of columns) {
      const hit = mortar.field.raycast(new THREE.Vector3(c.x, c.y, front + .02), new THREE.Vector3(0, 0, -1), .24);
      if (hit && front - hit.point.z < .012) flush++;
      for (let z = c.back + .004; z < front; z += .008) { count++; filled += Math.min(1, mortar.field.sample(new THREE.Vector3(c.x, c.y, z))); }
    }
    const t = mortar.telemetry, error = t.launchedKg - t.stuckKg - t.floorKg - t.restingKg - t.movingKg;
    assert(Math.abs(error) < 1e-7);
    report.loads.push({ load: load + 1, stuckKg: t.stuckKg, launchedKg: t.launchedKg, flush: flush / columns.length, fill: filled / count, errorKg: error });
  }
  assert(report.loads[0].stuckKg > .4, 'First backed-cavity scoop was rejected by microfacets');
  assert(report.loads[7].fill > .6, 'Repeated scoops fail to stack in the deep recess');
  assert.equal(report.loads.at(-1).flush, 1, 'Deep recess could not be filled to the wall face');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await server.close();
}
