import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';

const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
const report = { specimens: [], hollow: [], checks: [] };
try {
  const { MasonryVolume, MaterialId } = await server.ssrLoadModule('/src/world/MasonryVolume.ts');
  const edits = volume => {
    const map = new Map();
    for (const chunk of volume.serialize().chunks) {
      const [tx, ty] = chunk.key.split(',').map(Number);
      for (const [offset, damage, removed] of chunk.edits) {
        const z = offset % (volume.nz + 2), xy = Math.floor(offset / (volume.nz + 2));
        const x = tx * volume.tileSize + xy % volume.tileSize, y = ty * volume.tileSize + Math.floor(xy / volume.tileSize);
        map.set(`${x},${y},${z}`, { damage, removed, p: volume.nodePosition(x, y, z) });
      }
    }
    return map;
  };
  const direction = { x: 0, y: 0, z: -1 }, horizontal = { x: 1, y: 0, z: 0 }, vertical = { x: 0, y: 1, z: 0 };
  function strike(volume, x, y, widthM, edge = horizontal, chisel = 'flat', trim = false) {
    const hit = volume.raycast({ x, y, z: volume.frontZ + .2 }, direction, .6);
    assert(hit, 'Fixture retains a real surface, including after the front shell opens');
    const result = volume.impact({ point: hit.point, direction: trim ? { x: 0, y: Math.SQRT1_2, z: -Math.SQRT1_2 } : direction, edge, widthM, chisel, trim, energyJ: 4 });
    assert(Math.abs(result.fragments.reduce((sum, f) => sum + f.volume, 0) - result.removedVolume) < 1e-12, 'Larger chunks still account for exactly the removed material');
    for (const fragment of result.fragments) {
      const p = fragment.positions; assert(p?.length, 'Every fragment must carry its actual removed-material mesh');
      let geometricVolume = 0;
      for (let j = 0; j < p.length; j += 9) geometricVolume += (p[j] * (p[j + 4] * p[j + 8] - p[j + 5] * p[j + 7]) + p[j + 1] * (p[j + 5] * p[j + 6] - p[j + 3] * p[j + 8]) + p[j + 2] * (p[j + 3] * p[j + 7] - p[j + 4] * p[j + 6])) / 6;
      assert(Math.abs(Math.abs(geometricVolume) - fragment.volume) < Math.max(1e-12, fragment.volume * .0001), 'Chunk geometry volume must equal its true mass volume');
    }
    return result;
  }
  function specimen(seed, widthM, edge = horizontal, chisel = 'flat', legacyGroups = false) {
    const v = new MasonryVolume({ width: 1, height: 1, depth: .18, seed, solidMaterial: MaterialId.Clay });
    if (legacyGroups) {
      const aggregate = v.aggregateFragments;
      v.aggregateFragments = function(removed, result) { aggregate.call(this, removed, result, 10); };
    }
    const fragments = [];
    for (let i = 0; i < 3; i++) fragments.push(...strike(v, 0, .5, widthM, edge, chisel).fragments);
    const nodes = [...edits(v).values()].filter(n => n.removed);
    const squareX = nodes.reduce((sum, n) => sum + n.p.x ** 2, 0) / nodes.length;
    const squareY = nodes.reduce((sum, n) => sum + (n.p.y - .5) ** 2, 0) / nodes.length;
    const minZ = Math.min(...nodes.map(n => n.p.z));
    // This is a true removed lattice volume, not a bigger decal or debris scale.
    return { v, nodes, volumeCm3: v.removedVolume * 1e6, squareX, squareY, minZ, meanFragmentCm3: v.removedVolume * 1e6 / fragments.length, maxFragmentCm3: Math.max(...fragments.map(f => f.volume * 1e6)) };
  }
  for (const seed of [44, 1234, 193187, 2026]) {
    const narrow = specimen(seed, .01), middle = specimen(seed, .04), wide = specimen(seed, .05);
    assert(middle.volumeCm3 > narrow.volumeCm3 * 1.1, '40 mm must remove meaningfully more material than 10 mm at equal blows and energy');
    assert(wide.volumeCm3 > narrow.volumeCm3 * 1.2, '50 mm must remove meaningfully more material than 10 mm at equal blows and energy');
    assert.equal(wide.minZ, narrow.minZ, 'The larger edge does not increase the depth of this controlled solid-shell cut');
    assert(wide.maxFragmentCm3 > narrow.maxFragmentCm3 * 2, 'A wide blade must release larger actual connected chunks, not merely more small particles');
    assert(wide.meanFragmentCm3 > narrow.meanFragmentCm3 * 1.5, 'The average real debris fragment must also grow with blade width');
    for (const current of [narrow, wide]) {
      const legacy = specimen(seed, current === narrow ? .01 : .05, horizontal, 'flat', true);
      assert.deepEqual(current.v.serialize().chunks, legacy.v.serialize().chunks, 'Grouping into larger connected fragments cannot cause extra wall destruction');
      assert(Math.abs(current.volumeCm3 - legacy.volumeCm3) < 1e-8, 'Larger debris grouping must preserve the total before-minus-after removed volume');
    }
    const turned = specimen(seed, .05, vertical);
    assert(wide.squareX > wide.squareY, 'Horizontal blade footprint must be elongated horizontally');
    assert(turned.squareY > turned.squareX, 'Rotating only the cutting edge must rotate the actual removed footprint');
    report.specimens.push({ seed, narrowCm3: narrow.volumeCm3, middleCm3: middle.volumeCm3, wideCm3: wide.volumeCm3, ratio: wide.volumeCm3 / narrow.volumeCm3, maxFragmentCm3: { narrow: narrow.maxFragmentCm3, wide: wide.maxFragmentCm3 }, meanFragmentCm3: { narrow: narrow.meanFragmentCm3, wide: wide.meanFragmentCm3 }, depthMm: (wide.v.frontZ - wide.minZ) * 1000, horizontalSpread: [Math.sqrt(wide.squareX), Math.sqrt(wide.squareY)], verticalSpread: [Math.sqrt(turned.squareX), Math.sqrt(turned.squareY)] });
  }
  for (const [given, expected] of [[undefined, .025], [NaN, .025], [Infinity, .025], [-1, .01], [2, .05]]) {
    assert.deepEqual(specimen(44, given).v.serialize(), specimen(44, expected).v.serialize(), 'Missing, invalid and out-of-range widths must have deterministic safe defaults/clamps');
  }
  assert.deepEqual(specimen(44, .01, horizontal, 'pointed').v.serialize(), specimen(44, .05, horizontal, 'pointed').v.serialize(), 'Flat width must not alter a pointed chisel');
  report.checks.push('10/40/50 mm equal-energy removed volume', 'blade-oriented real footprint', 'unchanged solid-shell depth', 'safe defaults and clamps', 'pointed geometry unchanged', 'fragment mass conservation', 'larger mean and maximum actual fragment geometry', 'fragment grouping preserves original destruction and total volume');
  for (const seed of [44, 1234, 193187, 2026]) {
    const rows = [];
    for (const widthM of [.01, .05]) {
      const v = new MasonryVolume({ seed });
      const rear = v.sampleMaterial(.8, 1.55, v.frontZ - .175);
      for (let i = 0; i < 5; i++) strike(v, .8 + Math.sin(i) * .007, 1.55 + Math.cos(i) * .007, widthM);
      assert.equal(v.sampleMaterial(.8, 1.55, v.frontZ - .175), rear, 'A wide edge cannot teleport damage to a hidden rear shell');
      rows.push(v.removedVolume * 1e6);
    }
    report.hollow.push({ seed, narrowCm3: rows[0], wideCm3: rows[1] });
  }
  assert(report.hollow.reduce((sum, row) => sum + row.wideCm3, 0) > report.hollow.reduce((sum, row) => sum + row.narrowCm3, 0) * 1.15, 'Wider blade must improve actual hollow masonry removal across grain seeds');
  report.checks.push('hollow clay removal across seeds', 'rear shell remains protected');

  // Open a cavity normally, then use the maximum-width upward finishing stroke.
  // Deferred connectivity is deliberately constrained to test its backing guard too.
  const trim = new MasonryVolume({ seed: 193187, maxConnectivityNodes: 16 });
  const drain = v => { let n = 0; while (v.pendingSupportCount && n++ < 3000) v.processPendingSupport(128); assert.equal(v.pendingSupportCount, 0); };
  for (let i = 0; i < 12; i++) strike(trim, .8 + Math.sin(i * 2.4) * .043, 1.55 + Math.cos(i * 2.4) * .043, .025);
  drain(trim);
  const before = edits(trim);
  strike(trim, .792, 1.542, .05, horizontal, 'flat', true);
  assert(trim.trimmingState, 'The exposed cavity must establish an upward finishing floor');
  const floor = trim.trimmingState.floorZ;
  for (let i = 0; i < 40; i++) {
    strike(trim, .792, 1.542, .05, horizontal, 'flat', true);
    assert.equal(trim.trimmingState.floorZ, floor, 'Wider finishing must not ratchet the existing backing deeper');
  }
  drain(trim);
  let newRemoved = 0;
  for (const [key, n] of edits(trim)) {
    const old = before.get(key);
    if (n.damage === (old?.damage ?? 0) && n.removed === (old?.removed ?? 0)) continue;
    assert(n.p.z > floor + trim.hz + 1e-9, 'Maximum-width trimming and deferred detachment cannot weaken or remove the protected depth');
    if (n.removed && !old?.removed) newRemoved++;
  }
  assert(newRemoved > 30, 'Wide finishing must actually remove protrusions');
  report.trim = { widthMm: 50, removedNodes: newRemoved, preservedDepthMm: (trim.frontZ - floor) * 1000 };
  report.checks.push('50 mm upward finishing removes protrusions', '40 finishing hits and deferred support preserve backing');
} finally { await server.close(); }
await mkdir('output/chisel-width-physics', { recursive: true });
await writeFile('output/chisel-width-physics/report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
