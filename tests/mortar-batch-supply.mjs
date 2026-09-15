import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as THREE from 'three';

// The production batch and throw system share one actual source callback.
// An empty analytical wall keeps this test about input timing and material supply;
// mortar-volume-regression separately exercises impact, adhesion and wall filling.
const require = createRequire(import.meta.url), ts = require('typescript'), modules = new Map();
function load(file) {
  file = resolve(file);
  if (modules.has(file)) return modules.get(file);
  const exports = {}; modules.set(file, exports);
  new Function('require', 'exports', ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText)(name => name.startsWith('.') ? load(resolve(dirname(file), name + '.ts')) : require(name), exports);
  return exports;
}
const { MortarSystem } = load(fileURLToPath(new URL('../src/systems/MortarSystem.ts', import.meta.url)));
const { MortarBatch } = load(fileURLToPath(new URL('../src/systems/MortarBatch.ts', import.meta.url)));
const { TROWEL_CHARGE_SECONDS, TROWEL_FULL_CHARGE_GRACE_SECONDS, TROWEL_RELEASE_SECONDS } = load(fileURLToPath(new URL('../src/player/TrowelMotion.ts', import.meta.url)));
const near = (actual, expected, message) => assert(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} != ${expected}`);
const checks = [];
function batch(water = .5, cement = 1, sand = 1) {
  const result = new MortarBatch();
  assert(result.addWater(water)); assert(result.openSack(0));
  for (let n = 0; n < cement; n++) { assert(result.scoopCement(0)); assert(result.pour('trowel')); }
  for (let n = 0; n < sand; n++) { assert(result.scoopSand()); assert(result.pour('shovel')); }
  result.mix(8); assert(result.ready); return result;
}
function fixture(source = batch()) {
  const wall = { volume: { frontZ: 0, isOccupied: () => false, raycast: () => null } };
  const system = new MortarSystem(new THREE.Scene(), wall, []), camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1, 2); camera.lookAt(0, 1, 0); camera.updateMatrixWorld(true);
  const origin = new THREE.Vector3(0, 1, 1.8), reservations = [];
  system.reserveScoop = requested => { reservations.push(requested); return source.consumeKg(requested); };
  return { source, system, camera, origin, reservations };
}
function swing(f, held, dt) { f.system.swing(held, dt, f.camera, () => f.origin); }
function recover(f) { for (let i = 0; i < 10; i++) f.system.update(.1); }
function cast(f, chargeSeconds = TROWEL_CHARGE_SECONDS / 2) {
  swing(f, true, chargeSeconds); swing(f, false, 0); swing(f, false, TROWEL_RELEASE_SECONDS);
}
function conserved(f) {
  const s = f.source.getState(), t = f.system.telemetry;
  const inventories = s.sandRemainingKg + s.sacks.reduce((sum, sack) => sum + sack.remainingKg, 0)
    + (s.heldTrowel?.kg ?? 0) + (s.heldShovel?.kg ?? 0);
  near(s.massKg + s.consumedKg + (s.discardedKg ?? 0) + inventories, s.initialStockKg + s.addedWaterLitres, 'Source ledger conserves mass');
  near(t.launchedKg, t.stuckKg + t.restingKg + t.floorKg + t.movingKg, 'Thrown material remains accounted for');
}

{
  const f = fixture(), before = f.source.getState();
  swing(f, true, TROWEL_CHARGE_SECONDS / 2);
  assert.deepEqual(f.source.getState(), before, 'Charging does not reserve material');
  swing(f, false, 0); swing(f, false, TROWEL_RELEASE_SECONDS - .001);
  assert.equal(f.reservations.length, 0); assert.deepEqual(f.source.getState(), before, 'Pending wrist motion does not consume');
  f.system.cancel(); swing(f, false, 1);
  assert.equal(f.reservations.length, 0); assert.equal(f.system.launchedMass, 0);
  assert.deepEqual(f.source.getState(), before, 'Cancelled pending throw preserves the batch');
  swing(f, true, TROWEL_CHARGE_SECONDS + TROWEL_FULL_CHARGE_GRACE_SECONDS);
  assert(f.system.throwFeedback.overheld); swing(f, false, 0); swing(f, false, 1);
  assert.equal(f.reservations.length, 0); assert.deepEqual(f.source.getState(), before, 'Expired hold consumes no material');
  conserved(f); checks.push('charging, pending, cancellation and expired hold preserve source');
}

for (const source of [new MortarBatch(), (() => { const s = batch(); s.addWater(.1); return s; })()]) {
  const f = fixture(source), before = source.getState();
  cast(f);
  assert.deepEqual(f.reservations, [.65], 'Availability is checked at actual release');
  assert.equal(f.system.launchedMass, 0); assert.equal(f.system.projectiles.length, 0);
  assert.deepEqual(source.getState(), before, 'Unavailable or unfinished source contributes no material');
  conserved(f);
}
checks.push('empty and remix-required batches refuse launches');

for (const [count, charge] of [[48, TROWEL_CHARGE_SECONDS / 2], [47, TROWEL_CHARGE_SECONDS * .8]]) {
  const f = fixture(), before = f.source.getState();
  for (let i = 0; i < count; i++) f.system.launch(f.origin, new THREE.Vector3(0, 0, -1), .01);
  const priorLaunched = f.system.launchedMass;
  cast(f, charge);
  assert.equal(f.reservations.length, 0, 'Projectile capacity must reject BEFORE reserving source mass');
  assert.deepEqual(f.source.getState(), before); assert.equal(f.system.launchedMass, priorLaunched);
  assert.equal(f.system.projectiles.length, count); conserved(f);
}
checks.push('48-clod full budget and 47-clod late split reject before reservation');

{
  const f = fixture(), initialMass = f.source.massKg;
  cast(f);
  assert.deepEqual(f.reservations, [.65]); near(initialMass - f.source.massKg, .65, 'Actual release withdraws one finite scoop');
  near(f.system.launchedMass, .65, 'Reserved mass equals launched mass');
  near(f.system.projectiles[0].mass, .65, 'Projectile carries the reserved mass');
  conserved(f);
  while (f.source.massKg > .65) {
    recover(f); cast(f); conserved(f);
  }
  recover(f);
  const finalPartial = f.source.massKg, previousLaunch = f.system.launchedMass;
  assert(finalPartial > 0 && finalPartial < .65, 'Fixture reaches a final partial scoop');
  cast(f);
  near(f.system.launchedMass - previousLaunch, finalPartial, 'Final partial scoop is launched exactly');
  near(f.system.projectiles.at(-1).mass, finalPartial, 'Final clod retains partial size');
  assert.equal(f.source.massKg, 0);
  near(f.source.getState().consumedKg, initialMass, 'Batch depleted exactly');
  near(f.system.launchedMass, initialMass, 'No default .65kg fabrication after partial withdrawal');
  recover(f);
  const beforeEmptyCast = f.system.launchedMass, projectileCount = f.system.projectiles.length;
  cast(f);
  assert.equal(f.system.launchedMass, beforeEmptyCast); assert.equal(f.system.projectiles.length, projectileCount);
  conserved(f); checks.push('success, final partial scoop and depletion conserve batch-to-world mass');
}

{
  const f = fixture(), before = f.source.massKg;
  cast(f, TROWEL_CHARGE_SECONDS * .8);
  assert.deepEqual(f.reservations, [.65], 'Late split reserves once for all three clods');
  assert.equal(f.system.projectiles.length, 3);
  near(f.system.projectiles.reduce((sum, clod) => sum + clod.mass, 0), .65, 'Forward and backward shares sum to the reservation');
  near(before - f.source.massKg, .65, 'Late scoop withdrawal is unique');
  conserved(f); checks.push('late split distributes one uniquely reserved scoop');
}

{
  const weak = fixture(batch(5, 2, 12)), normal = fixture();
  assert.equal(weak.source.quality, 'weak');
  // The interaction layer supplies its quality policy; MortarSystem must apply it.
  weak.system.scoopBond = () => weak.source.quality === 'weak' ? .4 : 1;
  normal.system.scoopBond = () => 1;
  cast(weak); cast(normal);
  near(weak.system.projectiles[0].bond, .4, 'Weak quality reaches the physical clod adhesion parameter');
  near(normal.system.projectiles[0].bond, 1, 'Ordinary transfer retains the full adhesion parameter');
  assert(weak.system.projectiles[0].bond < normal.system.projectiles[0].bond);
  near(weak.system.projectiles[0].mass, normal.system.projectiles[0].mass, 'Quality changes adhesion without fabricating or losing mass');
  conserved(weak); conserved(normal); checks.push('custom quality modifies physical adhesion while preserving scoop mass');
}

console.log(JSON.stringify({ passed: true, suite: 'mortar-batch-supply', checks }));
