import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom', logLevel: 'error' });
try {
  const { sprayGeometryPieces } = await server.ssrLoadModule('/src/systems/SprayGeometry.ts');
  const geometry = new THREE.PlaneGeometry(20, 20, 80, 16);
  geometry.clearGroups();
  geometry.addGroup(0, geometry.index.count / 2, 0);
  geometry.addGroup(geometry.index.count / 2, geometry.index.count / 2, 1);
  const material = [0, 1].map(() => new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const mesh = new THREE.Mesh(geometry, material), proxy = new THREE.Mesh();
  mesh.position.set(3, 4, -2); mesh.rotation.set(.2, .4, -.3); mesh.scale.set(1.2, .8, 1.1);
  mesh.updateMatrixWorld(true); proxy.matrixWorld.copy(mesh.matrixWorld); proxy.material = material;
  const ray = new THREE.Raycaster(), normal = new THREE.Vector3(0, 0, 1).transformDirection(mesh.matrixWorld);
  let comparisons = 0;
  const compare = () => {
    for (const [x, y] of [[.13, .23], [4.1, 5.2], [-8.2, -3.3], [12, 1]]) {
      const target = mesh.localToWorld(new THREE.Vector3(x, y, .15));
      ray.set(target.clone().addScaledVector(normal, 2), normal.clone().negate()); ray.far = 4;
      const full = []; mesh.raycast(ray, full); full.sort((a, b) => a.distance - b.distance);
      const accelerated = [];
      for (const piece of sprayGeometryPieces(geometry)) { proxy.geometry = piece; proxy.raycast(ray, accelerated); }
      accelerated.sort((a, b) => a.distance - b.distance);
      assert.equal(Boolean(accelerated.length), Boolean(full.length));
      if (full.length) {
        assert(accelerated[0].point.distanceTo(full[0].point) < 1e-8);
        assert(accelerated[0].uv.distanceTo(full[0].uv) < 1e-8);
        assert(accelerated[0].normal.distanceTo(full[0].normal) < 1e-8);
        assert.equal(accelerated[0].face.materialIndex, full[0].face.materialIndex);
      }
      comparisons++;
    }
  };
  compare();
  const cached = sprayGeometryPieces(geometry);
  assert.equal(sprayGeometryPieces(geometry), cached, 'Static geometry rebuilt its spatial pieces');
  geometry.setDrawRange(0, geometry.index.count / 2); compare();
  assert.notEqual(sprayGeometryPieces(geometry), cached, 'Changed draw range reused stale triangles');
  geometry.setDrawRange(0, Infinity);
  const positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) positions.setZ(i, .3);
  positions.needsUpdate = true; geometry.computeBoundingBox(); geometry.computeBoundingSphere(); compare();
  const interleaved = new THREE.InterleavedBuffer(new Float32Array(positions.array), 3);
  geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(interleaved, 3, 0));
  compare();
  console.log(JSON.stringify({ passed: true, rayComparisons: comparisons, cachedPieces: cached.length,
    checks: ['world transforms', 'UVs and materials', 'cache reuse', 'draw range', 'geometry updates', 'interleaved buffers'] }));
} finally { await server.close(); }
