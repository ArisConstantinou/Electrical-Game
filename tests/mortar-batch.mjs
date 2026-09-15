import assert from 'node:assert/strict';
import { build } from 'esbuild';
await build({ entryPoints: ['src/systems/MortarBatch.ts'], outfile: 'output/mortar-batch.mjs', bundle: true, platform: 'node', format: 'esm' });
const { MortarBatch, MORTAR_RECIPE } = await import('../output/mortar-batch.mjs');
const near = (actual, expected, message) => assert(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} != ${expected}`);
function conserve(batch) {
  const s = batch.getState();
  const accounted = s.massKg + s.consumedKg + s.discardedKg + s.sandRemainingKg + s.sacks.reduce((n, sack) => n + sack.remainingKg, 0)
    + (s.heldTrowel?.kg ?? 0) + (s.heldShovel?.kg ?? 0);
  near(accounted, s.initialStockKg + s.addedWaterLitres, 'All source, tool, bucket and consumed mass conserved');
}
function cement(batch, n = 6) {
  batch.openSack(0);
  for (let i = 0; i < n; i++) { assert(batch.scoopCement(0)); assert(batch.pour('trowel')); conserve(batch); }
}
function sand(batch, n = 12) {
  for (let i = 0; i < n; i++) { assert(batch.scoopSand()); assert(batch.pour('shovel')); conserve(batch); }
}

const batch = new MortarBatch();
assert.equal(batch.quality, 'empty');
assert.equal(batch.scoopCement(0), false, 'Sealed sack cannot be scooped');
assert.equal(batch.consumeKg(1), 0);
assert.equal(batch.mix(100), 0);
assert(batch.openSack(0));
assert.equal(batch.openSack(0), false);
assert.equal(batch.scoopCement(1), false, 'Sacks open independently');
assert(batch.scoopCement(0));
const stockWithLoad = batch.getState().sacks[0].remainingKg;
assert.equal(batch.scoopCement(0), false, 'Loaded trowel cannot overwrite its payload');
assert.equal(batch.getState().sacks[0].remainingKg, stockWithLoad);
assert(batch.scoopSand());
assert(batch.getState().heldTrowel && batch.getState().heldShovel, 'Switching between tools retains both loads');
conserve(batch);
assert(batch.pour('trowel')); assert(batch.pour('shovel'));
assert.equal(batch.pour('shovel'), false, 'A poured load cannot duplicate');
assert.equal(batch.addWater(MORTAR_RECIPE.waterLitres), MORTAR_RECIPE.waterLitres);
cement(batch, 5); sand(batch, 11);
near(batch.cementScoops, 6, 'Recipe cement scoops'); near(batch.sandScoops, 12, 'Recipe sand scoops');
assert(batch.volumeLitres > 19 && batch.volumeLitres <= 20, 'Guide produces a nearly full garden bucket');
assert.equal(batch.quality, 'unmixed');
assert.equal(batch.consumeKg(1), 0, 'Raw ingredients cannot be used as finished mortar');
assert.equal(batch.mix(7.9), 7.9 / 8); assert.equal(batch.ready, false);
batch.mix(.1); assert.equal(batch.ready, true); assert.equal(batch.quality, 'balanced');
const beforeOverflow = batch.getState();
assert.equal(batch.addWater(1), 0); assert.deepEqual(batch.getState(), beforeOverflow, 'Water overflow leaves state intact');
assert(batch.scoopSand());
const payload = batch.getState().heldShovel;
assert.equal(batch.pour('shovel'), false); assert.deepEqual(batch.getState().heldShovel, payload, 'Overflow retains shovel material');
assert.equal(batch.ready, true, 'Failed addition does not invalidate completed mixing');
conserve(batch);
const beforeUse = batch.massKg;
near(batch.consumeKg(4), 4, 'Finite withdrawal'); near(batch.massKg, beforeUse - 4, 'Withdrawal reduces mass');
assert(batch.pour('shovel'), 'Retained scoop pours after making room');
assert.equal(batch.ready, false); assert.equal(batch.mixProgress, 0, 'Added ingredient requires remix');
assert.equal(batch.consumeKg(1), 0); batch.mix(8);
const remaining = batch.massKg;
near(batch.consumeKg(1000), remaining, 'Overlarge request only takes available mortar');
assert.equal(batch.massKg, 0); assert.equal(batch.ready, false); assert.equal(batch.quality, 'empty');
assert.equal(batch.consumeKg(1), 0); conserve(batch);

// Invalid public inputs never poison stocks, totals, mixing, or readiness.
const unchanged = batch.getState();
for (const value of [NaN, Infinity, -Infinity, -1, 0]) {
  assert.equal(batch.addWater(value), 0); assert.equal(batch.consumeKg(value), 0); assert.equal(batch.mix(value), 0);
}
for (const index of [NaN, Infinity, -1, .5, 3]) { assert.equal(batch.openSack(index), false); assert.equal(batch.scoopCement(index), false); }
assert.deepEqual(batch.getState(), unchanged);
const copy = batch.getState(); copy.sacks[0].remainingKg = -100; assert.deepEqual(batch.getState(), unchanged, 'Telemetry cannot mutate inventory');
for (const options of [{ sackKg: NaN }, { sandKg: Infinity }, { sandKg: -1 }, { sackKg: Number.MAX_VALUE }]) assert.throws(() => new MortarBatch(options), RangeError);

// Each finite sack, including its final partial scoop, depletes independently without rounding loss.
const finite = new MortarBatch({ sackKg: .7, sandKg: 3 });
assert.equal(finite.addWater(.8), .8);
for (let sack = 0; sack < 3; sack++) {
  assert(finite.openSack(sack));
  assert(finite.scoopCement(sack)); assert(finite.pour('trowel'));
  assert(finite.scoopCement(sack)); assert(finite.getState().heldTrowel.kg < .504); assert(finite.pour('trowel'));
  assert.equal(finite.scoopCement(sack), false); conserve(finite);
}
assert(finite.scoopSand()); assert(finite.pour('shovel'));
assert(finite.scoopSand()); assert(finite.getState().heldShovel.kg < 2.24); assert(finite.pour('shovel'));
assert.equal(finite.scoopSand(), false); finite.mix(8); conserve(finite);
finite.consumeKg(100); conserve(finite);
assert.equal(finite.massKg, 0); assert.equal(finite.getState().sandRemainingKg, 0);

// Custom proportions remain usable, with understandable qualitative feedback.
for (const [water, scoops, shovels, quality] of [[8, 6, 3, 'wet'], [1, 6, 10, 'dry'], [5, 2, 12, 'weak']]) {
  const custom = new MortarBatch(); custom.addWater(water); cement(custom, scoops); sand(custom, shovels); custom.mix(8);
  assert.equal(custom.quality, quality); assert(custom.consumeKg(.2) > 0, `${quality} custom recipe is still usable`); conserve(custom);
}
// Water additions reset an already finished mix too; long holds saturate safely.
const remix = new MortarBatch(); remix.addWater(1); cement(remix, 1); sand(remix, 1); remix.mix(100);
assert.equal(remix.mixProgress, 1); remix.addWater(.2); assert.equal(remix.mixProgress, 0); remix.mix(8); assert(remix.ready);
// Multiple batches reuse depleted stocks and preserve all earlier consumed mass.
for (let cycle = 0; cycle < 5; cycle++) {
  batch.addWater(MORTAR_RECIPE.waterLitres); cement(batch); sand(batch); batch.mix(8);
  while (batch.ready) batch.consumeKg(.7);
  conserve(batch);
}
// A bucket filled entirely with water can be emptied and rebuilt without restoring stocks.
const reset = new MortarBatch();
reset.addWater(20); reset.openSack(0); reset.scoopCement(0); reset.scoopSand();
assert.equal(reset.pour('trowel'), false); assert.equal(reset.pour('shovel'), false);
const beforeDiscard = reset.getState();
assert.equal(reset.discard(), 20); assert.equal(reset.massKg, 0); assert.equal(reset.mixProgress, 0); assert.equal(reset.quality, 'empty');
assert.equal(reset.getState().discardedKg, 20);
assert.deepEqual(reset.getState().heldTrowel, beforeDiscard.heldTrowel);
assert.deepEqual(reset.getState().heldShovel, beforeDiscard.heldShovel);
assert.deepEqual(reset.getState().sacks, beforeDiscard.sacks);
assert.equal(reset.getState().sandRemainingKg, beforeDiscard.sandRemainingKg);
assert.equal(reset.discard(), 0, 'Discarding empty bucket cannot duplicate waste');
conserve(reset);
reset.addWater(MORTAR_RECIPE.waterLitres); assert(reset.pour('trowel')); assert(reset.pour('shovel'));
cement(reset, 5); sand(reset, 11); reset.mix(8); assert.equal(reset.quality, 'balanced'); assert(reset.ready);
const finishedDiscard = reset.massKg;
near(reset.discard(), finishedDiscard, 'Finished mix can also be explicitly discarded');
near(reset.getState().discardedKg, 20 + finishedDiscard, 'Waste ledger accumulates exactly');
assert.equal(reset.mixProgress, 0); assert.equal(reset.ready, false); assert.equal(reset.consumeKg(1), 0); conserve(reset);
console.log(JSON.stringify({ passed: true, checks: ['sealed and independent sacks', 'retained tool payloads', 'full-bucket recipe', '8s mixing', 'overflow conservation', 'finite consumption', 'remix required', 'invalid input guards', 'snapshot isolation', 'partial source depletion', 'custom recipe feedback', 'repeated batch conservation', 'water-only discard and rebuild', 'discard preserves stocks and tool loads', 'finished mix discard ledger'] }));
