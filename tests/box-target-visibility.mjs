import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as THREE from 'three';

execFileSync(process.execPath, [
  'node_modules/esbuild/bin/esbuild',
  'src/systems/BoxPlacementSystem.ts', 'src/electrical/InstallationPoint.ts',
  '--bundle', '--platform=node', '--format=esm', '--external:three',
  '--outdir=output/box-target-test', '--log-level=error',
]);
  const { InstallationPoint } = await import('../output/box-target-test/electrical/InstallationPoint.js');
  const { BoxPlacementSystem } = await import('../output/box-target-test/systems/BoxPlacementSystem.js');
  const frontZ = 0, points = [], scene = new THREE.Scene();
  // A small occupied wall surface keeps this targeting regression independent
  // from the full masonry field's memory-intensive construction.
  const wall = { volume: { raycast(origin, direction, maxDistance) {
    if (direction.z >= 0 || origin.z <= frontZ) return null;
    const distance = (frontZ - origin.z) / direction.z;
    return distance >= 0 && distance <= maxDistance
      ? { distance, point: { x: origin.x + direction.x * distance, y: origin.y + direction.y * distance, z: frontZ } }
      : null;
  } } };
  const system = new BoxPlacementSystem(wall, {}, points);
  const point = new InstallationPoint({ id: 'visibility', label: 'Visibility specimen', kind: 'socket', boxes: ['1G'], x: 0, bottom: 1.163 });
  point.boxGroup.visible = true;
  points.push(point); scene.add(point);
  const camera = new THREE.PerspectiveCamera(75, 1, .01, 10);
  camera.position.set(0, 1.2, frontZ + .42);
  camera.lookAt(0, 1.2, frontZ); camera.updateMatrixWorld(true);

  // A casing standing in front of masonry is available to the crosshair.
  point.position.z = frontZ + .08;
  assert(system.target(camera) === point, 'visible casing should be directly selectable');
  assert(system.targetNear(camera) === point, 'visible casing should remain selectable through fallback API');
  camera.lookAt(.08, 1.2, frontZ); camera.updateMatrixWorld(true);
  assert(system.target(camera) === null, 'off-centre casing should miss the exact crosshair');
  assert(system.targetNear(camera) === point, 'visible off-centre casing should use bounded fallback');
  camera.lookAt(0, 1.2, frontZ); camera.updateMatrixWorld(true);

  // Its mesh can still intersect the camera ray behind an intact wall. The
  // world surface must win over both exact and forgiving selection.
  point.position.z = frontZ - .18;
  assert(system.target(camera) === null, 'masonry must occlude exact casing hit');
  assert(system.targetNear(camera) === null, 'masonry must occlude fallback selection');
  console.log('Box target visibility: direct and fallback hits respect masonry occlusion.');
