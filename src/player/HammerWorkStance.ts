import * as THREE from 'three';
import { GAME_CONFIG } from '../data/gameConfig';

/** Presentation stance around the aimed wall point; never accumulates into walking. */
export class HammerWorkStance {
  sideDegrees = 0;
  actualTiltDegrees = 15;
  headLeanM = 0;
  private applied = false;
  private readonly base = new THREE.Vector3();
  private readonly presented = new THREE.Vector3();
  private readonly settledOffset = new THREE.Vector3();
  readonly offset = new THREE.Vector3();

  restore(camera: THREE.Camera): void {
    // Studio/QA may deliberately reposition the camera between frames.
    if (this.applied && camera.position.distanceToSquared(this.presented) < 1e-10) camera.position.copy(this.base);
    this.applied = false;
  }

  update(camera: THREE.Camera, dt: number, requestedSide: number, enabled: boolean, requestedTiltDegrees = 0, tool = 'hammer'): void {
    this.base.copy(camera.position);
    this.offset.set(0, 0, 0);
    const view = camera.getWorldDirection(new THREE.Vector3());
    const distance = (GAME_CONFIG.room.wallFrontZ - this.base.z) / view.z;
    const focus = this.base.clone().addScaledVector(view, distance);
    const workingAtWall = view.z < -.15 && distance > 0 && this.base.z-GAME_CONFIG.room.wallFrontZ <= 1.12 && Math.abs(focus.x) <= 2.54 && focus.y >= 0 && focus.y <= 3;
    const hammerWork = enabled && workingAtWall && tool === 'hammer';
    // Side adjustment is relative to the worker's aim. Keeping it fixed to
    // the wall normal twisted the motor away from the body in oblique views.
    const viewSide=THREE.MathUtils.radToDeg(Math.atan2(view.x,-view.z));
    const target = hammerWork ? THREE.MathUtils.clamp(requestedSide+viewSide,-65,65) : 0;
    this.sideDegrees = THREE.MathUtils.damp(this.sideDegrees, target, 10, Math.min(dt, .05));
    if (Math.abs(this.sideDegrees - target) < .01) this.sideDegrees = target;
    if (!hammerWork) {
      this.headLeanM = 0;
      // Tool changes and crossing the wall-facing boundary release the head
      // continuously; a one-frame reset used to feel like aim snapping.
      this.settledOffset.multiplyScalar(Math.exp(-12*Math.min(dt,.05)));
      if(this.settledOffset.lengthSq()<1e-10)this.settledOffset.set(0,0,0);
      camera.position.copy(this.base).add(this.settledOffset);
      if(workingAtWall)camera.lookAt(focus);
      camera.updateMatrixWorld(true);
      this.offset.copy(this.settledOffset);
      this.presented.copy(camera.position);
      this.applied=true;
      return;
    }
    // Move the eye to the handle side and turn toward the SAME work point.
    // Keep the horizon level. The torso/arms follow this shared view in FPSRig.
    // A small torso lean, never an orbit that walks the player around the room.
    // At floor/overhead targets a steep attack can put the rear grip below
    // the floor or above the worker. Ease to the nearest achievable angle,
    // retaining its sign so upward trimming never becomes deeper excavation.
    const lower=THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp((.68-focus.y-.22)/.68,-1,0)));
    const upper=THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp((1.85-focus.y-.22)/.68,0,1)));
    const attainable=THREE.MathUtils.clamp(requestedTiltDegrees,lower,upper);
    this.actualTiltDegrees=THREE.MathUtils.damp(this.actualTiltDegrees,attainable,12,Math.min(dt,.05));
    if(Math.abs(this.actualTiltDegrees-attainable)<.01)this.actualTiltDegrees=attainable;
    const side=THREE.MathUtils.degToRad(this.sideDegrees),tilt=THREE.MathUtils.degToRad(this.actualTiltDegrees);
    const attack=new THREE.Vector3(Math.sin(side)*Math.cos(tilt),-Math.sin(tilt),-Math.cos(side)*Math.cos(tilt));
    const right=attack.clone().cross(new THREE.Vector3(0,1,0)).normalize();
    // Follow the rear handle with the torso instead of asking fixed shoulders
    // to reach an overhead/sideways motor. Look past its side at the SAME bit.
    // PlayerController owns the physical distance from the wall; this stance
    // only leans and bends the body within its finite working posture.
    const swapped=THREE.MathUtils.smoothstep(-this.sideDegrees,0,20);
    const peek=THREE.MathUtils.lerp(-.34,.34,swapped);
    const desired=focus.clone().addScaledVector(attack,-.68).addScaledVector(right,peek);
    desired.y=THREE.MathUtils.clamp(desired.y+.22,.68,1.85);
    desired.x=THREE.MathUtils.clamp(desired.x,this.base.x-.55,this.base.x+.55);
    desired.z=this.base.z;
    const targetOffset=desired.sub(this.base);
    this.settledOffset.lerp(targetOffset,1-Math.exp(-12*Math.min(dt,.05)));
    if(this.settledOffset.distanceToSquared(targetOffset)<1e-10)this.settledOffset.copy(targetOffset);
    camera.position.copy(this.base).add(this.settledOffset);
    const radius = GAME_CONFIG.player.radius;
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, -GAME_CONFIG.room.width / 2 + radius, GAME_CONFIG.room.width / 2 - radius);
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, GAME_CONFIG.room.wallFrontZ + .32, GAME_CONFIG.room.depth / 2 - radius);
    camera.lookAt(focus);
    camera.updateMatrixWorld(true);
    // Handedness follows which side of the tool the head occupies. A lean
    // relative to the walking origin can have the opposite sign in oblique work.
    this.headLeanM = camera.position.clone().sub(focus.clone().addScaledVector(attack,-.68)).dot(right);
    this.offset.copy(camera.position).sub(this.base);
    this.presented.copy(camera.position);
    this.applied = true;
  }
}
