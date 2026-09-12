import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as THREE from 'three';

// Fast isolated geometry/physics regression tests. The production TypeScript
// class runs unchanged; analytical receiving surfaces isolate it from browser,
// mesh-worker and demolition timing. Actual player-input coverage is exercised
// separately by gameplay-smoke.mjs and the browser mortar acceptance test.
const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = await readFile(new URL('../src/systems/MortarSystem.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const moduleExports = {};
new Function('require', 'exports', compiled)(require, moduleExports);
const { MortarSystem } = moduleExports;
const report = { suite: 'mortar-geometry', fixtures: 'analytical solid surfaces; production MortarSystem and Three.js', checks: [] };

function wallFixture(axis = 'z', coordinate = 0) {
  return {
    volume: {
      raycast(origin, direction, maximum) {
        if (Math.abs(direction[axis]) < 1e-9) return null;
        const distance = (coordinate - origin[axis]) / direction[axis];
        if (distance < 0 || distance > maximum) return null;
        const point = new THREE.Vector3().copy(origin).addScaledVector(direction, distance);
        const normal = new THREE.Vector3(); normal[axis] = 1;
        return { point, normal };
      },
    },
  };
}

function boxFixture(scene, tilt = 0) {
  const point = new THREE.Group(), group = new THREE.Group(), box = new THREE.Group();
  box.width = .12; box.height = .08;
  group.boxes = [box]; group.groupWidth = box.width; group.groupHeight = box.height;
  group.add(box); point.add(group); point.boxGroup = group;
  point.definition = { id: 'fixture-box' }; point.stage = 'fitted';
  point.setStage = function setStage(stage) { this.stage = stage; };
  point.position.y = 1; group.rotation.z = tilt; scene.add(point);
  point.updateWorldMatrix(true, true);
  return { point, group, box };
}

function advance(system, seconds) {
  const count = Math.ceil(seconds * 120);
  for (let i = 0; i < count; i++) system.update(seconds / count);
}

function assertMass(system, label) {
  const t = system.telemetry;
  const remainder = t.launchedKg - t.stuckKg - t.restingKg - t.floorKg - t.movingKg;
  assert(Math.abs(remainder) < 1e-8, `${label}: mass imbalance ${remainder} kg`);
  return { launchedKg: t.launchedKg, adheredKg: t.stuckKg, restingKg: t.restingKg, floorKg: t.floorKg, movingKg: t.movingKg, errorKg: remainder };
}

// Seed a physically generated deposited patch, accounting for precisely the
// accepted mass. This is unit-fixture setup, not an alternate gameplay action.
function seedPatch(system, point, mass = .12, normal = new THREE.Vector3(0, 0, 1)) {
  const accepted = system.deposit(point, mass, normal);
  system.launchedMass += accepted; system.stuckMass += accepted;
  return accepted;
}

function vertexCount(system) {
  return system.deposits.reduce((sum, deposit) => sum + deposit.mesh.geometry.getAttribute('position').count, 0);
}

// Exact convex polygon intersection in box-local XY. Centroid-only assertions
// miss triangles that cross the opening even when every vertex is outside it.
function openingIntrusion(system, box) {
  box.updateWorldMatrix(true, false);
  const inverse = box.matrixWorld.clone().invert();
  const halfWidth = box.width / 2 - .00101, halfHeight = box.height / 2 - .00101;
  let area = 0, intersectingTriangles = 0, testedTriangles = 0;
  for (const deposit of system.deposits) {
    const positions = deposit.mesh.geometry.getAttribute('position');
    deposit.mesh.updateWorldMatrix(true, false);
    for (let i = 0; i < positions.count; i += 3) {
      let polygon = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(positions, i + j).applyMatrix4(deposit.mesh.matrixWorld).applyMatrix4(inverse));
      testedTriangles++;
      for (const [axis, sign, extent] of [['x', 1, halfWidth], ['x', -1, halfWidth], ['y', 1, halfHeight], ['y', -1, halfHeight]]) {
        const clipped = [];
        for (let k = 0; k < polygon.length; k++) {
          const a = polygon[k], b = polygon[(k + 1) % polygon.length];
          const da = a[axis] * sign - extent, db = b[axis] * sign - extent;
          if (da <= 0) clipped.push(a);
          if ((da <= 0) !== (db <= 0)) clipped.push(a.clone().lerp(b, da / (da - db)));
        }
        polygon = clipped;
      }
      let signedArea = 0;
      for (let k = 0; k < polygon.length; k++) {
        const a = polygon[k], b = polygon[(k + 1) % polygon.length];
        signedArea += a.x * b.y - b.x * a.y;
      }
      const overlap = Math.abs(signedArea) * .5;
      if (overlap > 1e-10) { intersectingTriangles++; area += overlap; }
    }
  }
  return { testedTriangles, intersectingTriangles, projectedOverlapM2: area };
}

// A free cast that hits a vertical surface eventually becomes adhered material
// and floor waste, without disappearing or remaining forever airborne.
{
  const system = new MortarSystem(new THREE.Scene(), wallFixture(), []);
  system.launch(new THREE.Vector3(0, 1, .5), new THREE.Vector3(0, 0, -4));
  advance(system, 5);
  assert.equal(system.telemetry.airborne, 0, 'Vertical cast never settled');
  assert(system.stuckMass > 0 && system.floorMass > 0, 'Cast must retain some material and drop the remainder');
  report.checks.push({ name: 'vertical cast and floor mass', ...assertMass(system, 'vertical cast') });
}

// Regression for thousands of repeated contacts on a horizontal cavity ledge.
{
  const system = new MortarSystem(new THREE.Scene(), wallFixture('y', .3), []);
  system.launch(new THREE.Vector3(0, .5, -.04), new THREE.Vector3(0, -.2, 0));
  advance(system, 5);
  assert.equal(system.telemetry.airborne, 0, 'Ledge residue remained trapped in the contact loop');
  assert(system.restingMass > .01, 'Ledge residue never entered the resting state');
  assert.equal(system.floorMass, 0, 'Ledge residue was teleported to the floor');
  assert(system.resting.length > 0 && system.resting.length <= 64, 'Resting geometry is missing or exceeds its batch limit');
  const bounds = system.resting[0].mesh.geometry.boundingSphere;
  assert(bounds.center.y > .29 && bounds.center.y < .36, 'Resting geometry moved away from the actual ledge');
  const contact = system.contact(bounds.center.clone().add(new THREE.Vector3(0, .1, 0)), new THREE.Vector3(0, -1, 0), .2);
  assert(contact && contact.point.y > .304, 'Resting geometry is absent from subsequent solid-contact queries');
  report.checks.push({ name: 'ledge resting without floor teleport', restingY: bounds.center.y, ...assertMass(system, 'ledge') });
}

// The box starts tilted. Its entire opening stays free, including after its
// leveling rotation, lateral correction and depth adjustment change the mask.
{
  const scene = new THREE.Scene(), { point, group, box } = boxFixture(scene, .13);
  const system = new MortarSystem(scene, wallFixture(), [point]); system.update(.01);
  assert(seedPatch(system, new THREE.Vector3(.066, 1.034, 0), .2) > .01, 'Opening fixture generated no mortar');
  const tilted = openingIntrusion(system, box);
  assert.equal(tilted.intersectingTriangles, 0, 'Triangle crosses tilted box opening');
  group.rotation.z = 0; group.position.x = .004; group.position.z = .003;
  system.update(.01);
  const moved = openingIntrusion(system, box);
  assert.equal(moved.intersectingTriangles, 0, 'Old mortar crosses the newly moved/leveled opening');
  assert(system.telemetry.movingKg > 0, 'Reclipped material vanished instead of becoming detached mass');
  const beforeRepeated=vertexCount(system);
  for(let i=0;i<24;i++){group.rotation.z=(i%2?1:-1)*.012;group.position.z=i%2?.003:.005;system.update(.02);}
  const afterRepeated=vertexCount(system);
  assert(afterRepeated<beforeRepeated*8,'Repeated leveling caused runaway retriangulation');
  assert.equal(openingIntrusion(system,box).intersectingTriangles,0,'Repeated leveling covered an opening');
  report.checks.push({name:'bounded repeated leveling',beforeRepeated,afterRepeated});
  report.checks.push({ name: 'tilted and moved opening clipping', tilted, moved, ...assertMass(system, 'opening reclip') });
  advance(system, 4); assertMass(system, 'detached opening material after fall');
}

// Stable-record compaction must not achieve its bound by deleting material.
{
  const system = new MortarSystem(new THREE.Scene(), wallFixture(), []);
  seedPatch(system, new THREE.Vector3(0, 1, 0));
  seedPatch(system, new THREE.Vector3(.065, 1, 0));
  advance(system, 1.4);
  const before = { records: system.deposits.length, vertices: vertexCount(system), mass: system.deposits.reduce((sum, d) => sum + d.mass, 0) };
  assert.equal(before.records, 2, 'Compaction fixture needs two supported deposits');
  system.mergeStablePatches();
  const after = { records: system.deposits.length, vertices: vertexCount(system), mass: system.deposits.reduce((sum, d) => sum + d.mass, 0) };
  assert.equal(after.records, 1, 'Stable records did not compact');
  assert.equal(after.vertices, before.vertices, 'Compaction discarded surface triangles');
  assert(Math.abs(after.mass - before.mass) < 1e-12, 'Compaction lost retained mass');
  const bounds = system.deposits[0].mesh.geometry.boundingSphere;
  assert(bounds.radius > .05 && bounds.center.x > 0, 'Compacted collision bounds omit one constituent');
  report.checks.push({ name: 'stable geometry compaction', before, after, ...assertMass(system, 'compaction') });
}

// Full geometric coverage is visible immediately, but the mission must wait
// through the fresh-patch release window before calling the installation ready.
{
  const scene = new THREE.Scene(), { point, group } = boxFixture(scene);
  const system = new MortarSystem(scene, wallFixture(), [point]); system.update(.01);
  const width = group.groupWidth / 2 + .026, height = group.groupHeight / 2 + .024;
  for (let side = 0; side < 4; side++) for (const t of [-.75, 0, .75]) {
    const local = new THREE.Vector3(side < 2 ? t * width : side === 2 ? -width : width, side < 2 ? side === 0 ? -height : height : t * height, 0);
    seedPatch(system, group.localToWorld(local), .16);
  }
  const freshCoverage = system.coverage(point);
  assert(freshCoverage >= .68, `Stable-age fixture lacks actual four-sided triangle coverage: ${freshCoverage}`);
  assert.equal(point.stage, 'fitted', 'Fresh deposition marked the point mortared immediately');
  advance(system, .8);
  assert.equal(point.stage, 'fitted', 'Point passed before the fresh-material release window ended');
  advance(system, 1);
  assert.equal(point.stage, 'mortared', 'Stable physical coverage never completed the stage');
  report.checks.push({ name: 'stable-age stage gating', freshCoverage, finalCoverage: system.coverage(point), stage: point.stage, ...assertMass(system, 'stable-age coverage') });
}

console.log(JSON.stringify({ ...report, passed: true }, null, 2));
