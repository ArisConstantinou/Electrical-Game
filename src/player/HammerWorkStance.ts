import * as THREE from 'three';
import { GAME_CONFIG } from '../data/gameConfig';

/** Physical tool orientation relative to the player's freely aimed view. */
export class HammerWorkStance {
  sideDegrees = 0;
  actualTiltDegrees = 15;
  headLeanM = 0;
  readonly offset = new THREE.Vector3();

  // Kept for existing game/Studio callers. Tool presentation no longer borrows
  // the gameplay camera's transform, so there is nothing to restore each frame.
  restore(_camera: THREE.Camera): void {}

  update(camera: THREE.Camera, dt: number, requestedSide: number, enabled: boolean, requestedTiltDegrees = 0, tool = 'hammer'): void {
    this.offset.set(0, 0, 0);
    const view = camera.getWorldDirection(new THREE.Vector3());
    const distance = (GAME_CONFIG.room.wallFrontZ - camera.position.z) / view.z;
    const focus = camera.position.clone().addScaledVector(view, distance);
    const workingAtWall = view.z < -.15 && distance > 0 && camera.position.z-GAME_CONFIG.room.wallFrontZ <= 1.12 && Math.abs(focus.x) <= 2.54 && focus.y >= 0 && focus.y <= 3;
    const hammerWork = enabled && workingAtWall && tool === 'hammer';
    // Side adjustment is exact and symmetric about the worker's aim. The
    // default shoulder angle lives in the selected setting, never a hidden bias.
    // Keeping it fixed to
    // the wall normal twisted the motor away from the body in oblique views.
    const viewSide=THREE.MathUtils.radToDeg(Math.atan2(view.x,-view.z));
    let target = hammerWork ? THREE.MathUtils.clamp(requestedSide+viewSide,-65,65) : 0;
    // At a glancing view the ordinary wall-angle limit must not carry the
    // motor across the sightline to the opposite shoulder. Retain that side;
    // the finite wrist/contact checks still decide whether striking is possible.
    if(hammerWork&&requestedSide>0&&target<=viewSide)target=Math.min(87,viewSide+Math.min(15,requestedSide));
    if(hammerWork&&requestedSide<0&&target>=viewSide)target=Math.max(-87,viewSide-Math.min(15,-requestedSide));
    this.sideDegrees = THREE.MathUtils.damp(this.sideDegrees, target, 10, Math.min(dt, .05));
    if (Math.abs(this.sideDegrees - target) < .01) this.sideDegrees = target;
    if (!hammerWork) {
      this.headLeanM = 0;
      return;
    }
    // Orient the tool within the worker's reachable range. Camera translation
    // and rotation belong exclusively to player movement/look, never to this
    // damped pose: an animated eye orbit used to recenter every mouse movement.
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
    // Grip handedness follows the head's actual relation to the tool, without
    // moving the head to manufacture a preferred side or preserve a target.
    this.headLeanM = camera.position.clone().sub(focus.clone().addScaledVector(attack,-.68)).dot(right);
  }
}
