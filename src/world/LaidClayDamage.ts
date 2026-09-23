import * as THREE from 'three';

/** Reusable fired-clay shapes for the occasional handling chip in laid walls.
 * The backing remains the actual wall collider; these cuts affect render only. */
export function laidClayGeometry(kind: 'sound' | 'small-chip' | 'broken-corner'): THREE.BufferGeometry {
  if (kind === 'sound') return new THREE.BoxGeometry(1, 1, 1);
  // Extrude the trimmed outline through the block. The fifth side is the
  // exposed clay break; moving box vertices would leave an open black slot.
  const shape = new THREE.Shape();
  if (kind === 'small-chip') {
    shape.moveTo(-.5, -.5); shape.lineTo(.5, -.5);
    shape.lineTo(.5, .46); shape.lineTo(.465, .5); shape.lineTo(-.5, .5);
  } else {
    shape.moveTo(-.45, -.5); shape.lineTo(.5, -.5);
    shape.lineTo(.5, .5); shape.lineTo(-.5, .5); shape.lineTo(-.5, -.425);
  }
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, steps: 1 });
  geometry.translate(0, 0, -.5);
  // ExtrudeGeometry assigns its side faces to material slot 1 by default.
  // This instanced wall uses one clay material; leave no unbound grey slot.
  geometry.clearGroups();
  geometry.addGroup(0, geometry.getAttribute('position').count, 0);
  const uvs = geometry.getAttribute('uv');
  for (let i = 0; i < uvs.count; i++) uvs.setXY(i, uvs.getX(i) + .5, uvs.getY(i) + .5);
  uvs.needsUpdate = true;
  return geometry;
}
