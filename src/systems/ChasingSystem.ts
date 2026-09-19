import * as THREE from 'three';
import { GAME_CONFIG } from '../data/gameConfig';
import type { InstallationPoint } from '../electrical/InstallationPoint';
import type { BrickWall, MasonryImpact } from '../world/BrickWall';
import { splitDebrisGeometry } from './splitDebrisGeometry';

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
  collisionProbes: THREE.Vector3[] | null;
  footprintCache?: { yaw: number; width: number; depth: number; value: THREE.Vector2 };
  wallSupportCache?: { revision: number; pose: number[]; supported: boolean };
  wallOverlapCache?: { revision: number; pose: number[]; overlaps: boolean };
  canonicalGeometry?: THREE.BufferGeometry;
  restPose: { x: number; z: number; halfWidth: number; halfHeight: number; halfDepth: number };
}
type SplitResult = {pieces:Array<{positions:Float32Array;volume:number}>;originalVolume:number};
interface BoundaryJob {
  positions: Float32Array; bits: Uint32Array; cursor: number; removed: Uint8Array; links: Int32Array;
  vertices: Map<number, number[]>; faces: Map<number | string, { direction: number; head: number }>;
  cancelled: number; indices?: Uint16Array | Uint32Array; written: number;
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
  private readonly probePosition = new THREE.Vector3();
  private readonly debrisRay = new THREE.Raycaster();
  private splitWorker: Worker | null = null;
  private splitWorkerFailed = false;
  private splitRequest = 0;
  private readonly pendingSplits = new Map<number,{particle:Particle;impact:MasonryImpact}>();
  private readonly boundaryJobs = new Map<Particle, BoundaryJob>();
  get pendingFragmentRendering(): number { return this.boundaryJobs.size; }
  get renderedFragmentTriangles(): number { return this.particles.reduce((n, p) => n + (p.mesh.geometry.index?.count ?? p.mesh.geometry.getAttribute('position').count) / 3, 0); }
  get canonicalFragmentTriangles(): number { return this.particles.reduce((n, p) => n + (p.canonicalGeometry ?? p.mesh.geometry).getAttribute('position').count / 3, 0); }
  get pendingDebrisSplits():number {return this.pendingSplits.size;}
  async waitForDebrisSplits():Promise<void>{while(this.pendingSplits.size)await new Promise(resolve=>setTimeout(resolve,4));}
  lastSpawnMs = 0;
  maximumSpawnMs = 0;
  lastUpdateMs = 0;
  maximumUpdateMs = 0;
  totalEmittedVolume = 0;
  totalRetiredVolume = 0;
  budgetRetirements = 0;
  peakActiveFragments = 0;
  debrisStrikeCount = 0;
  debrisSplitCount = 0;
  debrisCrushCount = 0;

  constructor(private readonly scene: THREE.Scene, private readonly wall: BrickWall) {}

  hit(camera: THREE.Camera, point: InstallationPoint): boolean {
    if (this.strikeDebris(camera)) return true;
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
    const debris = this.strikeDebris(camera);
    if (debris) return debris;
    const impact = this.wall.removeAtAim(camera, continuing);
    if (!impact) return null;
    this.spawnDebris(impact);
    return impact;
  }

