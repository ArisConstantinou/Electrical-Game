import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const report = [];
// Independent oracle: use the tetrahedral mesh's real material edges and actual
// wall boundaries, never the impact algorithm's local search-box anchors.
const edges = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],
  [1,1,0],[-1,-1,0],[1,0,1],[-1,0,-1],[0,1,1],[0,-1,-1],[1,1,1],[-1,-1,-1]];
try {
  const { MasonryVolume } = await server.ssrLoadModule('/src/world/MasonryVolume.ts');
  for (const degrees of [-35, 0, 35]) {
    const volume = new MasonryVolume({ seed: 193187, maxConnectivityNodes: 512 });
    const direction = { x: Math.sin(degrees * Math.PI / 180), y: 0, z: -Math.cos(degrees * Math.PI / 180) };
    let releasedVolume = 0, supportSteps = 0, contacts = 0;
    const account = result => {
      assert(result.fragments.every(fragment => fragment.positions?.length && fragment.volume > 0), 'Released material has real triangles and positive mass');
      assert(Math.abs(result.fragments.reduce((sum, fragment) => sum + fragment.volume, 0) - result.removedVolume) < 1e-12);
      releasedVolume += result.removedVolume;
    };
    for (let i = 0; i < 48; i++) {
      const x = degrees < 0 ? .4 - Math.floor(i / 6) * .055 : -.4 + Math.floor(i / 6) * .055;
      const hit = volume.raycast({ x: x - direction.x * .3, y: 1.5, z: volume.frontZ - direction.z * .3 }, direction, .7);
      if (!hit) continue; // A newly opened bore can lie between successive real contacts.
      contacts++;
      account(volume.impact({ point: hit.point, direction, edge: { x: 0, y: 1, z: 0 }, chisel: 'flat', widthM: .05, energyJ: 4 }));
      while (volume.pendingSupportCount) {
        assert(++supportSteps < 10000, 'Deferred connectivity work must finish');
        account(volume.processPendingSupport(512));
      }
    }
    assert(contacts >= 32, 'Moving blows keep finding real material to break');
    assert(volume.removedNodeCount > 500, 'Real repeated attacks excavate the wall');
    assert(Math.abs(releasedVolume - volume.removedVolume) < 1e-12, 'All synchronous and deferred fragments preserve the volume ledger');
    const idOf = (x, y, z) => x + (volume.nx + 2) * (y + (volume.ny + 2) * z);
    const anchored = new Set();
    let testedStarts = 0, visitedNodes = 0;
    for (const chunk of volume.serialize().chunks) {
      const [tx, ty] = chunk.key.split(',').map(Number);
      for (const [offset, , removed] of chunk.edits) {
        if (!removed) continue;
        const z = offset % (volume.nz + 2), xy = Math.floor(offset / (volume.nz + 2));
        const x = tx * volume.tileSize + xy % volume.tileSize, y = ty * volume.tileSize + Math.floor(xy / volume.tileSize);
        for (const edge of edges) {
          const start = { x: x + edge[0], y: y + edge[1], z: z + edge[2] };
          const id = idOf(start.x, start.y, start.z);
          if (anchored.has(id) || !volume.nodeMaterial(start.x, start.y, start.z)) continue;
          testedStarts++;
          const queue = [start], seen = new Set([id]); let supported = false;
          for (let head = 0; head < queue.length; head++) {
            const node = queue[head]; visitedNodes++;
            if (node.z === volume.nz || node.x <= 1 || node.x >= volume.nx || node.y <= 1) { supported = true; break; }
            for (const edge of edges) {
              const x = node.x + edge[0], y = node.y + edge[1], z = node.z + edge[2], id = idOf(x, y, z);
              if (anchored.has(id)) { supported = true; break; }
              if (seen.has(id) || !volume.nodeMaterial(x, y, z)) continue;
              seen.add(id); queue.push({ x, y, z });
            }
            if (supported) break;
          }
          assert(supported, `Unattached ${queue.length}-node island survived ${degrees} degree moving blows at ${JSON.stringify(start)}`);
          for (const id of seen) anchored.add(id);
        }
      }
    }
    report.push({ degrees, contacts, removedNodes: volume.removedNodeCount, detachedNodes: volume.detachedNodeCount, supportSteps, testedStarts, visitedNodes, unsupported: 0 });
  }
  console.log(JSON.stringify({ pass: true, scenarios: report }, null, 2));
} finally { await server.close(); }
