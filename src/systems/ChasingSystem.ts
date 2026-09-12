import * as THREE from 'three';
import type { InstallationPoint } from '../electrical/InstallationPoint';
import type { BrickWall, MasonryImpact } from '../world/BrickWall';

interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  life: number;
  floorRadius: number;
  settled: boolean;
}

const fragmentGeometries = [
  new THREE.TetrahedronGeometry(1, 0),
  new THREE.DodecahedronGeometry(1, 0),
  new THREE.BoxGeometry(1, 1, 1),
];
const fragmentMaterials = [
  new THREE.MeshStandardMaterial({ color: 0xb65332, roughness: 1 }),
  new THREE.MeshStandardMaterial({ color: 0x8f3c25, roughness: 1 }),
  new THREE.MeshStandardMaterial({ color: 0xcf6840, roughness: 0.98 }),
  new THREE.MeshStandardMaterial({ color: 0x6c2b1d, roughness: 1 }),
];

function seeded(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state = Math.imul(state ^ (state >>> 15), 1 | state);
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
}

export class ChasingSystem {
  private readonly particles: Particle[] = [];

  constructor(private readonly scene: THREE.Scene, private readonly wall: BrickWall) {}

  hit(camera: THREE.Camera, point: InstallationPoint): boolean {
    const impact = this.wall.recessChaseAtAim(camera, point.definition.id);
    if (!impact) return false;
    point.chaseHits += 1;
    const complete = point.chaseHits >= 4 && this.wall.getChaseCoverage(point.definition.id) >= 0.98;
    point.setStage(complete ? 'chased' : 'chasing');
    this.spawnDebris(impact);
    return true;
  }

  freeHit(camera: THREE.Camera): MasonryImpact | null {
    const impact = this.wall.removeAtAim(camera);
    if (!impact) return null;
    this.spawnDebris(impact);
    return impact;
  }

  get activeFragmentCount(): number { return this.particles.length; }

  private spawnDebris(impact: MasonryImpact): void {
    const random = seeded(impact.seed);
    const baseCount = impact.kind === 'demolish-break' ? 17
      : impact.kind === 'demolish-spall' ? 9
        : impact.kind === 'demolish-crack' ? 6
          : impact.kind === 'demolish-chip' ? 4
            : Math.min(14, Math.max(5, impact.points.length * 2));
    const largeBreak = impact.kind === 'demolish-break';
    for (let index = 0; index < baseCount; index += 1) {
      const source = impact.points[index % impact.points.length];
      const fragment = new THREE.Mesh(
        fragmentGeometries[Math.floor(random() * fragmentGeometries.length)],
        fragmentMaterials[Math.floor(random() * fragmentMaterials.length)],
      );
      const baseSize = largeBreak ? 0.018 + Math.pow(random(), 1.7) * 0.058 : 0.006 + Math.pow(random(), 1.9) * 0.022;
      const width = baseSize * (0.55 + random() * 1.9);
      const height = baseSize * (0.45 + random() * 1.45);
      const depth = baseSize * (0.38 + random() * 1.25);
      fragment.position.copy(source).add(new THREE.Vector3((random() - 0.5) * 0.095, (random() - 0.5) * 0.07, 0.035 + random() * 0.045));
      fragment.rotation.set(random() * Math.PI, random() * Math.PI, random() * Math.PI);
      fragment.scale.set(width, height, depth);
      fragment.castShadow = true;
      fragment.receiveShadow = true;
      fragment.raycast = () => undefined;
      this.scene.add(fragment);
      this.particles.push({
        mesh: fragment,
        velocity: new THREE.Vector3((random() - 0.5) * (largeBreak ? 1.15 : 0.5), 0.12 + random() * (largeBreak ? 0.85 : 0.4), 0.28 + random() * (largeBreak ? 0.95 : 0.48)),
        angularVelocity: new THREE.Vector3((random() - 0.5) * 11, (random() - 0.5) * 11, (random() - 0.5) * 11),
        life: (largeBreak ? 5.2 : 1.5) + random() * (largeBreak ? 2.4 : 1.2),
        floorRadius: Math.max(0.006, height * 0.7),
        settled: false,
      });
    }
  }

  update(dt: number): void {
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index];
      particle.life -= dt;
      if (!particle.settled) {
        particle.velocity.y -= 4.6 * dt;
        particle.mesh.position.addScaledVector(particle.velocity, dt);
        particle.mesh.rotation.x += particle.angularVelocity.x * dt;
        particle.mesh.rotation.y += particle.angularVelocity.y * dt;
        particle.mesh.rotation.z += particle.angularVelocity.z * dt;
        if (particle.mesh.position.y <= particle.floorRadius) {
          particle.mesh.position.y = particle.floorRadius;
          particle.velocity.y = Math.abs(particle.velocity.y) * 0.27;
          particle.velocity.x *= 0.58;
          particle.velocity.z *= 0.58;
          particle.angularVelocity.multiplyScalar(0.64);
          if (particle.velocity.y < 0.12) particle.settled = true;
        }
      }
      if (particle.life < 0.35) particle.mesh.scale.multiplyScalar(Math.max(0.72, 1 - dt * 4));
      if (particle.life <= 0) {
        this.scene.remove(particle.mesh);
        this.particles.splice(index, 1);
      }
    }
  }
}