  /** Loose clay still occupies space in front of the tool. Resolve it before
   * drilling the backing behind it, using the same physical shaft as masonry. */
  private strikeDebris(camera: THREE.Camera): MasonryImpact | null {
    if (!this.particles.length) return null;
    const contact = this.wall.contactProvider?.(camera);
    if (!contact) return null;
    const direction = contact.direction.clone().normalize();
    const origin = contact.point.clone().addScaledVector(direction, -.3);
    this.debrisRay.set(origin, direction);this.debrisRay.near = 0;this.debrisRay.far = .302;
    const wallHit = this.wall.volume?.raycast(origin, direction, .302);
    let closest = Math.min(.302, (wallHit?.distance ?? .302) + .002);
    let target: Particle | null = null, point: THREE.Vector3 | null = null;
    for (const particle of this.particles) {
      if (particle.transient || particle.mesh.position.y < .2) continue;
      particle.mesh.updateWorldMatrix(true, false);
      const hits: THREE.Intersection[] = [];
      // The visible index omits only paired internal tetra faces. Tool contact
      // still uses the exact original unindexed solid, including origin-inside
      // contacts, as do subsequent cuts and their conserved-volume ledger.
      const visibleGeometry = particle.mesh.geometry;
      try {
        particle.mesh.geometry = particle.canonicalGeometry ?? visibleGeometry;
        THREE.Mesh.prototype.raycast.call(particle.mesh, this.debrisRay, hits);
      } finally { particle.mesh.geometry = visibleGeometry; }
      for (const hit of hits) if (hit.distance < closest) { closest = hit.distance; target = particle; point = hit.point; }
    }
    if (!target || !point) return null;
    this.debrisStrikeCount++;
    target.mesh.userData.debrisHits=(target.mesh.userData.debrisHits??0)+1;
    const seed = Math.imul(target.mesh.id + 1, 2654435761) >>> 0;
    const impact: MasonryImpact = { points:[point],kind:'demolish-chip',brickSize:new THREE.Vector3(.03,.03,.02),seed,destroyed:false,fragments:[],removedVolume:0,releaseDirection:direction.clone().negate(),releaseEnergyJ:contact.energyJ };
    // Break along the widest remaining dimension. The children contain the
    // parent's real triangles and capped fracture plane, never scaled copies.
    const size = new THREE.Vector3();target.mesh.geometry.computeBoundingBox();target.mesh.geometry.boundingBox!.getSize(size);
    const axis = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z';
    const canSplit=target.ownedGeometry && size[axis]>.035 && Number(target.mesh.userData.volume)>.000008;
    if(target.mesh.userData.debrisHits>=4 && (target.mesh.userData.splitUnsupported || !canSplit)){
      this.crushFragment(target,impact);return impact;
    }
    if(canSplit && typeof Worker!=='undefined' && !this.splitWorkerFailed && !target.mesh.userData.splitUnsupported){
      if(!this.splitWorker){
        this.splitWorker=new Worker(new URL('./debris.worker.ts',import.meta.url),{type:'module'});
        this.splitWorker.onmessage=event=>{
          const {id,result}=event.data as {id:number;result:SplitResult|null},pending=this.pendingSplits.get(id);this.pendingSplits.delete(id);
          if(pending&&this.particles.includes(pending.particle)){
            if(result)this.replaceFragment(pending.particle,pending.impact,result);
            else pending.particle.mesh.userData.splitUnsupported=true;
          }
        };
        this.splitWorker.onerror=()=>{this.splitWorkerFailed=true;this.splitWorker?.terminate();this.splitWorker=null;this.pendingSplits.clear();};
      }
      if(this.pendingSplits.size<2&&![...this.pendingSplits.values()].some(item=>item.particle===target)){
        const id=++this.splitRequest,positions=new Float32Array(target.mesh.geometry.getAttribute('position').array);
        this.pendingSplits.set(id,{particle:target,impact});this.splitWorker.postMessage({id,positions},[positions.buffer]);
      }
      return impact;
    }
    const split = canSplit
      ? splitDebrisGeometry(target.canonicalGeometry ?? target.mesh.geometry, axis) : null;
    if (split) {
      this.replaceFragment(target,impact,{originalVolume:split.originalVolume,pieces:split.pieces.map(piece=>{const positions=new Float32Array(piece.geometry.getAttribute('position').array);piece.geometry.dispose();return{positions,volume:piece.volume}})});
    } else {
      this.releaseDependents(target);target.settled=false;target.wallSupported=false;target.support=null;
      const speed=Math.sqrt(2*Math.max(0,contact.energyJ)*.12/Math.max(.001,Number(target.mesh.userData.massKg)));
      target.velocity.copy(direction).multiplyScalar(-Math.min(2,speed));target.angularVelocity.set(0,0,0);
    }
    return impact;
  }

