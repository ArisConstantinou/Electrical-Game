import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';

// Keep the original fracture implementation as an independent oracle. Compare
// actual repeated impacts, including every Float32 fragment vertex and saved edit.
const baselineRef = 'b9f5c77';
const output = 'output/masonry-impact-equivalence';
await mkdir(output, { recursive: true });
const baseline = execFileSync('git', ['show', `${baselineRef}:src/world/MasonryVolume.ts`], { encoding: 'utf8' });
await writeFile(`${output}/MasonryVolume.baseline.ts`, baseline.replace("'./masonryMesher'", "'/src/world/masonryMesher'"));
const server = await createServer({ server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom', logLevel: 'error' });
const clean = result => result && { ...result, stats: { ...result.stats, milliseconds: 0 } };
const summary = times => {
  const sorted = [...times].sort((a, b) => a - b);
  return { samples: times.length, medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.floor((sorted.length - 1) * .95)], totalMs: times.reduce((sum, value) => sum + value, 0) };
};
const report = { baselineRef, checks: ['exact impact results and fragment vertices', 'exact persistent edits and removed mass', 'exact deferred support results', 'exact mesher inputs'], cases: [] };
try {
  const { MasonryVolume: Before } = await server.ssrLoadModule(`/${output}/MasonryVolume.baseline.ts`);
  const { MasonryVolume: After } = await server.ssrLoadModule('/src/world/MasonryVolume.ts');
  const cases = [
    { name: 'flat-normal', angle: 0, chisel: 'flat', widthM: .05 },
    { name: 'flat-narrow', angle: 15, chisel: 'flat', widthM: .01 },
    { name: 'flat-prying', angle: 35, chisel: 'flat', widthM: .05 },
    { name: 'flat-upward-trim', angle: -45, chisel: 'flat', widthM: .05, trim: true },
    { name: 'pointed-oblique', angle: 55, chisel: 'pointed', widthM: .025 },
    { name: 'legacy-clay', angle: 35, chisel: 'flat', widthM: .05, options: { hollowProfile: 'legacy-rectangular' } },
    { name: 'rendered-clay', angle: 35, chisel: 'flat', widthM: .05, options: { renderThickness: .012 } },
    { name: 'concrete', angle: 0, chisel: 'pointed', widthM: .025, options: { material: 'concrete' } },
  ];
  for (const seed of [1234, 193187, 8721]) for (const specimen of cases) {
    const options = { seed, ...specimen.options };
    const before = new Before(options), after = new After(options), times = [[], []], lookups = [0, 0];
    for (const [index, wall] of [before, after].entries()) {
      const query = wall.nodeMaterial.bind(wall);
      wall.nodeMaterial = (...args) => { lookups[index]++; return query(...args); };
    }
    const a = specimen.angle * Math.PI / 180;
    const direction = { x: 0, y: -Math.sin(a), z: -Math.cos(a) };
    let fragments = 0;
    for (let blow = 0; blow < 16; blow++) {
      const entry = { x: .72 + blow * .006, y: 1.55 + Math.sin(blow * .6) * .008, z: before.frontZ };
      const origin = { x: entry.x, y: entry.y - direction.y * .3, z: entry.z - direction.z * .3 };
      const hit = before.raycast(origin, direction, .65);
      assert.deepStrictEqual(after.raycast(origin, direction, .65), hit);
      if (!hit) continue;
      const input = { point: hit.point, direction, edge: { x: 1, y: 0, z: 0 }, energyJ: 4, chisel: specimen.chisel, widthM: specimen.widthM, trim: specimen.trim && blow >= 5 };
      const results = [];
      // Alternate order to avoid consistently giving one implementation a warm CPU.
      for (const index of blow % 2 ? [1, 0] : [0, 1]) {
        results[index] = [before, after][index].impact(input);
        times[index].push(results[index].stats.milliseconds);
      }
      assert.deepStrictEqual(clean(results[1]), clean(results[0]), `${seed}/${specimen.name}/${blow}: impact changed`);
      fragments += results[1].fragments.length;
      assert.deepStrictEqual(after.serialize(), before.serialize(), `${seed}/${specimen.name}/${blow}: save changed`);
      if (blow % 4 === 3) {
        assert.deepStrictEqual(clean(after.processPendingSupport(12000)), clean(before.processPendingSupport(12000)));
      }
    }
    assert.deepStrictEqual(after.serialize(), before.serialize());
    const dirty = before.takeDirtyChunks();
    assert.deepStrictEqual(after.takeDirtyChunks(), dirty);
    for (const key of dirty) assert.deepStrictEqual(after.exportMeshJob(key), before.exportMeshJob(key));
    report.cases.push({ seed, name: specimen.name, fragments, baseline: summary(times[0]), current: summary(times[1]), nodeMaterialQueries: { baseline: lookups[0], current: lookups[1] } });
  }
  report.passed = true;
  report.total = {
    baselineMs: report.cases.reduce((sum, item) => sum + item.baseline.totalMs, 0),
    currentMs: report.cases.reduce((sum, item) => sum + item.current.totalMs, 0),
    baselineQueries: report.cases.reduce((sum, item) => sum + item.nodeMaterialQueries.baseline, 0),
    currentQueries: report.cases.reduce((sum, item) => sum + item.nodeMaterialQueries.current, 0),
  };
  console.log(JSON.stringify({ passed: report.passed, baselineRef, checks: report.checks, cases: report.cases.length, ...report.total }, null, 2));
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await server.close();
}
