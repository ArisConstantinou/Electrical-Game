import * as THREE from 'three';
import type { Input } from '../core/Input';
import { GAME_CONFIG } from '../data/gameConfig';

export class PlayerController {
  yaw = 0;
  pitch = -0.62;
  readonly velocity = new THREE.Vector3();

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
    if (this.input.mobileLook.x !== 0 || this.input.mobileLook.y !== 0) {
      this.look(this.input.mobileLook.x * dt, this.input.mobileLook.y * dt, 1.9);
    }
    const keyboardX = Number(this.input.pressed('KeyD')) - Number(this.input.pressed('KeyA'));
    const keyboardY = Number(this.input.pressed('KeyW')) - Number(this.input.pressed('KeyS'));
    let x = keyboardX + this.input.mobileMove.x;
    let y = keyboardY - this.input.mobileMove.y;
    const length = Math.hypot(x, y);
    if (length > 1) { x /= length; y /= length; }
    const speed = GAME_CONFIG.player.speed * (this.input.pressed('ShiftLeft') || this.input.pressed('ShiftRight') ? GAME_CONFIG.player.sprintMultiplier : 1);
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.velocity.copy(forward).multiplyScalar(y * speed).addScaledVector(right, x * speed);
    this.camera.position.addScaledVector(this.velocity, dt);
    const radius = GAME_CONFIG.player.radius;
    this.camera.position.x = THREE.MathUtils.clamp(this.camera.position.x, -GAME_CONFIG.room.width / 2 + radius, GAME_CONFIG.room.width / 2 - radius);
    this.camera.position.z = THREE.MathUtils.clamp(this.camera.position.z, -GAME_CONFIG.room.depth / 2 + radius + 0.25, GAME_CONFIG.room.depth / 2 - radius);
    this.camera.position.y = GAME_CONFIG.player.eyeHeight;
  }
}
