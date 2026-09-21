import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as THREE from 'three';

execFileSync(process.execPath, [
  'node_modules/esbuild/bin/esbuild', 'src/systems/WorkSurfaceClearance.ts',
  '--bundle', '--platform=node', '--format=esm', '--external:three',
  '--outfile=output/work-surface-clearance-performance/WorkSurfaceClearance.js', '--log-level=error',
]);
const { WorkSurfaceClearance } = await import('../output/work-surface-clearance-performance/WorkSurfaceClearance.js');
const scene = new THREE.Scene(), points = [];
for (let i = 0; i < 24; i++) {
  const point = new THREE.Group(), group = new THREE.Group(), box = new THREE.Group();
  box.add(new THREE.Mesh(new THREE.BoxGeometry(.09, .08, .037)));
  group.boxes = [box]; group.add(box); point.boxGroup = group; point.add(group);
  point.position.set((i % 8 - 3.5) * .23, .75 + Math.floor(i / 8) * .35, -2.38);
  scene.add(point); points.push(point);
}
const clearance = new WorkSurfaceClearance({ deposits: [] }, points);
const queries = Array.from({ length: 223 }, (_, i) => new THREE.Box3(
  new THREE.Vector3(-.55 + (i % 19) * .06, .65 + (i % 13) * .10, -2.5),
  new THREE.Vector3(-.45 + (i % 19) * .06, .80 + (i % 13) * .10, -1.8),
));
const direct = queries.map(box => clearance.frontForBounds(box));
const batched = clearance.withSnapshot(() => queries.map(box => clearance.frontForBounds(box)));
assert.deepEqual(batched, direct, 'Snapshot preserves every wall/box clearance answer');

const measure = batched => {
  const samples = [];
  for (let round = 0; round < 25; round++) {
    const start = performance.now();
    if (batched) clearance.withSnapshot(() => { for (const box of queries) clearance.frontForBounds(box); });
    else for (const box of queries) clearance.frontForBounds(box);
    if (round >= 5) samples.push(performance.now() - start);
  }
  return { medianMs: [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)], samples: samples.length };
};
const result = { scenario: '24 stable casings, 223 distinct clearance queries per solve, Node CPU only', direct: measure(false), batched: measure(true) };
console.log(JSON.stringify(result, null, 2));
