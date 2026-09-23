import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { createDistributionBoardVisual } = await server.ssrLoadModule('/src/electrical/DistributionBoardVisual.ts');
  const board = createDistributionBoardVisual('first-fix');
  const cabinet = board.children.find(child => child.isMesh && child.material.color?.getHex() === 0xd9dfe0);
  assert(cabinet, 'The cabinet surface must remain a selectable rendered mesh');
  const positions = cabinet.geometry.getAttribute('position');
  const index = cabinet.geometry.getIndex();
  const vertex = n => index ? index.getX(n) : n;
  const point = n => {
    const i = vertex(n);
    return [positions.getX(i), positions.getY(i), positions.getZ(i)];
  };
  const cross = (a, b, x, z) => (b[0] - a[0]) * (z - a[2]) - (b[2] - a[2]) * (x - a[0]);
  function panelCovers(x, z) {
    for (let n = 0; n < (index?.count ?? positions.count); n += 3) {
      const a = point(n), b = point(n + 1), c = point(n + 2);
      if (![a, b, c].every(p => Math.abs(p[1] + .3865) < .0002)) continue;
      const sides = [cross(a, b, x, z), cross(b, c, x, z), cross(c, a, x, z)];
      if (sides.every(side => side >= -1e-8) || sides.every(side => side <= 1e-8)) return true;
    }
    return false;
  }
  // An actual cable pass must be open through the cabinet material, whereas
  // the strip between passes must still carry a solid bottom surface.
  assert.equal(panelCovers(-.15, -.039), false, 'Empty cable entry is an opening, not a black painted disc');
  assert.equal(panelCovers(-.1125, -.039), true, 'The cabinet remains solid between cable entries');
  assert.equal(board.userData.circuitDesignAssigned, false);
  console.log(JSON.stringify({ emptyEntryOpen: true, betweenEntriesSolid: true,
    sourceParts: board.userData.sourcePartCount, batchedMeshes: board.children.filter(child => child.isMesh).length }));
} finally {
  await server.close();
}
