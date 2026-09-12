import * as THREE from 'three';
import { GAME_CONFIG } from '../data/gameConfig';

/** Presentation stance around the aimed wall point; never accumulates into walking. */
export class HammerWorkStance {
  sideDegrees = 0;
  private applied = false;
  private readonly base = new THREE.Vector3();
  private readonly presented = new THREE.Vector3();
  readonly offset = new THREE.Vector3();

  restore(camera: THREE.Camera): void {
    // Studio/QA may deliberately reposition the camera between frames.
    if (this.applied && camera.position.distanceToSquared(this.presented) < 1e-10) camera.position.copy(this.base);
    this.applied = false;
  }

  update(camera: THREE.Camera, dt: number, requestedSide: number, enabled: boolean): void {
    this.base.copy(camera.position);
    this.offset.set(0, 0, 0);
    const view = camera.getWorldDirection(new THREE.Vector3());
    const distance = (GAME_CONFIG.room.wallFrontZ - this.base.z) / view.z;
    const focus = this.base.clone().addScaledVector(view, distance);
    const workingAtWall = view.z < -.15 && distance > 0 && distance <= 2.35 && Math.abs(focus.x) <= 2.54 && focus.y >= 0 && focus.y <= 3;
    const target = enabled && workingAtWall ? requestedSide : 0;
    this.sideDegrees = THREE.MathUtils.damp(this.sideDegrees, target, 10, Math.min(dt, .05));
    if (Math.abs(this.sideDegrees - target) < .01) this.sideDegrees = target;
    if (Math.abs(this.sideDegrees) < .001 || !workingAtWall) return;
    // Move the eye to the handle side and turn toward the SAME work point.
    // Keep the horizon level. The torso/arms follow this shared view in FPSRig.
    const angle = THREE.MathUtils.degToRad(-this.sideDegrees * .70);
    const orbit = this.base.clone().sub(focus).applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    orbit.multiplyScalar(1 + Math.min(.35, Math.max(0, 2.15 / orbit.length() - 1)) * Math.abs(this.sideDegrees / 75));
    camera.position.copy(focus).add(orbit);
    camera.position.y -= .08 * Math.abs(this.sideDegrees / 75);
    const radius = GAME_CONFIG.player.radius;
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, -GAME_CONFIG.room.width / 2 + radius, GAME_CONFIG.room.width / 2 - radius);
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, GAME_CONFIG.room.wallFrontZ + .32, GAME_CONFIG.room.depth / 2 - radius);
    camera.lookAt(focus);
    camera.updateMatrixWorld(true);
    this.offset.copy(camera.position).sub(this.base);
    this.presented.copy(camera.position);
    this.applied = true;
  }
}
