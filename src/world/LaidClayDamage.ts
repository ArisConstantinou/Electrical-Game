import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type LaidClayWear = 'sound' | 'small-chip-a' | 'small-chip-b' | 'broken-corner';

function chippedOutline(kind: Exclude<LaidClayWear, 'sound'>): THREE.Shape {
  const shape = new THREE.Shape();
  // Handled clay breaks in short, uneven facets. The missing material stays
  // within the outer skin; a real brick has more clay behind the chip.
  const edge = kind === 'small-chip-a' ? [
    [-.5,-.5],[.5,-.5],[.5,.414],[.477,.424],[.466,.455],[.435,.468],[.412,.5],[-.5,.5],
  ] : kind === 'small-chip-b' ? [
    [-.432,-.5],[.5,-.5],[.5,.5],[-.5,.5],[-.5,-.402],[-.475,-.416],[-.462,-.461],
  ] : [
    [-.5,-.5],[.5,-.5],[.5,.5],[-.36,.5],[-.391,.468],[-.408,.43],[-.445,.404],[-.465,.35],[-.5,.333],
  ];
  shape.moveTo(edge[0][0], edge[0][1]);
  for (const [x, y] of edge.slice(1)) shape.lineTo(x, y);
  shape.closePath();
  return shape;
}

/** A shallow clay break with a solid clay core, shared by all wall instances.
 * The wall collider and mortar remain independent of this render geometry. */
export function laidClayGeometry(kind: LaidClayWear, alongX = true): THREE.BufferGeometry {
  const core = new THREE.BoxGeometry(1, 1, kind === 'sound' ? 1 : .894).toNonIndexed();
  if (kind === 'sound') {
    if (!alongX) core.rotateY(Math.PI / 2);
    return core;
  }
  const shape = chippedOutline(kind);
  const front = new THREE.ExtrudeGeometry(shape, { depth: .052, bevelEnabled: false, steps: 1 });
  front.translate(0, 0, .448);
  // The opposite face has its own small break, offset from the near face.
  const rear = new THREE.ExtrudeGeometry(shape, { depth: .052, bevelEnabled: false, steps: 1 });
  rear.rotateZ(Math.PI);
  rear.translate(0, 0, -.5);
  for (const face of [front, rear]) {
    const uv = face.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + .5, uv.getY(i) + .5);
    uv.needsUpdate = true;
    face.clearGroups();
  }
  const geometry = mergeGeometries([core, front, rear], false);
  core.dispose(); front.dispose(); rear.dispose();
  if (!geometry) throw new Error('Could not merge chipped clay geometry');
  geometry.clearGroups();
  if (!alongX) geometry.rotateY(Math.PI / 2);
  return geometry;
}
