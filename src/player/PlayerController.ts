import * as THREE from 'three';
import type { Input } from '../core/Input';
import { GAME_CONFIG } from '../data/gameConfig';

export type MobileAimProfile = 'precise' | 'normal' | 'fast';

export class PlayerController {
  wallWorkEnabled = false;
  wallWorkDistance = .76;
  /** Feed along the wall while the hammer is held; null retains free walking. */
  wallToolTravelSpeedMps: number | null = null;
  readonly workPosition = { locked: false, distanceM: 0, targetDistanceM: .76, released: false };
  crouched = false;
  handWorkTargetY:number|null=null;
  private handWorkEyeHeight:number|null=null;
  get eyeHeight(): number { return this.crouched || this.input.pressed('ControlLeft') || this.input.pressed('ControlRight') ? .95 : this.handWorkEyeHeight ?? GAME_CONFIG.player.eyeHeight; }
  yaw = 0;
  pitch = -0.62;
  readonly velocity = new THREE.Vector3();
  wallAssistAmount = 0;
  private mobileAimSpeed = 1.55;
  private mobileVerticalScale = 0.72;
  private mobileDragSensitivity = 0.0032;
  private wallAssistEnabled = true;

  constructor(readonly camera: THREE.PerspectiveCamera, private readonly input: Input) {
    camera.position.set(-1.72, GAME_CONFIG.player.eyeHeight, -0.58);
    camera.rotation.set(this.pitch, this.yaw, 0);
  }

