import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import * as THREE from 'three';

// Paired material specimens receive the same finite blows. Only the physical
// approach direction changes; no render meshes, contact or damage are stubbed.
const diagnostic = process.argv.includes('--diagnostic');
const output = 'output/angled-fracture';
await mkdir(output, { recursive: true });
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
const report = { diagnostic, cases: [], comparisons: [], failures: [] };
const check = (condition, message) => { if (!condition) report.failures.push(message); };

function meshVolume(positions) {
  let volume = 0;
  for (let j = 0; j < positions.length; j += 9) {
    volume += (positions[j] * (positions[j + 4] * positions[j + 8] - positions[j + 5] * positions[j + 7])
      + positions[j + 1] * (positions[j + 5] * positions[j + 6] - positions[j + 3] * positions[j + 8])
      + positions[j + 2] * (positions[j + 3] * positions[j + 7] - positions[j + 4] * positions[j + 6])) / 6;
  }
  return Math.abs(volume);
}

try {
  const { MasonryVolume } = await server.ssrLoadModule('/src/world/MasonryVolume.ts');
  // Preserve the earlier explicit vertical profile's saved geometry contract.
  // Default horizontal extrusion is covered by horizontal-masonry-profile.mjs.
  const intact = new MasonryVolume({ seed: 1234, hollowProfile: 'rounded-five' });
  const pitchX = intact.width / 21, pitchY = intact.height / 23;
  const y = 10.5 * pitchY, startX = -intact.width / 2 + 10 * pitchX;
  const innerWidth = pitchX - .036, innerDepth = intact.depth - .03;
  const countAirRuns = samples => samples.reduce((count, material, index) => count + Number(material === 0 && (index === 0 || samples[index - 1] !== 0)), 0);
  const boreProfiles = [];
  for (const row of [0, 1]) {
    const depth = .015 + (row + .5) * innerDepth / 2;
    const materials = Array.from({ length: 280 }, (_, i) => intact.sampleMaterial(startX + .008 + i * (pitchX - .016) / 279, y, intact.frontZ - depth));
    const holes = countAirRuns(materials);
    boreProfiles.push({ row, depth, holes });
    check(holes === 5, `Depth row ${row}: intact brick must contain five separate bores`);
  }
  for (let hole = 0; hole < 5; hole++) {
    const x = startX + .018 + (hole + .5) * innerWidth / 5;
    const depthSamples = Array.from({ length: 180 }, (_, i) => intact.sampleMaterial(x, y, intact.frontZ - i * intact.depth / 179));
    check(countAirRuns(depthSamples.slice(2, -2)) === 2, `Bore ${hole}: expected two hollow rows through wall depth`);
    check(intact.sampleMaterial(x, y, intact.frontZ - .006) === 1, 'Visible broad brick side must retain an intact clay face');
    check(intact.sampleMaterial(x, y, intact.frontZ - intact.depth * .5) === 1, 'Hollow rows must retain their intervening clay partition');
  }
  report.geometry = { fiveHolesPerDepthRow: boreProfiles };
  check(intact.serialize().options.hollowProfile === 'rounded-five', 'New saves must explicitly identify their five-bore geometry');
  const legacy = new MasonryVolume({ seed: 1234, hollowProfile: 'legacy-rectangular' });
  for (let blow = 0; blow < 4; blow++) {
    const hit = legacy.raycast({ x: .72, y: 1.55, z: -2 }, { x: 0, y: 0, z: -1 }, .8);
    legacy.impact({ point: hit.point, direction: { x: 0, y: 0, z: -1 }, energyJ: 4, chisel: 'flat' });
  }
  const oldSave = legacy.serialize(); delete oldSave.options.hollowProfile;
  const restored = new MasonryVolume({ seed: 1234 }); restored.restore(oldSave);
  check(restored.options.hollowProfile === 'legacy-rectangular', 'Old saves without a geometry tag must retain their original rectangular chambers');
  check(restored.removedNodeCount === legacy.removedNodeCount && restored.removedVolume === legacy.removedVolume, 'Legacy save damage or removed-volume ledger changed on restoration');
  for (let x = .63; x <= .94; x += .017) for (let depth = .009; depth < legacy.depth; depth += .009) {
    check(restored.sampleMaterial(x, 1.55, restored.frontZ - depth) === legacy.sampleMaterial(x, 1.55, legacy.frontZ - depth), 'Legacy saved material geometry changed');
  }
  restored.restore(intact.serialize());
  check(restored.options.hollowProfile === 'rounded-five' && restored.removedNodeCount === 0, 'Restoring a tagged new save must reinstate its five-bore geometry');
  report.geometry.legacySaveRetained = true;
  // Exercise the production visible blade/contact provider without a browser.
  // The former upward sight-ray selection repeatedly chose a tangential front
  // corner which the actual tilted shaft could never hit after its first flake.
  const oldWindow = globalThis.window, oldWidth = globalThis.innerWidth, oldHeight = globalThis.innerHeight;
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  globalThis.innerWidth = 1366; globalThis.innerHeight = 768;
  try {
    const { FPSRig } = await server.ssrLoadModule('/src/player/FPSRig.ts');
    const volume = new MasonryVolume({ seed: 193187 });
    const wall = { volume, chiselType: 'flat', chiselTiltDegrees: -45, chiselWidthM: .05, chiselEdgeAngle: 0, chiselEnergyJ: 4 };
    const camera = new THREE.PerspectiveCamera(65, 1366 / 768, .01, 100);
    camera.position.set(.38, .7591673887931474, -1.641091270347399);
    camera.lookAt(.72, 1.019999991278025, volume.frontZ);
    const rig = new FPSRig(); camera.add(rig); rig.show('hammer');
    rig.workPositionLocked = true; rig.workStanceTiltDegrees = -45; rig.workHeadLeanM = -.34;
    const blows = [];
    for (let i = 0; i < 12; i++) {
      let contact = null;
      // Match Game's per-frame feed budget. Contact queries alone must not
      // advance the tool, otherwise multiple queries could feed it faster.
      for (let frame = 0; frame < 30; frame++) { rig.beginFrame(1 / 60); rig.update(1 / 60, false); contact = rig.contact(camera, wall); }
      check(Boolean(contact), `Upward visible blade lost its valid contact on blow ${i}`);
      if (!contact) continue;
      const result = volume.impact({ ...contact, trim: true });
      check(Boolean(result.contact), `Upward blade chose a sight-ray corner unreachable by its real shaft on blow ${i}`);
      blows.push({ physicalContact: Boolean(result.contact), removedCm3: result.removedVolume * 1e6 });
    }
    report.upwardPhysicalContact = blows;
    check(blows.filter(blow => blow.removedCm3 > 0).length >= 8, 'Repeated upward strokes must continue chipping the reachable lip while preserving the backing');
  } finally {
    globalThis.window = oldWindow; globalThis.innerWidth = oldWidth; globalThis.innerHeight = oldHeight;
  }
  for (const seed of [1234, 193187, 8721]) {
    for (const anchor of [{ x: .72, y: 1.55 }, { x: .83, y: 1.66 }]) {
      const group = [];
      for (const angle of [0, 35, -35, 55, -55]) {
        const wall = new MasonryVolume({ seed });
        const radians = angle * Math.PI / 180;
        const direction = { x: 0, y: Math.sin(radians), z: -Math.cos(radians) };
        const specimen = { seed, anchor, angle, blows: [], fragments: 0, smallChips: 0, largeFlakes: 0, largestSpanCm: 0, largestVolumeCm3: 0 };
        let emittedVolume = 0;
        for (let blow = 0; blow < 8; blow++) {
          const entry = { x: anchor.x + blow * .003, y: anchor.y, z: wall.frontZ };
          const origin = { x: entry.x - direction.x * .25, y: entry.y - direction.y * .25, z: entry.z - direction.z * .25 };
          const hit = wall.raycast(origin, direction, .65);
          check(Boolean(hit), `${seed}/${anchor.x}/${angle}: lost intact or remaining wall contact`);
          if (!hit) continue;
          const result = wall.impact({ point: hit.point, direction, edge: { x: 1, y: 0, z: 0 }, energyJ: 4, chisel: 'flat', widthM: .05 });
          const fragmentVolume = result.fragments.reduce((sum, fragment) => sum + fragment.volume, 0);
          check(Math.abs(fragmentVolume - result.removedVolume) < 1e-12, 'Impact fragment volume differs from removed solid');
          emittedVolume += fragmentVolume;
          for (const fragment of result.fragments) {
            check(fragment.positions?.length >= 9, 'Debris must carry actual removed triangles');
            if (fragment.positions) check(Math.abs(meshVolume(fragment.positions) - fragment.volume) < Math.max(1e-12, fragment.volume * .0001), 'Debris triangles do not preserve removed volume');
            const span = Math.max(fragment.size.x, fragment.size.y, fragment.size.z);
            specimen.fragments++;
            specimen.smallChips += Number(span <= .025);
            specimen.largeFlakes += Number(span >= .04 && fragment.volume >= .000008);
            specimen.largestSpanCm = Math.max(specimen.largestSpanCm, span * 100);
            specimen.largestVolumeCm3 = Math.max(specimen.largestVolumeCm3, fragment.volume * 1e6);
          }
          // A single exterior strike cannot simultaneously punch through the
          // disconnected rear shell across manufactured air chambers.
          if (blow === 0 && result.bounds) check(result.bounds.min.z > wall.frontZ - wall.depth * .5, 'First strike jumped a hollow chamber into deep backing');
          specimen.blows.push({ blow, removedCm3: result.removedVolume * 1e6, contactDepthMm: (wall.frontZ - hit.point.z) * 1000, cracks: result.cracks.length, detachedNodes: result.stats.detachedNodes });
        }
        specimen.removedCm3 = wall.removedVolume * 1e6;
        check(Math.abs(emittedVolume - wall.removedVolume) < 1e-10, 'Cumulative removed-solid ledger diverges from emitted debris');
        check(specimen.blows.filter(blow => blow.removedCm3 > 0).length >= 3, `${seed}/${anchor.x}/${angle}: damage does not progress across repeated blows`);
        group.push(specimen);
        report.cases.push(specimen);
      }
      const straight = group[0];
      for (const angled of group.slice(1)) {
        report.comparisons.push({ seed, anchor, angle: angled.angle, volumeRatio: angled.removedCm3 / straight.removedCm3, largestFragmentRatio: angled.largestVolumeCm3 / straight.largestVolumeCm3 });
      }
    }
  }
  const greater = report.comparisons.filter(pair => pair.volumeRatio > 1.05);
  const larger = report.comparisons.filter(pair => pair.largestFragmentRatio > 1.05);
  report.summary = { pairedCases: report.comparisons.length, greaterRemovalCases: greater.length, largerFragmentCases: larger.length, meanVolumeRatio: report.comparisons.reduce((sum, pair) => sum + pair.volumeRatio, 0) / report.comparisons.length };
  check(greater.length >= Math.ceil(report.comparisons.length * .75), 'Angled chiselling must remove more real material in most paired specimens');
  check(larger.length >= Math.ceil(report.comparisons.length * .6), 'Angled chiselling must usually release larger actual fragments');
  for (const angle of [35, -35, 55, -55]) {
    const specimens = report.cases.filter(item => item.angle === angle);
    check(specimens.some(item => item.largeFlakes > 0) && specimens.some(item => item.smallChips > 0), `${angle}: expected a mixture of shell flakes and fine chips`);
  }
  console.log(JSON.stringify({ ...report.summary, failures: report.failures }, null, 2));
  if (!diagnostic) assert.deepEqual(report.failures, []);
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await server.close();
}
