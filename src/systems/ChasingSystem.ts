import * as THREE from 'three';
import type { InstallationPoint } from '../electrical/InstallationPoint';
import type { BrickWall } from '../world/BrickWall';

interface Particle { mesh: THREE.Mesh; velocity: THREE.Vector3; life: number }

export class ChasingSystem {
  private readonly particles: Particle[] = [];
  private readonly debrisGeometry = new THREE.DodecahedronGeometry(0.017, 0);
  private readonly debrisMaterial = new THREE.MeshStandardMaterial({ color: 0xa85a39, roughness: 1 });

  constructor(private readonly scene: THREE.Scene, private readonly wall: BrickWall) {}

  hit(camera: THREE.Camera, point: InstallationPoint): boolean {
    const impact = this.wall.recessChaseAtAim(camera, point.definition.id, (point.chaseHits + 1) / 4);
    if (!impact) return false;
    point.chaseHits += 1;
    point.setStage(point.chaseHits >= 4 ? 'chased' : 'chasing');
    this.spawnDebris(impact);
    return true;
  }

  freeHit(camera: THREE.Camera): boolean {
    const impact = this.wall.removeAtAim(camera);
    if (!impact) return false;
    this.spawnDebris(impact);
    return true;
  }

  private spawnDebris(impact: THREE.Vector3): void {
    for (let index = 0; index < 7; index += 1) {
      const debris = new THREE.Mesh(this.debrisGeometry, this.debrisMaterial);
      debris.position.copy(impact).add(new THREE.Vector3((Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.08, 0.08));
      debris.scale.setScalar(0.55 + Math.random() * 0.65);
      this.scene.add(debris);
      this.particles.push({ mesh: debris, velocity: new THREE.Vector3((Math.random() - 0.5) * 0.45, Math.random() * 0.38, 0.45 + Math.random() * 0.35), life: 0.65 + Math.random() * 0.35 });
    }
  }

  update(dt: number): void {
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index];
      particle.life -= dt;
      particle.velocity.y -= 1.9 * dt;
      particle.mesh.position.addScaledVector(particle.velocity, dt);
      particle.mesh.rotation.x += dt * 6;
      particle.mesh.scale.multiplyScalar(Math.max(0.8, 1 - dt * 1.8));
      if (particle.life <= 0) { this.scene.remove(particle.mesh); this.particles.splice(index, 1); }
    }
  }
}
