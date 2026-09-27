import * as THREE from 'three';

/** Stable facade coordinates; a newly exposed brick face does not move it. */
export interface WallWorkPlane { point: THREE.Vector3; normal: THREE.Vector3 }

export function wallWorkTangent(normal: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3(0, 1, 0).cross(normal).normalize();
}

export function wallWorkDirection(normal: THREE.Vector3, sideDegrees: number, tiltDegrees: number): THREE.Vector3 {
  const side = THREE.MathUtils.degToRad(sideDegrees), tilt = THREE.MathUtils.degToRad(tiltDegrees);
  return wallWorkTangent(normal).multiplyScalar(Math.sin(side) * Math.cos(tilt))
    .addScaledVector(normal, -Math.cos(side) * Math.cos(tilt)).add(new THREE.Vector3(0, -Math.sin(tilt), 0));
}
