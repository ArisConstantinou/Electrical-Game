import * as THREE from 'three';
import { GAME_CONFIG } from '../data/gameConfig';
import { wallWorkTangent, wallWorkDirection, type WallWorkPlane } from './WallWorkPlane';

/** Physical tool orientation relative to the player's freely aimed view. */
export class HammerWorkStance {
  sideDegrees = 0;
  actualTiltDegrees = 15;
  targetSideDegrees = 0;
  targetTiltDegrees = 15;
  headLeanM = 0;
  readonly offset = new THREE.Vector3();

  // Kept for existing game/Studio callers. Tool presentation no longer borrows
  // the gameplay camera's transform, so there is nothing to restore each frame.
  restore(_camera: THREE.Camera): void {}

  /** Choose the wall-side shoulder on oblique approaches; retain it across
   * the front-facing zone so small aim reversals cannot keep swapping hands. */
  resolveSide(camera: THREE.Camera, requestedSide: number, plane?: WallWorkPlane | null): number {
    const view=camera.getWorldDirection(new THREE.Vector3());
    const normal=plane?.normal??new THREE.Vector3(0,0,1),point=plane?.point??new THREE.Vector3(0,0,GAME_CONFIG.room.wallFrontZ);
    const standoff=camera.position.clone().sub(point).dot(normal);
    const distance=-standoff/view.dot(normal);
    const focus=camera.position.clone().addScaledVector(view,distance);
    if(view.dot(normal)>=-.2 || distance<=0 || standoff>1.45 || !plane&&(Math.abs(focus.x)>2.54 || focus.y<0 || focus.y>3))return requestedSide;
    const viewSide=THREE.MathUtils.radToDeg(Math.atan2(view.dot(wallWorkTangent(normal)),-view.dot(normal)));
    return Math.abs(viewSide)>=30 ? Math.sign(viewSide)*Math.max(15,Math.abs(requestedSide)) : requestedSide;
  }

  update(camera: THREE.Camera, dt: number, requestedSide: number, enabled: boolean, requestedTiltDegrees = 0, tool = 'hammer', plane?: WallWorkPlane | null): void {
    this.offset.set(0, 0, 0);
    const view = camera.getWorldDirection(new THREE.Vector3());
    const normal=plane?.normal??new THREE.Vector3(0,0,1),point=plane?.point??new THREE.Vector3(0,0,GAME_CONFIG.room.wallFrontZ);
    const standoff=camera.position.clone().sub(point).dot(normal);
    const distance = -standoff/view.dot(normal);
    const focus = camera.position.clone().addScaledVector(view, distance);
    const workingAtWall = view.dot(normal) < -.15 && distance > 0 && standoff <= 1.45 && (plane||Math.abs(focus.x) <= 2.54 && focus.y >= 0 && focus.y <= 3);
    const hammerWork = enabled && workingAtWall && tool === 'hammer';
    // The selected attack is measured from the facade normal. A side view
    // changes the worker's shoulder presentation, never the shaft's purchase
    // into the brick. Adding view yaw here made the bit graze along the wall.
    const target = hammerWork ? THREE.MathUtils.clamp(requestedSide,-65,65) : 0;
    this.targetSideDegrees=target;
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
    const floor=plane?camera.position.y-GAME_CONFIG.player.eyeHeight:0;
    const lower=THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp((floor+.68-focus.y-.22)/.68,-1,0)));
    const upper=THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp((floor+1.85-focus.y-.22)/.68,0,1)));
    const attainable=THREE.MathUtils.clamp(requestedTiltDegrees,lower,upper);
    this.targetTiltDegrees=attainable;
    this.actualTiltDegrees=THREE.MathUtils.damp(this.actualTiltDegrees,attainable,12,Math.min(dt,.05));
    if(Math.abs(this.actualTiltDegrees-attainable)<.01)this.actualTiltDegrees=attainable;
    const attack=wallWorkDirection(normal,this.sideDegrees,this.actualTiltDegrees);
    const right=attack.clone().cross(new THREE.Vector3(0,1,0)).normalize();
    // Grip handedness follows the head's actual relation to the tool, without
    // moving the head to manufacture a preferred side or preserve a target.
    this.headLeanM = camera.position.clone().sub(focus.clone().addScaledVector(attack,-.68)).dot(right);
  }
}