  private replaceFragment(target:Particle,impact:MasonryImpact,split:SplitResult):void {
    this.debrisSplitCount++;
    const volume=Number(target.mesh.userData.volume),material=materialNames.indexOf(target.mesh.userData.material);
    const orientation=target.mesh.quaternion.clone();
    for(const piece of split.pieces){
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(piece.positions,3));geometry.computeBoundingBox();
      const extent=geometry.boundingBox!.getSize(new THREE.Vector3());
      impact.fragments.push({position:target.mesh.position.clone(),size:extent,material,volume:volume*piece.volume/split.originalVolume,detached:true,positions:new Float32Array(geometry.getAttribute('position').array)});geometry.dispose();
    }
    this.retireParticle(this.particles.indexOf(target),false);this.spawnDebris(impact,orientation);
    // Fragmentation transfers existing debris; it removes no extra wall mass.
    this.totalEmittedVolume-=volume;
  }

  /** Repeated blows crush a lodged chip if a safe plate cut is unavailable.
   * These angular fines represent the existing material, like crushed fines
   * from the wall core; no ambiguous mesh becomes permanently invulnerable. */
  private crushFragment(target:Particle,impact:MasonryImpact):void {
    const volume=Number(target.mesh.userData.volume),material=materialNames.indexOf(target.mesh.userData.material);
    const count=Math.min(32,Math.max(4,Math.ceil(volume/.0000015))),chipVolume=volume/count,random=seeded(impact.seed);
    const shape=new THREE.TetrahedronGeometry(1),attribute=shape.getAttribute('position');let unitVolume=0;
    const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
    for(let i=0;i<attribute.count;i+=3){a.fromBufferAttribute(attribute,i);b.fromBufferAttribute(attribute,i+1);c.fromBufferAttribute(attribute,i+2);unitVolume+=a.dot(b.cross(c))/6;}
    const scale=Math.cbrt(chipVolume/Math.abs(unitVolume));shape.scale(scale,scale,scale);shape.computeBoundingBox();
    const size=shape.boundingBox!.getSize(new THREE.Vector3()),positions=new Float32Array(shape.getAttribute('position').array);
    for(let i=0;i<count;i++){
      const probes=target.collisionProbes,local=probes?.length?probes[Math.floor(random()*probes.length)].clone():new THREE.Vector3();
      const position=local.applyQuaternion(target.mesh.quaternion).add(target.mesh.position);
      impact.fragments.push({position,size,material,volume:chipVolume,detached:false,positions});
    }
    shape.dispose();this.debrisCrushCount++;
    this.retireParticle(this.particles.indexOf(target),false);this.spawnDebris(impact,undefined,true);this.totalEmittedVolume-=volume;
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

  private spawnDebris(impact: MasonryImpact, orientation?:THREE.Quaternion, crushed = false): void {
    const started = performance.now();
    const random = seeded(impact.seed);
    const firstNewParticle = this.particles.length;
    const release = impact.releaseDirection ?? { x: 0, y: 0, z: 1 };
    const releaseDirection = new THREE.Vector3(release.x, release.y, release.z).normalize();
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
        const { geometry, center, size } = this.prepareFragmentGeometry(source.positions!);
        width = size.x; height = size.y; depth = size.z;
        // Keep fracture planes in local coordinates between repeated cuts.
        // Baking every body rotation into Float32 vertices erodes cap topology.
        if(orientation){center.applyQuaternion(orientation);fragment.quaternion.copy(orientation);}
        fragment.position.add(center);
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
      const span = Math.max(width, height, depth);
      // Thin shell plates can span several centimetres without the volume of a
      // solid cube. Their actual geometry, not volume alone, determines fines.
      const plate = source.detached || span >= .04;
      const transient = !plate && source.volume < 0.000008;
      fragment.name = source.detached ? 'Detached masonry island' : 'Crushed masonry chip';
      fragment.userData = {
        volume: source.volume, material: materialNames[source.material],
        massKg: source.volume * materialDensities[source.material],
        detached: source.detached, actualFractureGeometry: actualGeometry && !crushed, crushed,
      };
      fragment.visible = true;
      fragment.castShadow = true;
      fragment.receiveShadow = true;
      fragment.raycast = () => undefined;
      this.scene.add(fragment);
      const speed = plate ? 1.05 : .35;
      const spin = plate ? 2.2 : 7;
      // Brittle chips can enter the exposed chamber instead of all ejecting
      // toward the operator. Their birth location stays at the removed solid.
      // Opened shell plates mostly release toward the free wall face. Small
      // crushed chips can still fall into the chambers and rest on their webs.
      const inward = random() < (plate ? .08 : .42);
      fragment.userData.inward = inward;
      const velocity = releaseDirection.clone().multiplyScalar((inward ? -1 : 1) * speed * (.8 + random() * .8));
      velocity.x += (random() - .5) * speed * .25;
      velocity.y += (random() - .6) * speed * .1;
      this.particles.push({
        mesh: fragment,
        velocity,
        angularVelocity: new THREE.Vector3((random() - 0.5) * spin, (random() - 0.5) * spin, (random() - 0.5) * spin),
        life: transient ? 2.5 + random() * 1.5 : plate ? 100 + random() * 30 : 65 + random() * 20,
        halfWidth: width * 0.5,
        halfHeight: height * 0.5,
        halfDepth: depth * 0.5,
        settled: false,
        support: null,
        wallSupported: false,
        ownedGeometry: actualGeometry,
        transient,
        collisionProbes: actualGeometry ? this.geometryCollisionProbes(fragment.geometry) : null,
        restPose: depth < Math.min(width, height)
          ? { x: Math.PI / 2, z: 0, halfWidth: width / 2, halfHeight: depth / 2, halfDepth: height / 2 }
          : width < height
            ? { x: 0, z: Math.PI / 2, halfWidth: height / 2, halfHeight: width / 2, halfDepth: depth / 2 }
            : { x: 0, z: 0, halfWidth: width / 2, halfHeight: height / 2, halfDepth: depth / 2 },
      });
      if (actualGeometry && fragment.geometry.getAttribute('position').count > 72) {
        const positions = fragment.geometry.getAttribute('position').array as Float32Array, triangles = positions.length / 9;
        this.boundaryJobs.set(this.particles[this.particles.length - 1], {
          positions, bits: new Uint32Array(positions.buffer, positions.byteOffset, positions.length), cursor: 0,
          removed: new Uint8Array(triangles), links: new Int32Array(triangles).fill(-1),
          vertices: new Map(), faces: new Map(), cancelled: 0, written: 0,
        });
      }
      this.totalEmittedVolume += source.volume;
    }
    // Reserve only a fraction of this blow for ALL emitted bodies together.
    // Bigger releases divide the same impulse budget instead of giving every
    // new plate another complete hammer blow's energy.
    const kineticBudget = Math.max(0, impact.releaseEnergyJ ?? 4) * .12;
    let kineticEnergy = 0;
    for (let i = firstNewParticle; i < this.particles.length; i++) {
      const p = this.particles[i], mass = Number(p.mesh.userData.massKg), w = p.angularVelocity;
      const rotation = mass / 6 * ((p.halfHeight ** 2 + p.halfDepth ** 2) * w.x ** 2 + (p.halfWidth ** 2 + p.halfDepth ** 2) * w.y ** 2 + (p.halfWidth ** 2 + p.halfHeight ** 2) * w.z ** 2);
      kineticEnergy += mass * p.velocity.lengthSq() * .5 + rotation;
    }
    const velocityScale = kineticEnergy > kineticBudget ? Math.sqrt(kineticBudget / kineticEnergy) : 1;
    for (let i = firstNewParticle; i < this.particles.length; i++) {
      this.particles[i].velocity.multiplyScalar(velocityScale);
      this.particles[i].angularVelocity.multiplyScalar(velocityScale);
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
        // A free rotation may sweep clay into a surviving web. Previously that
        // penetration trapped every subsequent translation, leaving a floating
        // piece. Keep only collision-free rotational increments.
        for (const axis of ['x','y','z'] as const) {
          if(Math.abs(particle.angularVelocity[axis])<1e-5)continue;
          const before=particle.mesh.rotation[axis];
          particle.mesh.rotation[axis]+=particle.angularVelocity[axis]*elapsed;
          if(this.overlapsWall(particle)){particle.mesh.rotation[axis]=before;particle.angularVelocity[axis]*=-.12;}
        }
        let contact = this.supportContact(particle, previousY);
        if (!particle.settled && particle.mesh.position.y <= contact.height) {
          // Rubble comes to rest on a broad face. This gives every settled piece a
          // stable solid footprint instead of leaving arbitrarily rotated meshes interpenetrating.
          // Apply the random floor yaw after laying the broad face flat. XYZ
          // order would tilt that face again while claiming its thin height.
          particle.mesh.rotation.set(particle.restPose.x, particle.mesh.rotation.y, particle.restPose.z, 'YXZ');
          particle.halfWidth = particle.restPose.halfWidth;
          particle.halfHeight = particle.restPose.halfHeight;
          particle.halfDepth = particle.restPose.halfDepth;
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

  /** Incremental render-only cancellation of exactly coincident, oppositely
   * wound tetra faces. No weld tolerance, exterior simplification or synchronous
   * spawn scan; the presenter shares one small budget across all fragments. */
  flushFragmentRendering(triangleLimit = 256, budgetMs = .5): number {
    const start = performance.now(); let processed = 0;
    while (processed < triangleLimit && this.boundaryJobs.size) {
      const [particle, job] = this.boundaryJobs.entries().next().value!;
      const triangleCount = job.removed.length;
      if (job.indices) {
        while (job.cursor < triangleCount && processed < triangleLimit) {
          const triangle = job.cursor++; processed++;
          if (!job.removed[triangle]) { const vertex = triangle * 3; job.indices[job.written++] = vertex; job.indices[job.written++] = vertex + 1; job.indices[job.written++] = vertex + 2; }
          if (processed % 32 === 0 && performance.now() - start >= budgetMs) return processed;
        }
        if (job.cursor === triangleCount) {
          const geometry = particle.mesh.geometry, canonical = new THREE.BufferGeometry();
          // Attributes remain shared and untouched; the canonical geometry never
          // enters the renderer and therefore owns no duplicate GPU buffers.
          for (const name of Object.keys(geometry.attributes)) canonical.setAttribute(name, geometry.getAttribute(name));
          canonical.boundingBox = geometry.boundingBox?.clone() ?? null;
          canonical.boundingSphere = geometry.boundingSphere?.clone() ?? null;
          particle.canonicalGeometry = canonical;
          geometry.setIndex(new THREE.BufferAttribute(job.indices, 1));
          this.boundaryJobs.delete(particle);
        }
      } else {
        while (job.cursor < triangleCount && processed < triangleLimit) {
          this.cancelInternalFace(job, job.cursor++); processed++;
          if (processed % 32 === 0 && performance.now() - start >= budgetMs) return processed;
        }
        if (job.cursor === triangleCount) {
          if (!job.cancelled) this.boundaryJobs.delete(particle);
          else {
            const count = (triangleCount - job.cancelled) * 3;
            job.indices = job.positions.length / 3 > 65535 ? new Uint32Array(count) : new Uint16Array(count);
            job.cursor = 0; job.vertices.clear(); job.faces.clear();
          }
        }
      }
      if (performance.now() - start >= budgetMs) break;
    }
    return processed;
  }

  private cancelInternalFace(job: BoundaryJob, triangle: number): void {
    const p = job.positions, bits = job.bits, ids = [0, 0, 0];
    for (let corner = 0; corner < 3; corner++) {
      const offset = triangle * 9 + corner * 3;
      const hash = (Math.imul(p[offset] === 0 ? 0 : bits[offset], 73856093)
        ^ Math.imul(p[offset + 1] === 0 ? 0 : bits[offset + 1], 19349663)
        ^ Math.imul(p[offset + 2] === 0 ? 0 : bits[offset + 2], 83492791)) >>> 0;
      let bucket = job.vertices.get(hash), id = -1;
      if (bucket) for (const candidate of bucket) {
        const other = candidate * 3;
        if (p[other] === p[offset] && p[other + 1] === p[offset + 1] && p[other + 2] === p[offset + 2]) { id = candidate; break; }
      }
      else { bucket = []; job.vertices.set(hash, bucket); }
      if (id < 0) { id = offset / 3; bucket!.push(id); }
      ids[corner] = id;
    }
    // Repeated vertices describe a zero-area face. Keeping it is conservative.
    if (ids[0] === ids[1] || ids[0] === ids[2] || ids[1] === ids[2]) return;
    const direction = ((ids[0] > ids[1] ? 1 : 0) + (ids[0] > ids[2] ? 1 : 0) + (ids[1] > ids[2] ? 1 : 0)) % 2 ? -1 : 1;
    ids.sort((a, b) => a - b);
    const base = p.length / 3 + 1;
    const key = base < 200000 ? ids[0] + ids[1] * base + ids[2] * base * base : ids.join(',');
    const face = job.faces.get(key);
    if (!face) job.faces.set(key, { direction, head: triangle });
    else if (face.direction === direction) { job.links[triangle] = face.head; face.head = triangle; }
    else {
      job.removed[triangle] = 1; job.removed[face.head] = 1; job.cancelled += 2;
      face.head = job.links[face.head];
      if (face.head < 0) job.faces.delete(key);
    }
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
        // Touching the lower web stops the downward component, not an ongoing
        // outward release. Otherwise plates sleep on the first shelf within a
        // frame of birth and never get the chance to clear the wall opening.
        if (Math.hypot(particle.velocity.x, particle.velocity.z) > .025) {
          particle.velocity.y = 0;
          particle.velocity.x *= .985;
          particle.velocity.z *= .985;
          continue;
        }
        // A floor footprint is a conservative rectangle, not the solid outline
        // of a concave wall fragment. Treating overlapping rectangles as a
        // failed rest injected new sideways velocity forever. A chamber rest
        // is established by the actual wall contact above; floor stacking keeps
        // its separate footprint/coverage and overlap checks.
        particle.settled = true;
        particle.wallSupported = true;
        particle.support = null;
        particle.velocity.set(0, 0, 0);
        particle.angularVelocity.set(0, 0, 0);
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
    // Escaped debris needs neither wall samples nor pose-cache bookkeeping.
    const radius = Math.hypot(particle.halfWidth, particle.halfHeight, particle.halfDepth);
    if (p.z - radius > GAME_CONFIG.room.wallFrontZ + 0.08) return false;
    // Sliding/rebounding fragments often test the identical pose on successive
    // axes. Reuse that exact occupancy result until pose or masonry changes.
    const revision = this.wall.volume?.surfaceRevision;
    if (typeof revision !== 'number') return this.queryWallOverlap(particle);
    const q = particle.mesh.quaternion;
    const cache = particle.wallOverlapCache;
    if (cache && cache.revision === revision
      && cache.pose[0] === p.x && cache.pose[1] === p.y && cache.pose[2] === p.z
      && cache.pose[3] === q.x && cache.pose[4] === q.y && cache.pose[5] === q.z && cache.pose[6] === q.w
      && cache.pose[7] === particle.halfWidth && cache.pose[8] === particle.halfHeight && cache.pose[9] === particle.halfDepth) return cache.overlaps;
    const overlaps = this.queryWallOverlap(particle), pose = cache?.pose ?? [];
    pose[0] = p.x; pose[1] = p.y; pose[2] = p.z; pose[3] = q.x; pose[4] = q.y; pose[5] = q.z; pose[6] = q.w;
    pose[7] = particle.halfWidth; pose[8] = particle.halfHeight; pose[9] = particle.halfDepth;
    if (cache) { cache.revision = revision; cache.overlaps = overlaps; }
    else particle.wallOverlapCache = { revision, pose, overlaps };
    return overlaps;
  }

  private queryWallOverlap(particle: Particle): boolean {
    const p = particle.mesh.position;
    if (particle.collisionProbes) {
      // A hollow/irregular plate's bounding-box centre and corners may contain
      // no clay at all. Using those points pins an already detached piece into
      // surrounding intact webs. Probe only its real triangles, in its pose.
      for (const local of particle.collisionProbes) {
        this.probePosition.copy(local).applyQuaternion(particle.mesh.quaternion).add(p);
        if (this.wall.isSolidAt(this.probePosition.x, this.probePosition.y, this.probePosition.z)) return true;
      }
      return false;
    }
    if (this.wall.isSolidAt(p.x, p.y, p.z)) return true;
    for (const x of [-0.86, 0.86]) for (const y of [-0.86, 0.86]) for (const z of [-0.86, 0.86]) {
      if (this.wall.isSolidAt(p.x + particle.halfWidth * x, p.y + particle.halfHeight * y, p.z + particle.halfDepth * z)) return true;
    }
    return false;
  }

  private geometryCollisionProbes(geometry: THREE.BufferGeometry): THREE.Vector3[] {
    const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
    const probes: THREE.Vector3[] = [];
    const triangles = positions.count / 3, stride = Math.max(1, Math.ceil(triangles / 48));
    for (let triangle = 0; triangle < triangles; triangle += stride) {
      const i = triangle * 3;
      const center = new THREE.Vector3(
        (positions.getX(i) + positions.getX(i + 1) + positions.getX(i + 2)) / 3,
        (positions.getY(i) + positions.getY(i + 1) + positions.getY(i + 2)) / 3,
        (positions.getZ(i) + positions.getZ(i + 1) + positions.getZ(i + 2)) / 3,
      );
      center.addScaledVector(new THREE.Vector3().fromBufferAttribute(normals, i), -.0001);
      probes.push(center);
    }
    // Keep the actual extremities even when the mesh needs decimation for the
    // collision-query budget. No bounding-box corner is manufactured here.
    const extrema = [0, 0, 0, 0, 0, 0], values = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
    const array = positions.array;
    for (let i = 0; i < positions.count; i++) for (let axis = 0; axis < 3; axis++) {
      const value = array[i * 3 + axis], offset = axis * 2;
      if (value < values[offset]) { values[offset] = value; extrema[offset] = i; }
      if (value > values[offset + 1]) { values[offset + 1] = value; extrema[offset + 1] = i; }
    }
    for (const best of extrema) {
      // A corner is simultaneously on several fracture planes. Offsetting it
      // along only one face normal can leave it inside the neighbouring wall's
      // other plane. The incident triangle interior has an unambiguous side.
      const i = Math.floor(best / 3) * 3;
      probes.push(new THREE.Vector3(
        (positions.getX(i) + positions.getX(i + 1) + positions.getX(i + 2)) / 3,
        (positions.getY(i) + positions.getY(i + 1) + positions.getY(i + 2)) / 3,
        (positions.getZ(i) + positions.getZ(i + 1) + positions.getZ(i + 2)) / 3,
      ).addScaledVector(new THREE.Vector3().fromBufferAttribute(normals, i), -.0001));
    }
    return probes;
  }

  /** Prepare an unindexed fracture mesh without the repeated full-buffer scans
   * in translate -> bounding box -> normals -> normalize -> bounding sphere.
   * Each triangle still has the same Float32 positions and flat face normal. */
  private prepareFragmentGeometry(source: Float32Array): { geometry: THREE.BufferGeometry; center: THREE.Vector3; size: THREE.Vector3 } {
    const geometry = new THREE.BufferGeometry(), positions = source.slice();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.computeBoundingBox();
    const center = geometry.boundingBox!.getCenter(new THREE.Vector3()), size = geometry.boundingBox!.getSize(new THREE.Vector3());
    const min = geometry.boundingBox!.min, max = geometry.boundingBox!.max;
    min.set(Infinity, Infinity, Infinity); max.set(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] -= center.x; positions[i + 1] -= center.y; positions[i + 2] -= center.z;
      // Bounds must use rounded positions, just as BufferGeometry.translate does.
      min.x = Math.min(min.x, positions[i]); min.y = Math.min(min.y, positions[i + 1]); min.z = Math.min(min.z, positions[i + 2]);
      max.x = Math.max(max.x, positions[i]); max.y = Math.max(max.y, positions[i + 1]); max.z = Math.max(max.z, positions[i + 2]);
    }
    const normals = new Float32Array(positions.length), sphereCenter = geometry.boundingBox!.getCenter(new THREE.Vector3());
    let radiusSquared = 0;
    for (let i = 0; i < positions.length; i += 9) {
      const cbx = positions[i + 6] - positions[i + 3], cby = positions[i + 7] - positions[i + 4], cbz = positions[i + 8] - positions[i + 5];
      const abx = positions[i] - positions[i + 3], aby = positions[i + 1] - positions[i + 4], abz = positions[i + 2] - positions[i + 5];
      // Three stores the cross product into Float32 before normalizing it.
      const nx = Math.fround(cby * abz - cbz * aby), ny = Math.fround(cbz * abx - cbx * abz), nz = Math.fround(cbx * aby - cby * abx);
      const inverseLength = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
      for (let vertex = i; vertex < i + 9; vertex += 3) {
        normals[vertex] = nx * inverseLength; normals[vertex + 1] = ny * inverseLength; normals[vertex + 2] = nz * inverseLength;
        const dx = positions[vertex] - sphereCenter.x, dy = positions[vertex + 1] - sphereCenter.y, dz = positions[vertex + 2] - sphereCenter.z;
        radiusSquared = Math.max(radiusSquared, dx * dx + dy * dy + dz * dz);
      }
    }
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.boundingSphere = new THREE.Sphere(sphereCenter, Math.sqrt(radiusSquared));
    return { geometry, center, size };
  }

  private hasWallSupport(particle: Particle): boolean {
    // Settled clay cannot lose support until either it or the editable wall
    // changes. Re-reading all its triangle attributes every physics step adds
    // work proportional to the rubble left inside the chase, even at rest.
    const revision = this.wall.volume?.surfaceRevision;
    if (particle.settled && typeof revision === 'number') {
      const p = particle.mesh.position, q = particle.mesh.quaternion;
      const cache = particle.wallSupportCache;
      if (cache && cache.revision === revision
        && cache.pose[0] === p.x && cache.pose[1] === p.y && cache.pose[2] === p.z
        && cache.pose[3] === q.x && cache.pose[4] === q.y && cache.pose[5] === q.z && cache.pose[6] === q.w
        && cache.pose[7] === particle.halfWidth && cache.pose[8] === particle.halfHeight) return cache.supported;
      const supported = this.queryWallSupport(particle);
      particle.wallSupportCache = { revision, pose: [p.x, p.y, p.z, q.x, q.y, q.z, q.w, particle.halfWidth, particle.halfHeight], supported };
      return supported;
    }
    return this.queryWallSupport(particle);
  }

  private queryWallSupport(particle: Particle): boolean {
    const p = particle.mesh.position;
    if(particle.collisionProbes){
      const positions=particle.mesh.geometry.getAttribute('position'),normals=particle.mesh.geometry.getAttribute('normal');
      const triangles=positions.count/3,stride=Math.max(1,Math.ceil(triangles/48));
      const normal=new THREE.Vector3();
      for(let triangle=0;triangle<triangles;triangle+=stride){
        const i=triangle*3;normal.fromBufferAttribute(normals,i).applyQuaternion(particle.mesh.quaternion);
        if(normal.y>-.45)continue;
        this.probePosition.set((positions.getX(i)+positions.getX(i+1)+positions.getX(i+2))/3,(positions.getY(i)+positions.getY(i+1)+positions.getY(i+2))/3,(positions.getZ(i)+positions.getZ(i+1)+positions.getZ(i+2))/3).applyQuaternion(particle.mesh.quaternion).add(p);
        this.probePosition.y-=.004;
        if(this.wall.isSolidAt(this.probePosition.x,this.probePosition.y,this.probePosition.z))return true;
      }
      // The same real triangle samples that stop downward motion must also
      // recognise support on narrow webs and irregular chamber ledges.
      for(const probe of particle.collisionProbes){
        this.probePosition.copy(probe).applyQuaternion(particle.mesh.quaternion).add(p);
        if(this.wall.isSolidAt(this.probePosition.x,this.probePosition.y,this.probePosition.z))continue;
        this.probePosition.y-=.004;
        if(this.wall.isSolidAt(this.probePosition.x,this.probePosition.y,this.probePosition.z))return true;
      }
      return false;
    }
    const y = p.y - particle.halfHeight - 0.004;
    return this.wall.isSolidAt(p.x, y, p.z)
      || this.wall.isSolidAt(p.x - particle.halfWidth * 0.7, y, p.z)
      || this.wall.isSolidAt(p.x + particle.halfWidth * 0.7, y, p.z);
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
    const yaw = particle.mesh.rotation.y, width = particle.halfWidth, depth = particle.halfDepth;
    const cache = particle.footprintCache;
    if (cache && cache.yaw === yaw && cache.width === width && cache.depth === depth) return cache.value;
    const cosine = Math.abs(Math.cos(particle.mesh.rotation.y));
    const sine = Math.abs(Math.sin(particle.mesh.rotation.y));
    const value = cache?.value ?? new THREE.Vector2();
    value.set(
      particle.halfWidth * cosine + particle.halfDepth * sine,
      particle.halfWidth * sine + particle.halfDepth * cosine,
    );
    particle.footprintCache = { yaw, width, depth, value };
    return value;
  }

  private trimRubbleBudget(): void {
    while (this.particles.length > MAX_RUBBLE_PIECES || this.transientFragmentCount > MAX_TRANSIENT_PIECES) {
      let index = this.particles.findIndex(particle => particle.transient && particle.settled);
      if (index < 0) index = this.particles.findIndex(particle => particle.transient);
      if (index < 0) {
        // Keep the larger plates in the visible rubble mix when many newer
        // chips arrive. The hard body budget and volume ledger remain intact.
        let smallest = Infinity;
        for (let i = 0; i < this.particles.length; i++) {
          const particle = this.particles[i], volume = Number(particle.mesh.userData.volume);
          if (particle.settled && volume < smallest) { index = i; smallest = volume; }
        }
      }
      this.retireParticle(Math.max(0, index));
      this.budgetRetirements += 1;
    }
  }

  private retireParticle(index: number, accountRetirement = true): void {
    const [particle] = this.particles.splice(index, 1);
    this.boundaryJobs.delete(particle);
    this.releaseDependents(particle);
    this.scene.remove(particle.mesh);
    if(accountRetirement)this.totalRetiredVolume += Number(particle.mesh.userData.volume);
    if (particle.ownedGeometry) particle.mesh.geometry.dispose();
    particle.canonicalGeometry?.dispose();
    particle.mesh.geometry = pooledPlaceholder;
    particle.mesh.visible = false;
    particle.mesh.userData = {};
    if (this.meshPool.length < MAX_POOLED_MESHES) this.meshPool.push(particle.mesh);
  }
}
