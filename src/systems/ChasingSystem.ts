import * as THREE from 'three';
import type { InstallationPoint } from '../electrical/InstallationPoint';
import type { BrickWall, MasonryImpact } from '../world/BrickWall';

interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  life: number;
  halfWidth: number;
  halfHeight: number;
  halfDepth: number;
  settled: boolean;
}

const fragmentGeometries = [
  new THREE.TetrahedronGeometry(1, 0),
  new THREE.DodecahedronGeometry(1, 0),
  new THREE.BoxGeometry(1, 1, 1),
];
const fragmentMaterials = [
  new THREE.MeshStandardMaterial({ color: 0xb65332, roughness: 1, transparent: false, depthWrite: true }),
  new THREE.MeshStandardMaterial({ color: 0x8f3c25, roughness: 1, transparent: false, depthWrite: true }),
  new THREE.MeshStandardMaterial({ color: 0xcf6840, roughness: 0.98, transparent: false, depthWrite: true }),
  new THREE.MeshStandardMaterial({ color: 0x6c2b1d, roughness: 1, transparent: false, depthWrite: true }),
];
const MAX_RUBBLE_PIECES = 320;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

fragmentGeometries.forEach(geometry => {
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
});

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
  get airborneFragmentCount(): number { return this.particles.filter(particle => !particle.settled).length; }
  get settledFragmentCount(): number { return this.particles.filter(particle => particle.settled).length; }
  get rubblePileHeight(): number {
    return this.particles.reduce((height, particle) => particle.settled ? Math.max(height, particle.mesh.position.y + particle.halfHeight) : height, 0);
  }
  get settledOverlapCount(): number {
    let overlaps = 0;
    const settled = this.particles.filter(particle => particle.settled);
    for (let first = 0; first < settled.length; first += 1) for (let second = first + 1; second < settled.length; second += 1) {
      const a = settled[first];
      const b = settled[second];
      const aFootprint = this.floorFootprint(a);
      const bFootprint = this.floorFootprint(b);
      const overlapsX = Math.abs(a.mesh.position.x - b.mesh.position.x) < aFootprint.x + bFootprint.x - 0.0001;
      const overlapsY = Math.abs(a.mesh.position.y - b.mesh.position.y) < a.halfHeight + b.halfHeight - 0.0001;
      const overlapsZ = Math.abs(a.mesh.position.z - b.mesh.position.z) < aFootprint.y + bFootprint.y - 0.0001;
      if (overlapsX && overlapsY && overlapsZ) overlaps += 1;
    }
    return overlaps;
  }

  private spawnDebris(impact: MasonryImpact): void {
    const random = seeded(impact.seed);
    const baseCount = impact.kind === 'demolish-break' ? 11 + Math.floor(random() * 11)
      : impact.kind === 'demolish-spall' ? 6 + Math.floor(random() * 6)
        : impact.kind === 'demolish-crack' ? 4 + Math.floor(random() * 4)
          : impact.kind === 'demolish-chip' ? 2 + Math.floor(random() * 4)
            : Math.min(14, Math.max(5, impact.points.length * 2));
    const largeBreak = impact.kind === 'demolish-break';
    for (let index = 0; index < baseCount; index += 1) {
      const source = impact.points[index % impact.points.length];
      const geometry = fragmentGeometries[Math.floor(random() * fragmentGeometries.length)];
      const fragment = new THREE.Mesh(
        geometry,
        fragmentMaterials[Math.floor(random() * fragmentMaterials.length)],
      );
      const width = largeBreak ? 0.022 + Math.pow(random(), 1.35) * 0.068 : 0.007 + Math.pow(random(), 1.7) * 0.024;
      const height = largeBreak ? 0.014 + Math.pow(random(), 1.45) * 0.038 : 0.005 + Math.pow(random(), 1.8) * 0.017;
      const depth = largeBreak ? 0.014 + Math.pow(random(), 1.5) * 0.045 : 0.005 + Math.pow(random(), 1.8) * 0.019;
      const bounds = geometry.boundingBox!.getSize(new THREE.Vector3());
      fragment.scale.set(width / bounds.x, height / bounds.y, depth / bounds.z);
      const angle = index * GOLDEN_ANGLE + random() * 0.45;
      const ring = 0.018 + Math.sqrt(index) * (largeBreak ? 0.027 : 0.014);
      fragment.position.copy(source).add(new THREE.Vector3(Math.cos(angle) * ring, Math.sin(angle) * ring * 0.55, 0.025 + (index % 4) * 0.018));
      fragment.rotation.set(random() * Math.PI, random() * Math.PI, random() * Math.PI);
      fragment.castShadow = true;
      fragment.receiveShadow = true;
      fragment.raycast = () => undefined;
      this.scene.add(fragment);
      this.particles.push({
        mesh: fragment,
        velocity: new THREE.Vector3(Math.cos(angle) * (0.08 + random() * (largeBreak ? 0.3 : 0.14)), 0.04 + random() * (largeBreak ? 0.3 : 0.16), 0.12 + random() * (largeBreak ? 0.36 : 0.2)),
        angularVelocity: new THREE.Vector3((random() - 0.5) * 11, (random() - 0.5) * 11, (random() - 0.5) * 11),
        life: (largeBreak ? 32 : 8) + random() * (largeBreak ? 18 : 5),
        halfWidth: width * 0.5,
        halfHeight: height * 0.5,
        halfDepth: depth * 0.5,
        settled: false,
      });
    }
    this.trimRubbleBudget();
  }

  update(dt: number): void {
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index];
      particle.life -= dt;
      if (!particle.settled) {
        particle.velocity.y -= 9.2 * dt;
        particle.mesh.position.addScaledVector(particle.velocity, dt);
        particle.mesh.rotation.x += particle.angularVelocity.x * dt;
        particle.mesh.rotation.y += particle.angularVelocity.y * dt;
        particle.mesh.rotation.z += particle.angularVelocity.z * dt;
        let supportY = this.supportHeight(particle);
        if (particle.mesh.position.y <= supportY) {
          // Rubble comes to rest on a broad face. This gives every settled piece a
          // stable solid footprint instead of leaving arbitrarily rotated meshes interpenetrating.
          particle.mesh.rotation.x = 0;
          particle.mesh.rotation.z = 0;
          supportY = this.supportHeight(particle);
          particle.mesh.position.y = supportY;
          particle.settled = true;
          particle.velocity.set(0, 0, 0);
          particle.angularVelocity.set(0, 0, 0);
        }
      }
      if (particle.life < 0.35) particle.mesh.scale.multiplyScalar(Math.max(0.72, 1 - dt * 4));
      if (particle.life <= 0) {
        this.scene.remove(particle.mesh);
        this.particles.splice(index, 1);
      }
    }
  }

  private supportHeight(particle: Particle): number {
    let support = particle.halfHeight;
    const footprint = this.floorFootprint(particle);
    for (const other of this.particles) {
      if (other === particle || !other.settled) continue;
      const dx = other.mesh.position.x - particle.mesh.position.x;
      const dz = other.mesh.position.z - particle.mesh.position.z;
      const otherFootprint = this.floorFootprint(other);
      if (Math.abs(dx) < footprint.x + otherFootprint.x + 0.001 && Math.abs(dz) < footprint.y + otherFootprint.y + 0.001) {
        support = Math.max(support, other.mesh.position.y + other.halfHeight + particle.halfHeight + 0.001);
      }
    }
    return support;
  }

  private floorFootprint(particle: Particle): THREE.Vector2 {
    const cosine = Math.abs(Math.cos(particle.mesh.rotation.y));
    const sine = Math.abs(Math.sin(particle.mesh.rotation.y));
    return new THREE.Vector2(
      particle.halfWidth * cosine + particle.halfDepth * sine,
      particle.halfWidth * sine + particle.halfDepth * cosine,
    );
  }

  private trimRubbleBudget(): void {
    while (this.particles.length > MAX_RUBBLE_PIECES) {
      const index = this.particles.findIndex(particle => particle.settled);
      const removeIndex = index >= 0 ? index : 0;
      const [particle] = this.particles.splice(removeIndex, 1);
      this.scene.remove(particle.mesh);
    }
  }
}
