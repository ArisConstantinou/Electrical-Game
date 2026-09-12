import * as THREE from 'three';
import { createServer } from 'vite';

const context = {
  save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, arc() {}, clearRect() {},
  globalAlpha: 1,
  globalCompositeOperation: 'source-over',
  fillStyle: '#000000',
  strokeStyle: '#000000',
  lineCap: 'butt',
  lineJoin: 'miter',
  lineWidth: 1,
};

globalThis.document = {
  createElement(tag) {
    if (tag !== 'canvas') throw new Error(`Unexpected element request: ${tag}`);
    return { width: 0, height: 0, getContext: type => type === '2d' ? context : null };
  },
};

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { BrickWall } = await server.ssrLoadModule('/src/world/BrickWall.ts');
  const { ChasingSystem } = await server.ssrLoadModule('/src/systems/ChasingSystem.ts');
  const wall = new BrickWall([]);
  const scene = new THREE.Scene();
  scene.add(wall);
  const chasing = new ChasingSystem(scene, wall);
  wall.updateMatrixWorld(true);
  const target = wall.targets.find(item => Math.abs(item.center.x) < 0.2 && Math.abs(item.center.y - 1.5) < 0.15);
  if (!target) throw new Error('Could not resolve the deterministic demolition target');

  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.02, 50);
  camera.position.set(target.center.x, target.center.y, -0.35);
  camera.lookAt(target.center);
  camera.updateMatrixWorld(true);

  const kinds = [];
  const fragmentCounts = [];
  for (let hit = 0; hit < 6; hit += 1) {
    camera.lookAt(target.center);
    camera.updateMatrixWorld(true);
    const impact = chasing.freeHit(camera, hit > 0);
    if (!impact) throw new Error(`Demolition impact ${hit + 1} missed the retained wall`);
    kinds.push(impact.kind);
    fragmentCounts.push(chasing.activeFragmentCount);
  }

  const seam = target.cracks?.children.find(child => child.name.startsWith('Open split'));
  const result = {
    kinds,
    fragmentCounts,
    splitFragmentDelta: fragmentCounts[5] - fragmentCounts[4],
    damage: target.damage,
    impactCount: target.impactCount,
    destroyed: target.destroyed,
    splitBricks: wall.splitBrickCount,
    maximumDemolitionStrikes: wall.maximumDemolitionStrikeCount,
    maximumDepthMm: Number(wall.maximumDemolitionDepthMm.toFixed(1)),
    breachedCells: wall.breachedWallCellCount,
    fractureSegments: wall.fractureSegmentCount,
    fractureWidthMm: Number(wall.maximumFractureWidthMm.toFixed(3)),
    hasOpenSplit: Boolean(seam),
    visiblySplit: Boolean(target.cracks?.userData.visiblySplit),
  };

  if (kinds.join(',') !== 'demolish-chip,demolish-crack,demolish-spall,demolish-spall,demolish-spall,demolish-split') throw new Error(`Wrong cumulative damage stages: ${JSON.stringify(result)}`);
  if (result.damage !== 4 || result.impactCount !== 6 || result.destroyed || result.splitBricks !== 1 || result.maximumDemolitionStrikes !== 6) throw new Error(`The sixth strike did not retain and split the bonded brick: ${JSON.stringify(result)}`);
  if (result.splitFragmentDelta < 8 || result.splitFragmentDelta > 14) throw new Error(`The split did not detach a bounded set of medium fragments: ${JSON.stringify(result)}`);
  if (!result.hasOpenSplit || !result.visiblySplit || result.fractureSegments < 4 || result.fractureWidthMm < 1 || result.fractureWidthMm > 1.8) throw new Error(`The retained brick did not expose a bounded open split: ${JSON.stringify(result)}`);
  if (result.breachedCells !== 0 || result.maximumDepthMm >= 165) throw new Error(`The split incorrectly became an immediate through-hole: ${JSON.stringify(result)}`);
  console.log(JSON.stringify(result));
} finally {
  await server.close();
}
