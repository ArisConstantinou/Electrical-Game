import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { MasonryVolume } = await server.ssrLoadModule('/src/world/MasonryVolume.ts');
  const report = [];
  for (const seed of [1234, 193187, 8721]) {
    const wall = new MasonryVolume({ seed });
    const fragments = [];
    for (let i = 0; i < 40; i++) {
      const x = .72 + i * .003, y = 1.55 + Math.sin(i * .6) * .008;
      const hit = wall.raycast({ x, y, z: -2 }, { x: 0, y: 0, z: -1 }, .8);
      if (!hit) continue;
      const result = wall.impact({ point: hit.point, direction: { x: 0, y: 0, z: -1 }, edge: { x: 1, y: 0, z: 0 }, chisel: 'flat', widthM: .05, energyJ: 4 });
      assert(Math.abs(result.fragments.reduce((sum, f) => sum + f.volume, 0) - result.removedVolume) < 1e-12);
      for (const fragment of result.fragments) {
        const p = fragment.positions;
        let signedVolume = 0;
        for (let j = 0; j < p.length; j += 9) {
          signedVolume += (p[j] * (p[j + 4] * p[j + 8] - p[j + 5] * p[j + 7]) + p[j + 1] * (p[j + 5] * p[j + 6] - p[j + 3] * p[j + 8]) + p[j + 2] * (p[j + 3] * p[j + 7] - p[j + 4] * p[j + 6])) / 6;
        }
        assert(Math.abs(Math.abs(signedVolume) - fragment.volume) < Math.max(1e-12, fragment.volume * .0001), 'Larger debris must retain its exact removed-solid geometry and mass');
        fragments.push({ span: Math.max(fragment.size.x, fragment.size.y, fragment.size.z), volume: fragment.volume });
      }
    }
    const large = fragments.filter(f => f.span >= .04 && f.volume >= .000008);
    const small = fragments.filter(f => f.span <= .025);
    assert(large.length >= 3, 'A sustained 5 cm chisel pass must visibly release several larger shell flakes');
    assert(small.length >= 3, 'Fine chips must remain alongside larger flakes');
    assert(Math.abs(fragments.reduce((sum, f) => sum + f.volume, 0) - wall.removedVolume) < 1e-10, 'No debris mass may be added or discarded');
    report.push({ seed, fragments: fragments.length, largeFlakes: large.length, smallChips: small.length, largestSpanCm: Math.max(...fragments.map(f => f.span)) * 100, removedCm3: wall.removedVolume * 1e6 });
  }
  console.log(JSON.stringify({ passed: true, checks: ['mixed visible fragment sizes', 'exact fragment mesh volume', 'total removed mass preserved'], cases: report }, null, 2));
} finally {
  await server.close();
}
