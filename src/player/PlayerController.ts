import * as THREE from 'three';
import type { Input } from '../core/Input';
import { GAME_CONFIG } from '../data/gameConfig';

export type MobileAimProfile = 'precise' | 'normal' | 'fast';

export class PlayerController {
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

  look(deltaX: number, deltaY: number, sensitivity = 0.0023): void {
    this.yaw -= deltaX * sensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch - deltaY * sensitivity, -1.18, 1.18);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  update(dt: number): void {
    const wallDistance = Math.abs(this.camera.position.z - GAME_CONFIG.room.wallFrontZ);
    this.wallAssistAmount = this.wallAssistEnabled ? 1 - THREE.MathUtils.smoothstep(wallDistance, 0.6, 1.7) : 0;
    if (this.input.mobileLook.x !== 0 || this.input.mobileLook.y !== 0) {
      const assistedAimSpeed = THREE.MathUtils.lerp(this.mobileAimSpeed, Math.min(this.mobileAimSpeed, 0.82), this.wallAssistAmount);
      const assistedVertical = THREE.MathUtils.lerp(this.mobileVerticalScale, Math.min(this.mobileVerticalScale, 0.5), this.wallAssistAmount);
      this.look(this.input.mobileLook.x * dt, this.input.mobileLook.y * dt * assistedVertical, assistedAimSpeed);
    }
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
    this.camera.position.addScaledVector(this.velocity, dt);
    const radius = GAME_CONFIG.player.radius;
    this.camera.position.x = THREE.MathUtils.clamp(this.camera.position.x, -GAME_CONFIG.room.width / 2 + radius, GAME_CONFIG.room.width / 2 - radius);
    this.camera.position.z = THREE.MathUtils.clamp(this.camera.position.z, -GAME_CONFIG.room.depth / 2 + radius + 0.25, GAME_CONFIG.room.depth / 2 - radius);
    this.camera.position.y = GAME_CONFIG.player.eyeHeight;
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
