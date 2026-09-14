import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';

// Keep the original fracture implementation as an independent oracle. Compare
// actual repeated impacts, including every Float32 fragment vertex and saved edit.
// Coplanar caps can choose another fan start. Trace the independent generic
// clipper to compare complete polygon boundaries before any triangulation, then
// check the actual Float32 vertex sets, fragment bounds and physical state.
const baselineRef = 'b9f5c77';
const output = 'output/masonry-impact-equivalence';
await mkdir(output, { recursive: true });
const baseline = execFileSync('git', ['show', `${baselineRef}:src/world/MasonryVolume.ts`], { encoding: 'utf8' });
await writeFile(`${output}/MasonryVolume.baseline.ts`, baseline.replace("'./masonryMesher'", "'/src/world/masonryMesher'").replace("const poly = clippedTetra(tetra.map(i => points[i]), tetra.map(i => before[i]), tetra.map(i => after[i]));", "const poly = this.__traceRemovedTetra(tetra.map(i => points[i]), tetra.map(i => before[i]), tetra.map(i => after[i]));"));
const server = await createServer({ server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom', logLevel: 'error' });
const clean = result => result && { ...result, removedVolume: 0, fragments: result.fragments.map(fragment=>({...fragment,volume:0,positions:undefined})), stats: { ...result.stats, milliseconds: 0 } };
const faceKeys=faces=>faces.map(face=>[...new Set(face.map(p=>[p.x,p.y,p.z].map(v=>v.toFixed(11)).join(',')))].sort().join(';')).sort();
const vertices=positions=>[...new Set(Array.from({length:positions.length/3},(_,i)=>`${positions[i*3]},${positions[i*3+1]},${positions[i*3+2]}`))].sort();
const sameRemovedGeometry=(current,original,traceCurrent,traceOriginal,label)=>{
  assert.deepStrictEqual(traceCurrent,traceOriginal,`${label}: canonical tetra facet boundaries changed`);
  traceCurrent.length=traceOriginal.length=0;
  assert.deepStrictEqual(clean(current),clean(original),`${label}: impact state changed`);
  if(!current)return;
  assert(Math.abs(current.removedVolume-original.removedVolume)<1e-14,`${label}: removed mass changed`);
  for(let i=0;i<current.fragments.length;i++){
    const a=current.fragments[i],b=original.fragments[i];
    assert(Math.abs(a.volume-b.volume)<1e-14,`${label}: fragment mass changed`);
    assert.deepStrictEqual(vertices(a.positions),vertices(b.positions),`${label}: actual Float32 fragment vertices changed`);
  }
};
const summary = times => {
  const sorted = [...times].sort((a, b) => a - b);
  return { samples: times.length, medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.floor((sorted.length - 1) * .95)], totalMs: times.reduce((sum, value) => sum + value, 0) };
};
const report = { baselineRef, checks: ['exact impact state, canonical clipped facet boundaries and Float32 fragment vertex sets', 'exact persistent edits; removed mass within 1e-14 m3', 'exact deferred support results', 'exact mesher inputs'], cases: [] };
try {
  const { MasonryVolume: Before } = await server.ssrLoadModule(`/${output}/MasonryVolume.baseline.ts`);
  const { MasonryVolume: After } = await server.ssrLoadModule('/src/world/MasonryVolume.ts');
  const { clippedTetra } = await server.ssrLoadModule('/src/world/masonryMesher.ts');
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
    // This historical CPU oracle compares the original vertical profile;
    // horizontal-rounded has its own geometry/save/mesh acceptance test.
    const options = { seed, hollowProfile: 'rounded-five', ...specimen.options };
    const before = new Before(options), after = new After(options), times = [[], []], lookups = [0, 0];
    const traces=[[],[]],currentClip=after.clipRemovedTetra;
    before.__traceRemovedTetra=(...args)=>{const poly=clippedTetra(...args);traces[0].push(faceKeys(poly.faces));return poly;};
    after.clipRemovedTetra=(...args)=>{const poly=currentClip(...args);traces[1].push(faceKeys(poly.faces));return poly;};
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
      sameRemovedGeometry(results[1],results[0],traces[1],traces[0],`${seed}/${specimen.name}/${blow}`);
      fragments += results[1].fragments.length;
      assert.deepStrictEqual({...after.serialize(),removedVolume:0}, {...before.serialize(),removedVolume:0}, `${seed}/${specimen.name}/${blow}: save changed`);
      if (blow % 4 === 3) {
        sameRemovedGeometry(after.processPendingSupport(12000),before.processPendingSupport(12000),traces[1],traces[0],`${seed}/${specimen.name}/${blow}: support`);
      }
    }
    assert.deepStrictEqual({...after.serialize(),removedVolume:0}, {...before.serialize(),removedVolume:0});
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
