import * as THREE from 'three';
import { GAME_CONFIG } from '../data/gameConfig';
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
  support: Particle | null;
  wallSupported: boolean;
  ownedGeometry: boolean;
  transient: boolean;
}

const pooledPlaceholder = new THREE.BoxGeometry(1, 1, 1);
// MaterialId: Air=0, Clay=1, Mortar=2, Render=3, Concrete=4.
const fragmentMaterials = [
  new THREE.MeshStandardMaterial({ color: 0xb65332, roughness: 1, transparent: false, depthWrite: true }),
  new THREE.MeshStandardMaterial({ color: 0x898378, roughness: 1, transparent: false, depthWrite: true }),
  new THREE.MeshStandardMaterial({ color: 0xb5aea0, roughness: 1, transparent: false, depthWrite: true }),
  new THREE.MeshStandardMaterial({ color: 0x73766f, roughness: 1, transparent: false, depthWrite: true }),
];
const materialNames = ['air', 'clay', 'mortar', 'render', 'concrete'];
const materialDensities = [0, 1700, 2000, 1800, 2300];
const MAX_RUBBLE_PIECES = 144;
const MAX_POOLED_MESHES = 48;
const MAX_TRANSIENT_PIECES = 64;
const MAX_RUBBLE_HEIGHT = 0.16;
const MIN_SUPPORT_COVERAGE = 0.55;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

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
  private readonly meshPool: THREE.Mesh[] = [];
  private readonly previousPosition = new THREE.Vector3();
  lastSpawnMs = 0;
  maximumSpawnMs = 0;
  lastUpdateMs = 0;
  maximumUpdateMs = 0;
  totalEmittedVolume = 0;
  totalRetiredVolume = 0;
  budgetRetirements = 0;
  peakActiveFragments = 0;

  constructor(private readonly scene: THREE.Scene, private readonly wall: BrickWall) {}

  hit(camera: THREE.Camera, point: InstallationPoint): boolean {
    const impact = this.wall.recessChaseAtAim(camera, point.definition.id);
    if (!impact) return false;
    point.chaseHits += 1;
    this.refreshProgress(point);
    this.spawnDebris(impact);
    return true;
  }

  canFitBoxes(point: InstallationPoint): boolean { return this.wall.canFitBoxes(point); }

  positionBoxAtAim(point: InstallationPoint, camera: THREE.Camera): boolean {
    const origin = camera.getWorldPosition(new THREE.Vector3());
    const direction = camera.getWorldDirection(new THREE.Vector3());
    if (direction.z >= -.01) return false;
    const distance = (GAME_CONFIG.room.wallFrontZ - origin.z) / direction.z;
    if (distance <= 0 || distance > GAME_CONFIG.interaction.maxDistance) return false;
    const position = origin.addScaledVector(direction, distance);
    if (Math.abs(position.x) > GAME_CONFIG.room.width / 2 || position.y < 0 || position.y > GAME_CONFIG.room.height) return false;
    point.placeAt(position.x, position.y);
    return true;
  }

  refreshProgress(point: InstallationPoint): void {
    if (!['inspect', 'marked', 'chasing', 'chased'].includes(point.stage)) return;
    const complete = this.canFitBoxes(point);
    point.setStage(complete ? 'chased' : 'chasing');
  }

  freeHit(camera: THREE.Camera, continuing = false): MasonryImpact | null {
    const impact = this.wall.removeAtAim(camera, continuing);
    if (!impact) return null;
    this.spawnDebris(impact);
    return impact;
  }

  get insideFragmentCount(): number { return this.particles.filter(p=>p.mesh.position.z < -2.415 && p.mesh.position.z > -2.595).length; }
  get inwardFragmentCount(): number { return this.particles.filter(p=>p.mesh.userData.inward).length; }
  get activeFragmentCount(): number { return this.particles.length; }
  get airborneFragmentCount(): number { return this.particles.filter(particle => !particle.settled).length; }
  get settledFragmentCount(): number { return this.particles.filter(particle => particle.settled).length; }
  get fragmentBudget(): number { return MAX_RUBBLE_PIECES; }
  get pooledFragmentCount(): number { return this.meshPool.length; }
  get transientFragmentCount(): number { return this.particles.filter(particle => particle.transient).length; }
  get activeFragmentVolume(): number { return this.particles.reduce((volume, particle) => volume + Number(particle.mesh.userData.volume), 0); }
  get rubblePileHeight(): number {
    return this.particles.reduce((height, particle) => particle.settled ? Math.max(height, particle.mesh.position.y + particle.halfHeight) : height, 0);
  }
  get unsupportedSettledFragmentCount(): number {
    return this.particles.filter(particle => {
      if (!particle.settled) return false;
      if (particle.wallSupported) return !this.hasWallSupport(particle);
      if (!particle.support) return Math.abs(particle.mesh.position.y - particle.halfHeight) > 0.004;
      if (!particle.support.settled || !this.particles.includes(particle.support)) return true;
      const expectedY = particle.support.mesh.position.y + particle.support.halfHeight + particle.halfHeight + 0.001;
      return Math.abs(particle.mesh.position.y - expectedY) > 0.004;
    }).length;
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
    const started = performance.now();
    const random = seeded(impact.seed);
    // The fracture core is the only source of debris. A cracking-only strike
    // creates no fake solid pieces and every body carries its removed volume.
    for (const source of impact.fragments ?? []) {
      if (!(source.volume > 0) || source.material === 0) continue;
      const fragment = this.meshPool.pop() ?? new THREE.Mesh(pooledPlaceholder);
      const materialIndex = THREE.MathUtils.clamp(source.material - 1, 0, fragmentMaterials.length - 1);
      fragment.material = fragmentMaterials[materialIndex];
      fragment.position.set(source.position.x, source.position.y, source.position.z);
      fragment.scale.set(1, 1, 1);
      fragment.rotation.set(0, 0, 0);
      let width = Math.max(0.001, source.size.x);
      let height = Math.max(0.001, source.size.y);
      let depth = Math.max(0.001, source.size.z);
      const actualGeometry = Boolean(source.positions?.length);
      if (actualGeometry) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(source.positions!.slice(), 3));
        geometry.computeBoundingBox();
        const center = geometry.boundingBox!.getCenter(new THREE.Vector3());
        const size = geometry.boundingBox!.getSize(new THREE.Vector3());
        width = size.x; height = size.y; depth = size.z;
        geometry.translate(-center.x, -center.y, -center.z);
        fragment.position.add(center);
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
        fragment.geometry = geometry;
      } else {
        // Crushed fines may be aggregated by the core without a retained mesh.
        // This volume-matched visual chip does not stand in for an intact shell
        // or island. Its size derives from the exact removed volume, not damage.
        const volumeScale = Math.cbrt(source.volume / (width * height * depth));
        width *= volumeScale; height *= volumeScale; depth *= volumeScale;
        fragment.geometry = pooledPlaceholder;
        fragment.scale.set(width, height, depth);
      }
      const transient = !source.detached && source.volume < 0.000008;
      fragment.name = source.detached ? 'Detached masonry island' : 'Crushed masonry chip';
      fragment.userData = {
        volume: source.volume, material: materialNames[source.material],
        massKg: source.volume * materialDensities[source.material],
        detached: source.detached, actualFractureGeometry: actualGeometry,
      };
      fragment.visible = true;
      fragment.castShadow = true;
      fragment.receiveShadow = true;
      fragment.raycast = () => undefined;
      this.scene.add(fragment);
      const speed = source.detached ? 0.08 : 0.18;
      const spin = source.detached ? 2.2 : 7;
      // Brittle chips can enter the exposed chamber instead of all ejecting
      // toward the operator. Their birth location stays at the removed solid.
      const inward = random() < .42;
      fragment.userData.inward = inward;
      this.particles.push({
        mesh: fragment,
        velocity: new THREE.Vector3((random() - 0.5) * speed, (random()-.6) * speed * 0.3, (inward?-1:1)*speed * (0.8 + random() * 0.8)),
        angularVelocity: new THREE.Vector3((random() - 0.5) * spin, (random() - 0.5) * spin, (random() - 0.5) * spin),
        life: transient ? 2.5 + random() * 1.5 : 65 + random() * 20,
        halfWidth: width * 0.5,
        halfHeight: height * 0.5,
        halfDepth: depth * 0.5,
        settled: false,
        support: null,
        wallSupported: false,
        ownedGeometry: actualGeometry,
        transient,
      });
      this.totalEmittedVolume += source.volume;
    }
    this.trimRubbleBudget();
    this.peakActiveFragments = Math.max(this.peakActiveFragments, this.particles.length);
    this.lastSpawnMs = performance.now() - started;
    this.maximumSpawnMs = Math.max(this.maximumSpawnMs, this.lastSpawnMs);
  }

  update(dt: number): void {
    const started = performance.now();
    const detached=this.wall.processPendingSupport();
    if(detached) this.spawnDebris(detached);
    const elapsed = Math.min(0.05, Math.max(0, dt));
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index];
      particle.life -= dt;
      if (particle.settled && particle.wallSupported && !this.hasWallSupport(particle)) {
        particle.settled = false;
        particle.wallSupported = false;
        this.releaseDependents(particle);
      }
      if (!particle.settled) {
        const previousY = particle.mesh.position.y;
        const speed = Math.max(Math.abs(particle.velocity.x), Math.abs(particle.velocity.y), Math.abs(particle.velocity.z));
        const substeps = Math.min(12, Math.max(1, Math.ceil(speed * elapsed / 0.008)));
        const step = elapsed / substeps;
        for (let substep = 0; substep < substeps && !particle.settled; substep++) {
          particle.velocity.y = Math.max(-8, particle.velocity.y - 9.81 * step);
          this.advanceAgainstWall(particle, step);
        }
        particle.mesh.rotation.x += particle.angularVelocity.x * elapsed;
        particle.mesh.rotation.y += particle.angularVelocity.y * elapsed;
        particle.mesh.rotation.z += particle.angularVelocity.z * elapsed;
        let contact = this.supportContact(particle, previousY);
        if (!particle.settled && particle.mesh.position.y <= contact.height) {
          // Rubble comes to rest on a broad face. This gives every settled piece a
          // stable solid footprint instead of leaving arbitrarily rotated meshes interpenetrating.
          particle.mesh.rotation.x = 0;
          particle.mesh.rotation.z = 0;
          contact = this.supportContact(particle, previousY);
          if (!contact.particle && contact.height === particle.halfHeight) {
            this.placeOnOpenFloor(particle);
            contact = this.supportContact(particle, previousY);
          }
          particle.mesh.position.y = contact.height;
          particle.settled = true;
          particle.support = contact.particle;
          particle.wallSupported = false;
          particle.velocity.set(0, 0, 0);
          particle.angularVelocity.set(0, 0, 0);
        }
      }
      if (particle.life <= 0) {
        this.retireParticle(index);
      }
    }
    this.lastUpdateMs = performance.now() - started;
    this.maximumUpdateMs = Math.max(this.maximumUpdateMs, this.lastUpdateMs);
  }

  private advanceAgainstWall(particle: Particle, dt: number): void {
    const position = particle.mesh.position;
    this.previousPosition.copy(position);
    const axes = ['x', 'z', 'y'] as const;
    for (const axis of axes) {
      const velocity = particle.velocity[axis];
      position[axis] += velocity * dt;
      if (!this.overlapsWall(particle)) continue;
      position[axis] = this.previousPosition[axis];
      particle.velocity[axis] = -velocity * 0.12;
      particle.angularVelocity.multiplyScalar(0.65);
      if (axis === 'y' && velocity < 0 && Math.abs(particle.velocity.y) < 0.16 && this.hasWallSupport(particle)) {
        if (!this.hasSettledOverlap(particle)) {
          particle.settled = true;
          particle.wallSupported = true;
          particle.support = null;
          particle.velocity.set(0, 0, 0);
          particle.angularVelocity.set(0, 0, 0);
        } else {
          // A chamber shelf is already occupied. Keep the chip dynamic so it
          // slips along the shelf instead of sleeping inside another fragment.
          particle.velocity.x = (particle.mesh.id % 2 ? 1 : -1) * .045;
          particle.velocity.z = (particle.mesh.userData.inward ? -1 : 1) * .035;
        }
      }
    }
    const side = GAME_CONFIG.room.width / 2 - particle.halfWidth;
    if (Math.abs(position.x) > side) {
      position.x = THREE.MathUtils.clamp(position.x, -side, side);
      particle.velocity.x *= -0.12;
    }
    const back = GAME_CONFIG.room.depth / 2 - particle.halfDepth;
    if (position.z > back) { position.z = back; particle.velocity.z *= -0.12; }
  }

  private overlapsWall(particle: Particle): boolean {
    const p = particle.mesh.position;
    // The editable wall is on the north face; escaped debris needs no voxel
    // queries. Probe actual material occupancy so opened chambers remain empty.
    if (p.z - particle.halfDepth > GAME_CONFIG.room.wallFrontZ + 0.08) return false;
    if (this.wall.isSolidAt(p.x, p.y, p.z)) return true;
    for (const x of [-0.86, 0.86]) for (const y of [-0.86, 0.86]) for (const z of [-0.86, 0.86]) {
      if (this.wall.isSolidAt(p.x + particle.halfWidth * x, p.y + particle.halfHeight * y, p.z + particle.halfDepth * z)) return true;
    }
    return false;
  }

  private hasWallSupport(particle: Particle): boolean {
    const p = particle.mesh.position;
    const y = p.y - particle.halfHeight - 0.004;
    return this.wall.isSolidAt(p.x, y, p.z)
      || this.wall.isSolidAt(p.x - particle.halfWidth * 0.7, y, p.z)
      || this.wall.isSolidAt(p.x + particle.halfWidth * 0.7, y, p.z);
  }

  private hasSettledOverlap(particle: Particle): boolean {
    const p=particle.mesh.position, a=this.floorFootprint(particle);
    return this.particles.some(other=>{
      if(other===particle || !other.settled) return false;
      const q=other.mesh.position,b=this.floorFootprint(other);
      return Math.abs(p.x-q.x)<a.x+b.x-.0001 && Math.abs(p.y-q.y)<particle.halfHeight+other.halfHeight-.0001 && Math.abs(p.z-q.z)<a.y+b.y-.0001;
    });
  }

  private supportContact(particle: Particle, maximumCenterY: number): { height: number; particle: Particle | null } {
    let height = particle.halfHeight;
    let supportingParticle: Particle | null = null;
    const footprint = this.floorFootprint(particle);
    for (const other of this.particles) {
      if (other === particle || !other.settled) continue;
      const otherFootprint = this.floorFootprint(other);
      const overlapX = Math.min(particle.mesh.position.x + footprint.x, other.mesh.position.x + otherFootprint.x)
        - Math.max(particle.mesh.position.x - footprint.x, other.mesh.position.x - otherFootprint.x);
      const overlapZ = Math.min(particle.mesh.position.z + footprint.y, other.mesh.position.z + otherFootprint.y)
        - Math.max(particle.mesh.position.z - footprint.y, other.mesh.position.z - otherFootprint.y);
      if (overlapX <= 0 || overlapZ <= 0) continue;
      const coverage = overlapX * overlapZ / Math.max(0.000001, footprint.x * 2 * footprint.y * 2);
      if (coverage < MIN_SUPPORT_COVERAGE) continue;
      const candidate = other.mesh.position.y + other.halfHeight + particle.halfHeight + 0.001;
      if (candidate > maximumCenterY + 0.004 || candidate + particle.halfHeight > MAX_RUBBLE_HEIGHT) continue;
      // A broad supporting face can already have another piece resting on it.
      // Coverage alone must not stack several bodies into the same solid volume.
      const occupied = this.particles.some(obstruction => {
        if (obstruction === particle || obstruction === other || !obstruction.settled) return false;
        if (Math.abs(obstruction.mesh.position.y - candidate) >= obstruction.halfHeight + particle.halfHeight - 0.0001) return false;
        const obstructionFootprint = this.floorFootprint(obstruction);
        return Math.abs(obstruction.mesh.position.x - particle.mesh.position.x) < obstructionFootprint.x + footprint.x - 0.0001
          && Math.abs(obstruction.mesh.position.z - particle.mesh.position.z) < obstructionFootprint.y + footprint.y - 0.0001;
      });
      if (occupied) continue;
      if (candidate > height) {
        height = candidate;
        supportingParticle = other;
      }
    }
    return { height, particle: supportingParticle };
  }

  private releaseDependents(removedSupport: Particle): void {
    const lostSupports: Particle[] = [removedSupport];
    while (lostSupports.length > 0) {
      const lost = lostSupports.pop()!;
      for (const particle of this.particles) {
        if (!particle.settled || particle.support !== lost) continue;
        particle.settled = false;
        particle.support = null;
        particle.wallSupported = false;
        particle.velocity.set(0, -0.05, 0);
        lostSupports.push(particle);
      }
    }
  }

  private placeOnOpenFloor(particle: Particle): void {
    const originX = particle.mesh.position.x;
    const originZ = particle.mesh.position.z;
    const phase = this.particles.indexOf(particle) * GOLDEN_ANGLE;
    const footprint = this.floorFootprint(particle);
    for (let attempt = 0; attempt < 600; attempt += 1) {
      const radius = attempt === 0 ? 0 : 0.018 * Math.sqrt(attempt);
      const angle = phase + attempt * GOLDEN_ANGLE;
      particle.mesh.position.x = originX + Math.cos(angle) * radius;
      particle.mesh.position.z = originZ + Math.sin(angle) * radius;
      if (Math.abs(particle.mesh.position.x) + footprint.x > GAME_CONFIG.room.width / 2
        || particle.mesh.position.z + footprint.y > GAME_CONFIG.room.depth / 2
        || this.overlapsWall(particle)) continue;
      const overlaps = this.particles.some(other => {
        if (other === particle || !other.settled || other.mesh.position.y - other.halfHeight >= particle.halfHeight * 2) return false;
        const otherFootprint = this.floorFootprint(other);
        return Math.abs(other.mesh.position.x - particle.mesh.position.x) < otherFootprint.x + footprint.x + 0.001
          && Math.abs(other.mesh.position.z - particle.mesh.position.z) < otherFootprint.y + footprint.y + 0.001;
      });
      if (!overlaps) return;
    }
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
    while (this.particles.length > MAX_RUBBLE_PIECES || this.transientFragmentCount > MAX_TRANSIENT_PIECES) {
      let index = this.particles.findIndex(particle => particle.transient && particle.settled);
      if (index < 0) index = this.particles.findIndex(particle => particle.transient);
      if (index < 0) index = this.particles.findIndex(particle => particle.settled);
      this.retireParticle(Math.max(0, index));
      this.budgetRetirements += 1;
    }
  }

  private retireParticle(index: number): void {
    const [particle] = this.particles.splice(index, 1);
    this.releaseDependents(particle);
    this.scene.remove(particle.mesh);
    this.totalRetiredVolume += Number(particle.mesh.userData.volume);
    if (particle.ownedGeometry) particle.mesh.geometry.dispose();
    particle.mesh.geometry = pooledPlaceholder;
    particle.mesh.visible = false;
    particle.mesh.userData = {};
    if (this.meshPool.length < MAX_POOLED_MESHES) this.meshPool.push(particle.mesh);
  }
}
