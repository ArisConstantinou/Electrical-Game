import assert from 'node:assert/strict';
import { createServer } from 'vite';
import * as THREE from 'three';

const server = await createServer({ server: { middlewareMode: true, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom', logLevel: 'error' });
try {
  const { ElectricalBox } = await server.ssrLoadModule('/src/electrical/Box.ts');
  for (const kind of ['1G', '2G']) {
    const box = new ElectricalBox(kind, `test:${kind}`);
    box.updateMatrixWorld(true);
    const back = box.getObjectByName('Moulded box back with open cable entries');
    assert(back?.isMesh, `${kind}: molded back panel missing`);
    const aim = (x, y) => {
      const ray = new THREE.Raycaster(new THREE.Vector3(x, y, -box.depth + .017), new THREE.Vector3(0, 0, -1), 0, .025);
      return ray.intersectObject(back, false).length;
    };
    const entries = kind === '2G' ? [-box.width * .25, box.width * .25] : [0];
    assert.equal(back.userData.cableEntryCount, entries.length);
    for (const x of entries) assert.equal(aim(x, -box.height * .22), 0, `${kind}: cable path must be an open hole`);
    assert(aim(0, .012) > 0, `${kind}: solid center of the rear shell must remain`);
    assert(box.getObjectByName('Moulded electrical box bosses and ribs'));
    assert(box.getObjectByName('Electrical box fitting screws'));
    console.log(`${kind}: ${entries.length} open cable entries, ${back.geometry.getAttribute('position').count / 3} back-panel triangles, retained screw mounts`);
  }
} finally { await server.close(); }
