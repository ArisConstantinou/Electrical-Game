import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

const require = createRequire(import.meta.url), ts = require('typescript'), modules = new Map();
function load(file) {
  file = resolve(file);
  if (modules.has(file)) return modules.get(file);
  const exports = {}; modules.set(file, exports);
  const js = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'exports', js)(name => name.startsWith('.') ? load(resolve(dirname(file), name + '.ts')) : require(name), exports);
  return exports;
}
const { MortarField } = load(fileURLToPath(new URL('../src/systems/MortarField.ts', import.meta.url)));

// Reference is the former string-key flood fill, retained only in this test.
function referenceRelease(field, solid) {
  const visited = new Set(), supported = new Set(), q = new THREE.Vector3(), h = field.spacing;
  for (const [key, node] of field.nodes) {
    if (node.value < .35 || visited.has(key)) continue;
    const members = [node]; visited.add(key); let anchored = false;
    for (let i = 0; i < members.length; i++) {
      const n = members[i];
      if (!anchored) for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]])
        if (solid(q.set((n.x + dx * 1.6) * h, (n.y + dy * 1.6) * h, (n.z + dz * 1.6) * h))) { anchored = true; break; }
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const k = `${n.x + dx},${n.y + dy},${n.z + dz}`, other = field.nodes.get(k);
        if (!visited.has(k) && other && other.value >= .35) { visited.add(k); members.push(other); }
      }
    }
    if (anchored) for (const member of members) supported.add(`${member.x},${member.y},${member.z}`);
  }
  let mass = 0; const center = new THREE.Vector3();
  for (const [key, node] of [...field.nodes]) {
    let keep = supported.has(key);
    if (!keep && node.value < .35) for (let dx = -1; dx <= 1 && !keep; dx++) for (let dy = -1; dy <= 1 && !keep; dy++) for (let dz = -1; dz <= 1; dz++)
      if (supported.has(`${node.x + dx},${node.y + dy},${node.z + dz}`)) { keep = true; break; }
    if (!keep) { const kg = node.value * field.nodeMass; mass += kg; center.addScaledVector(q.set(node.x * h, node.y * h, node.z * h), kg); field.set(node.x, node.y, node.z, 0, node.age); }
  }
  if (mass > 0) { center.multiplyScalar(1 / mass); field.revision++; }
  return { mass, point: center };
}

function populate(field, size) {
  for (let x = -12; x < -12 + size; x++) for (let y = 105; y < 119; y++) for (let z = -308; z < -294; z++) {
    const value = (x + 2 * y + z) % 23 === 0 ? .22 : .52;
    field.set(x, y, z, value, 20, 0);
  }
  for (let x = 42; x < 49; x++) for (let y = 107; y < 113; y++) for (let z = -307; z < -299; z++)
    field.set(x, y, z, (x + y + z) % 7 === 0 ? .18 : .65, 70, .1);
  field.dirty.clear();
}
const cases = [
  ['anchored and detached', q => q.x < -.10],
  ['all detached', () => false],
  ['all anchored', () => true],
];
for (const [name, solid] of cases) {
  const before = new MortarField(), after = new MortarField();
  populate(before, 26); populate(after, 26);
  const first = performance.now(), expected = referenceRelease(before, solid), referenceMs = performance.now() - first;
  const second = performance.now(), actual = after.releaseUnsupported(solid), indexedMs = performance.now() - second;
  assert.equal(actual.mass, expected.mass, `${name}: released mass`);
  assert.deepEqual(actual.point.toArray(), expected.point.toArray(), `${name}: released center`);
  assert.deepEqual([...after.nodes], [...before.nodes], `${name}: surviving material`);
  assert.equal(after.revision, before.revision, `${name}: revision`);
  console.log(JSON.stringify({ name, nodesBefore: 26 * 14 * 14 + 7 * 6 * 8, nodesAfter: after.nodes.size, releasedKg: actual.mass, referenceMs, indexedMs }));
}
{
  const before = new MortarField(), after = new MortarField();
  for (const field of [before, after]) {
    field.set(-1_000_000, -1_000_000, -1_000_000, .7, 10, 0);
    field.set(1_000_000, 1_000_000, 1_000_000, .6, 10, 0);
  }
  const solid = q => q.x < 0;
  const expected = referenceRelease(before, solid), actual = after.releaseUnsupported(solid);
  assert.equal(actual.mass, expected.mass, 'widely separated nodes: released mass');
  assert.deepEqual(actual.point.toArray(), expected.point.toArray(), 'widely separated nodes: center');
  assert.deepEqual([...after.nodes], [...before.nodes], 'widely separated nodes: fallback lookup');
  console.log(JSON.stringify({ name: 'wide-coordinate fallback', nodesAfter: after.nodes.size, releasedKg: actual.mass }));
}