  // All tools share direct aiming. A hard eye-only window prevents precise
  // placement of the work point and introduces a dead zone on every reversal.
  look(deltaX: number, deltaY: number, sensitivity = 0.0023): void {
    this.yaw -= deltaX * sensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch - deltaY * sensitivity, -1.18, 1.18);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  update(dt: number): void {
    const wallDistance = Math.abs(this.camera.position.z - GAME_CONFIG.room.wallFrontZ);
    const handWork=this.handWorkTargetY!==null&&this.wallWorkEnabled&&Math.cos(this.yaw)>.65&&wallDistance<.94&&!this.workPosition.released;
    // Bend knees/hips for low hand work. The body never rises above standing
    // eye height, and distant or high wall areas still require repositioning.
    this.handWorkEyeHeight=handWork?THREE.MathUtils.clamp(this.handWorkTargetY!+.34,.68,GAME_CONFIG.player.eyeHeight):null;
    this.wallAssistAmount = this.wallAssistEnabled ? 1 - THREE.MathUtils.smoothstep(wallDistance, 0.6, 1.7) : 0;
    if (this.input.mobileLook.x !== 0 || this.input.mobileLook.y !== 0) {
      const assistedAimSpeed = THREE.MathUtils.lerp(this.mobileAimSpeed, Math.min(this.mobileAimSpeed, 0.82), this.wallAssistAmount);
      const assistedVertical = THREE.MathUtils.lerp(this.mobileVerticalScale, Math.min(this.mobileVerticalScale, 0.5), this.wallAssistAmount);
      this.look(this.input.mobileLook.x * dt, this.input.mobileLook.y * dt * assistedVertical, assistedAimSpeed);
    }
    const view=this.camera.getWorldDirection(new THREE.Vector3());
    const handFocus=handWork?this.camera.position.clone().addScaledVector(view,(GAME_CONFIG.room.wallFrontZ-this.camera.position.z)/view.z):null;
    const previousX=this.camera.position.x;
    const keyboardX = Number(this.input.pressed('KeyD')) - Number(this.input.pressed('KeyA'));
    const keyboardY = Number(this.input.pressed('KeyW')) - Number(this.input.pressed('KeyS'));
    let x = keyboardX + this.input.mobileMove.x;
    let y = keyboardY - this.input.mobileMove.y;
    const length = Math.hypot(x, y);
    if (length > 1) { x /= length; y /= length; }
    const usingMobileMove = this.input.mobileMove.x !== 0 || this.input.mobileMove.y !== 0;
    const proximityMoveScale = usingMobileMove ? THREE.MathUtils.lerp(1, 0.58, this.wallAssistAmount) : 1;
    const speed = GAME_CONFIG.player.speed * proximityMoveScale * (this.input.pressed('ShiftLeft') || this.input.pressed('ShiftRight') ? GAME_CONFIG.player.sprintMultiplier : 1);
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.velocity.copy(forward).multiplyScalar(y * speed).addScaledVector(right, x * speed);
    const previousZ=this.camera.position.z;
    this.camera.position.addScaledVector(this.velocity, dt);
    const work=this.workPosition;
    const wasLocked=work.locked;
    const wallDistanceNow=this.camera.position.z-GAME_CONFIG.room.wallFrontZ;
    const facingWall=Math.cos(this.yaw)>.2;
    if(!this.wallWorkEnabled || !facingWall){work.locked=false;}
    // Backward intent explicitly releases the stance. Do not immediately snap
    // back while the player is standing inside the entry zone after release.
    if(work.locked && y<-.12){work.locked=false;work.released=true;}
    if(wallDistanceNow>1.15 || y>.2)work.released=false;
    if(this.wallWorkEnabled && facingWall && !work.released && !work.locked && y>=-.12 && wallDistanceNow<(this.handWorkTargetY===null?1.10:.94) && wallDistanceNow>.30)work.locked=true;
    // Looking or changing a tool pose must not pull the camera to a newly
    // calculated standoff. Take up a new distance on approach/forward intent;
    // once braced, keep that distance until the player deliberately moves.
    if(!work.locked||y>.12)work.targetDistanceM=this.wallWorkDistance;
    else if(!wasLocked)work.targetDistanceM=this.handWorkTargetY!==null?this.wallWorkDistance:wallDistanceNow;
    if(work.locked){
      if(this.wallToolTravelSpeedMps!==null && y>=0){
        // A/D follow the wall tangent at the cutting feed rate, independent of
        // view yaw. Free walking would jump past several blade widths per hit.
        this.camera.position.x=previousX+x*this.wallToolTravelSpeedMps*dt;
        this.velocity.set(x*this.wallToolTravelSpeedMps,0,0);
      }
      // Bracing absorbs forward input even when looking diagonally along the
      // wall. Only an explicit strafe moves the worker sideways in this stance.
      else if(y>=0){
        this.camera.position.x-=forward.x*y*speed*dt;
        this.velocity.copy(right).multiplyScalar(x*speed);
      }
      const target=GAME_CONFIG.room.wallFrontZ+work.targetDistanceM;
      this.camera.position.z=THREE.MathUtils.damp(previousZ,target,18,dt);
      if(Math.abs(this.camera.position.z-target)<.002)this.camera.position.z=target;
      // Bracing may move the body to the physical tool distance, but it must
      // never overwrite the yaw/pitch supplied by mouse or touch input.
      // Forward force is absorbed by the stance; sideways walking remains free.
      if(y>=0)this.velocity.z=0;
    }
    work.distanceM=this.camera.position.z-GAME_CONFIG.room.wallFrontZ;
    const radius = GAME_CONFIG.player.radius;
    this.camera.position.x = THREE.MathUtils.clamp(this.camera.position.x, -GAME_CONFIG.room.width / 2 + radius, GAME_CONFIG.room.width / 2 - radius);
    this.camera.position.z = THREE.MathUtils.clamp(this.camera.position.z, -GAME_CONFIG.room.depth / 2 + radius + 0.25, GAME_CONFIG.room.depth / 2 - radius);
    this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, this.eyeHeight, 14, dt);
    if(handFocus){handFocus.x+=this.camera.position.x-previousX;this.camera.lookAt(handFocus);this.pitch=this.camera.rotation.x;this.yaw=this.camera.rotation.y;}
  }

  setMobileAimProfile(profile: MobileAimProfile): void {
    const settings = {
      precise: { speed: 1.08, vertical: 0.62, drag: 0.00235 },
      normal: { speed: 1.55, vertical: 0.72, drag: 0.0032 },
      fast: { speed: 2.05, vertical: 0.82, drag: 0.00415 },
    }[profile];
    this.mobileAimSpeed = settings.speed;
    this.mobileVerticalScale = settings.vertical;
    this.mobileDragSensitivity = settings.drag;
  }

  lookMobileDrag(deltaX: number, deltaY: number): void {
    const sensitivity = THREE.MathUtils.lerp(this.mobileDragSensitivity, Math.min(this.mobileDragSensitivity, 0.0017), this.wallAssistAmount);
    const vertical = THREE.MathUtils.lerp(this.mobileVerticalScale, Math.min(this.mobileVerticalScale, 0.5), this.wallAssistAmount);
    this.look(deltaX, deltaY * vertical, sensitivity);
  }

  setWallAssist(enabled: boolean): void {
    this.wallAssistEnabled = enabled;
    if (!enabled) this.wallAssistAmount = 0;
  }
}
