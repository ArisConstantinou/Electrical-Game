import * as THREE from 'three';
import type { InstallationPoint } from '../electrical/InstallationPoint';
import type { BrickWall } from '../world/BrickWall';

type WaterCell = { pore: number; film: number; mesh: THREE.Mesh; position: THREE.Vector3; normal: THREE.Vector3 };
type Clod = { mesh: THREE.Mesh; velocity: THREE.Vector3; mass: number; age: number; contacts: number };
type Deposit = { position: THREE.Vector3; radius: number; mass: number; mesh: THREE.Mesh; age: number; normal: THREE.Vector3; support: number };
type Contact = { point: THREE.Vector3; normal: THREE.Vector3; distance: number; box: boolean };
type Opening = { inverse: THREE.Matrix4; halfWidth: number; halfHeight: number };
const Z = new THREE.Vector3(0, 0, 1);
const DENSITY = 1900;
const MAX_PATCHES = 256;
const MAX_WATER = 240;
const MAX_VERTICES = 600000;

/** Qualitative wet mortar: finite mass, real surface contact and accelerated setting.
 * See docs/MORTAR_APPLICATION_RESEARCH.md; these coefficients are not calibrated. */
export class MortarSystem {
  readonly group = new THREE.Group();
  readonly water = new Map<string, WaterCell>();
  readonly deposits: Deposit[] = [];
  readonly projectiles: Clod[] = [];
  readonly target = new THREE.Mesh(new THREE.RingGeometry(.023, .028, 24), new THREE.MeshBasicMaterial({ color: 0xe6cc76, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: .85 }));
  readonly jet = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xbce8ed, transparent: true, opacity: .65 }));
  angleDegrees = 12;
  charge = 0;
  recovery = 0;
  launchedMass = 0;
  stuckMass = 0;
  floorMass = 0;
  restingMass = 0;
  lastOutcome = 'Dampen clean masonry, then hold and release to cast.';
  private readonly settled: THREE.Mesh[] = [];
  private readonly resting: Array<{ mesh: THREE.Mesh; mass: number }> = [];
  private readonly mortarMaterial = new THREE.MeshStandardMaterial({ color: 0x817969, roughness: .94, flatShading: false, side: THREE.DoubleSide });
  private readonly clodGeometry = new THREE.IcosahedronGeometry(1, 1);
  private readonly wetGeometry = new THREE.PlaneGeometry(.125, .125);
  private readonly wetMaterial: THREE.MeshBasicMaterial;
  private readonly ray = new THREE.Raycaster();
  private wasHeld = false;
  private jetTime = 0;
  private maintenanceTime = 0;
  private simulationTime = 0;
  private geometryRevision = 0;
  private openingSignature = '';
  private readonly coverageCache = new Map<string, { time: number; revision: number; transform: string; value: number }>();
  private readonly streams: Array<{ mesh: THREE.Mesh; speed: number; life: number }> = [];

  constructor(scene: THREE.Scene, private readonly wall: BrickWall, private readonly points: InstallationPoint[]) {
    this.group.name = 'Wet mortar, water and construction spills';
    this.group.userData.studioEntityId = 'mortar-application';
    scene.add(this.group); this.group.add(this.target, this.jet);
    this.target.visible = false; this.target.renderOrder = 8; this.jet.visible = false;
    // Soft, irregular alpha footprint; individual water samples never draw square tiles.
    const size = 64, data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = (x + .5) / size * 2 - 1, v = (y + .5) / size * 2 - 1;
      const theta = Math.atan2(v, u), radius = Math.hypot(u, v);
      const edge = .78 + .09 * Math.sin(theta * 5) + .045 * Math.sin(theta * 11);
      const alpha = THREE.MathUtils.clamp((edge - radius) * 4, 0, 1);
      const i = (y * size + x) * 4; data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = Math.round(alpha * 255);
    }
    const texture = new THREE.DataTexture(data, size, size); texture.needsUpdate = true;
    this.wetMaterial = new THREE.MeshBasicMaterial({ color: 0x302d22, map: texture, transparent: true, opacity: .2, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide });
    this.mortarMaterial.onBeforeCompile = shader => {
      shader.vertexShader = 'varying vec3 mortarWorld;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n mortarWorld = (modelMatrix * vec4(position, 1.0)).xyz;');
      shader.fragmentShader = 'varying vec3 mortarWorld;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n float grain=fract(sin(dot(floor(mortarWorld*1600.0),vec3(127.1,311.7,74.7)))*43758.5453); diffuseColor.rgb*=.88+grain*.22;');
    };
  }

  /** Smooth the visible mortar skin while keeping every collision triangle intact. */
  private finishGeometry(geometry:THREE.BufferGeometry):void {
    geometry.computeVertexNormals();geometry.computeBoundingSphere();
    const p=geometry.getAttribute('position'),n=geometry.getAttribute('normal');
    const sums=new Map<string,THREE.Vector3>(),keys:string[]=[];
    for(let i=0;i<p.count;i++){
      const key=`${Math.round(p.getX(i)*1e5)}:${Math.round(p.getY(i)*1e5)}:${Math.round(p.getZ(i)*1e5)}`;keys.push(key);
      let sum=sums.get(key);if(!sum){sum=new THREE.Vector3();sums.set(key,sum);}sum.x+=n.getX(i);sum.y+=n.getY(i);sum.z+=n.getZ(i);
    }
    for(const sum of sums.values())sum.normalize();
    for(let i=0;i<p.count;i++){const sum=sums.get(keys[i])!;n.setXYZ(i,sum.x,sum.y,sum.z);}
  }
  ready(point:InstallationPoint):boolean {this.refreshOpeningGeometry();return this.evaluateCoverage(point,true)>=.68;}
  cancel(): void { this.wasHeld = false; this.charge = 0; }
  swing(held: boolean, dt: number, camera: THREE.Camera, origin: THREE.Vector3): void {
    if (this.recovery > 0) { this.cancel(); return; }
    if (held) { this.wasHeld = true; this.charge = Math.min(1, this.charge + dt / .95); }
    else if (this.wasHeld) { this.launch(origin, this.velocity(camera, this.charge)); this.recovery = .65; this.cancel(); }
  }
  velocity(camera: THREE.Camera, power: number): THREE.Vector3 {
    const direction = camera.getWorldDirection(new THREE.Vector3());
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
    return direction.applyAxisAngle(right, THREE.MathUtils.degToRad(this.angleDegrees)).multiplyScalar(2 + THREE.MathUtils.clamp(power, 0, 1) * 6);
  }
  preview(camera: THREE.Camera, origin: THREE.Vector3, visible: boolean): void {
    this.target.visible = false; if (!visible) return;
    const p = origin.clone(), v = this.velocity(camera, this.wasHeld ? this.charge : .25);
    for (let i = 0; i < 100; i++) {
      const next = p.clone().addScaledVector(v, .025); next.y -= .5 * 9.81 * .025 ** 2;
      const d = next.clone().sub(p), hit = this.contact(p, d.clone().normalize(), d.length());
      if (hit) { this.target.position.copy(hit.point).addScaledVector(hit.normal, .003); this.target.quaternion.setFromUnitVectors(Z, hit.normal); this.target.visible = true; return; }
      if (next.y < .012) { this.target.position.set(next.x, .014, next.z); this.target.quaternion.setFromUnitVectors(Z, new THREE.Vector3(0, 1, 0)); this.target.visible = true; return; }
      p.copy(next); v.y -= 9.81 * .025;
    }
  }

  private waterKey(p: THREE.Vector3): string { return `${Math.round(p.x / .08)}:${Math.round(p.y / .08)}:${Math.round(p.z / .04)}`; }
  wet(camera: THREE.Camera, origin: THREE.Vector3, dt: number): void {
    const direction = camera.getWorldDirection(new THREE.Vector3());
    const cameraOrigin = camera.getWorldPosition(new THREE.Vector3());
    const aim = this.contact(cameraOrigin, direction, 3); if (!aim) return;
    const nozzleDirection = aim.point.clone().sub(origin);
    const hit = this.contact(origin, nozzleDirection.clone().normalize(), nozzleDirection.length() + .01);
    if (!hit || hit.box) return;
    this.jet.geometry.dispose(); this.jet.geometry = new THREE.BufferGeometry().setFromPoints([origin, hit.point]); this.jetTime = .08; this.jet.visible = true;
    const tangent = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Z, hit.normal));
    const up = new THREE.Vector3().crossVectors(hit.normal, tangent).normalize();
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const candidate = hit.point.clone().addScaledVector(tangent, dx * .065).addScaledVector(up, dy * .065);
      const sprayDirection = candidate.sub(origin);
      const local = this.contact(origin, sprayDirection.clone().normalize(), sprayDirection.length() + .06);
      if (!local || local.box || this.insideBox(local.point)) continue;
      const key = this.waterKey(local.point); let cell = this.water.get(key);
      if (!cell) {
        if (this.water.size >= MAX_WATER) continue;
        const geometry = this.waterFootprint(local.point, local.normal, origin);
        if (!geometry.getAttribute('position').count) { geometry.dispose(); continue; }
        const mesh = new THREE.Mesh(geometry, this.wetMaterial.clone()); mesh.position.copy(local.point).addScaledVector(local.normal, .0015);
        mesh.quaternion.setFromUnitVectors(Z, local.normal); this.group.add(mesh);
        cell = { pore: 0, film: 0, mesh, position: local.point.clone(), normal: local.normal.clone() }; this.water.set(key, cell);
      }
      const dose = Math.max(0, dt) * .95 / (1 + dx * dx + dy * dy), absorbed = Math.min(1 - cell.pore, dose * .85);
      cell.pore += absorbed; cell.film = Math.min(1, cell.film + Math.max(0, dose - absorbed) * 4);
    }
  }
  /** A spray footprint contains only exposed first-hit triangles, not an air-spanning plane. */
  private waterFootprint(point: THREE.Vector3, normal: THREE.Vector3, origin: THREE.Vector3): THREE.BufferGeometry {
    const rotation = new THREE.Quaternion().setFromUnitVectors(Z, normal), inverse = rotation.clone().invert();
    const samples: Array<THREE.Vector3 | null> = [], size = 4, positions: number[] = [], uvs: number[] = [];
    for (let y = 0; y <= size; y++) for (let x = 0; x <= size; x++) {
      const target = new THREE.Vector3((x / size - .5) * .125, (y / size - .5) * .125, 0).applyQuaternion(rotation).add(point);
      const delta = target.clone().sub(origin), hit = this.contact(origin, delta.clone().normalize(), delta.length() + .035);
      samples.push(hit && !hit.box && hit.normal.dot(normal) > .25 && hit.point.distanceTo(target) < .022 ? hit.point : null);
    }
    const openings = this.openings();
    const add = (a: number, b: number, c: number): void => {
      const aa = samples[a], bb = samples[b], cc = samples[c]; if (!aa || !bb || !cc) return;
      const center = aa.clone().add(bb).add(cc).multiplyScalar(1 / 3), delta = center.clone().sub(origin);
      const support = this.contact(origin, delta.clone().normalize(), delta.length() + .008);
      if (!support || support.box || support.point.distanceTo(center) > .012) return;
      for (const piece of this.clipOpenings([aa, bb, cc], openings)) for (let i = 1; i < piece.length - 1; i++) for (const p of [piece[0], piece[i], piece[i + 1]]) {
        const local = p.clone().sub(point).applyQuaternion(inverse);
        positions.push(local.x, local.y, local.z); uvs.push(local.x / .125 + .5, local.y / .125 + .5);
      }
    };
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const a = y * (size + 1) + x; add(a, a + 1, a + size + 2); add(a, a + size + 2, a + size + 1); }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.computeVertexNormals(); return geometry;
  }
  moistureAt(p: THREE.Vector3): { pore: number; film: number } {
    const exact = this.water.get(this.waterKey(p)); if (exact) return exact;
    let best: WaterCell | undefined, distance = .10;
    for (const cell of this.water.values()) { const d = cell.position.distanceTo(p); if (d < distance && Math.abs(cell.position.z - p.z) < .025) { distance = d; best = cell; } }
    return best ?? { pore: 0, film: 0 };
  }
  retention(p: THREE.Vector3, v: THREE.Vector3, normal: THREE.Vector3): number {
    const wet = this.moistureAt(p), speed = v.length(), incidence = Math.max(0, -v.clone().normalize().dot(normal));
    return THREE.MathUtils.clamp((.35 + .65 * Math.min(1, wet.pore / .45)) * (1 - .8 * wet.film) * Math.min(1, speed / 2) * incidence ** 1.3 / (1 + Math.max(0, speed - 6) * .12), 0, .93);
  }
  launch(origin: THREE.Vector3, velocity: THREE.Vector3, mass = .24): void {
    if (this.projectiles.length >= 48 || !Number.isFinite(mass) || mass <= 0) return;
    this.spawnClod(origin, velocity, mass); this.launchedMass += mass;
  }
  private spawnClod(origin: THREE.Vector3, velocity: THREE.Vector3, mass: number): void {
    const mesh = new THREE.Mesh(this.clodGeometry, this.mortarMaterial); mesh.position.copy(origin); mesh.castShadow = true;
    const scale = Math.cbrt(mass / .24); mesh.scale.set(.032 * scale, .023 * scale, .045 * scale);
    this.group.add(mesh); this.projectiles.push({ mesh, velocity: velocity.clone(), mass, age: 0, contacts: 0 });
  }
  /** Optional close hand packing: actual reachable ring contact, never automatic box fill. */
  pack(camera: THREE.Camera): boolean {
    if (this.recovery > 0) return false;
    const hit = this.contact(camera.getWorldPosition(new THREE.Vector3()), camera.getWorldDirection(new THREE.Vector3()), .9);
    if (!hit || hit.box || this.insideBox(hit.point)) return false;
    const nearby = this.points.some(point => point.stage === 'fitted' && hit.point.distanceTo(point.getWorldPosition(new THREE.Vector3())) < point.boxGroup.groupWidth * .6 + .14);
    if (!nearby) return false;
    const mass = .10, fraction = this.retention(hit.point, hit.normal.clone().multiplyScalar(-2), hit.normal);
    const held = this.deposit(hit.point, mass * fraction, hit.normal);
    if (!held) return false;
    this.launchedMass += mass; this.stuckMass += held;
    this.spawnClod(hit.point.clone().addScaledVector(hit.normal, .015), hit.normal.clone().multiplyScalar(.12).add(new THREE.Vector3(0, -.15, 0)), mass - held);
    this.recovery = .4; this.lastOutcome = 'Packed against the actual support; loose excess falls.'; return true;
  }

  /** Earliest current solid, including deposited mortar and actual box casing. */
  private contact(origin: THREE.Vector3, direction: THREE.Vector3, distance: number): Contact | null {
    if (distance <= 1e-8) return null;
    const wallHit = this.wall.volume.raycast(origin, direction, distance);
    let result: Contact | null = wallHit ? { point: new THREE.Vector3(wallHit.point.x, wallHit.point.y, wallHit.point.z), normal: new THREE.Vector3(wallHit.normal.x, wallHit.normal.y, wallHit.normal.z), distance: new THREE.Vector3(wallHit.point.x, wallHit.point.y, wallHit.point.z).distanceTo(origin), box: false } : null;
    this.ray.set(origin, direction); this.ray.near = .0001; this.ray.far = distance;
    const meshes: THREE.Object3D[] = this.deposits.filter(d => this.ray.ray.distanceSqToPoint(d.position) < (d.radius + .04) ** 2).map(d => d.mesh);
    meshes.push(...this.resting.map(clod => clod.mesh));
    for (const point of this.points) if (point.boxGroup.visible) { point.updateWorldMatrix(true, true); meshes.push(...point.boxGroup.boxes); }
    for (const mesh of meshes) mesh.updateWorldMatrix(true, false);
    const hit = this.ray.intersectObjects(meshes, true)[0];
    if (hit && (!result || hit.distance < result.distance)) {
      const normal = hit.face?.normal.clone().transformDirection(hit.object.matrixWorld) ?? direction.clone().negate();
      if (normal.dot(direction) > 0) normal.negate();
      result = { point: hit.point.clone(), normal, distance: hit.distance, box: !this.deposits.some(d => d.mesh === hit.object) && !this.resting.some(clod => clod.mesh === hit.object) };
    }
    return result;
  }
  private openings(): Opening[] {
    const result: Opening[] = [];
    for (const point of this.points) if (point.boxGroup.visible) {
      point.updateWorldMatrix(true, true);
      for (const box of point.boxGroup.boxes) result.push({ inverse: box.matrixWorld.clone().invert(), halfWidth: box.width / 2 - .001, halfHeight: box.height / 2 - .001 });
    }
    return result;
  }
  private insideBox(p: THREE.Vector3): boolean { return this.openings().some(box => { const q = p.clone().applyMatrix4(box.inverse); return Math.abs(q.x) < box.halfWidth && Math.abs(q.y) < box.halfHeight; }); }

  /** Subtract opening prisms from every face, including edge crossings and tilted boxes. */
  private clipOpenings(polygon: THREE.Vector3[], openings: Opening[]): THREE.Vector3[][] {
    let pieces = [polygon];
    for (const box of openings) {
      const outside: THREE.Vector3[][] = [];
      for (const piece of pieces) {
        const local=piece.map(p=>p.clone().applyMatrix4(box.inverse));
        if(local.every(p=>p.x>=box.halfWidth-1e-9)||local.every(p=>p.x<=-box.halfWidth+1e-9)||local.every(p=>p.y>=box.halfHeight-1e-9)||local.every(p=>p.y<=-box.halfHeight+1e-9)){outside.push(piece);continue;}
        let remaining = piece;
        for (const [axis, sign, extent] of [[0, 1, box.halfWidth], [0, -1, box.halfWidth], [1, 1, box.halfHeight], [1, -1, box.halfHeight]]) {
          if (remaining.length < 3) break;
          const inside: THREE.Vector3[] = [], rejected: THREE.Vector3[] = [];
          for (let i = 0; i < remaining.length; i++) {
            const a = remaining[i], b = remaining[(i + 1) % remaining.length];
            const la = a.clone().applyMatrix4(box.inverse), lb = b.clone().applyMatrix4(box.inverse);
            const da = (axis === 0 ? la.x : la.y) * sign - extent, db = (axis === 0 ? lb.x : lb.y) * sign - extent;
            (da <= 0 ? inside : rejected).push(a);
            if ((da <= 0) !== (db <= 0)) { const p = a.clone().lerp(b, da / (da - db)); inside.push(p); rejected.push(p); }
          }
          if (rejected.length >= 3) outside.push(rejected);
          remaining = inside;
        }
      }
      pieces = outside;
    }
    return pieces;
  }

  private deposit(p: THREE.Vector3, mass: number, normal: THREE.Vector3): number {
    if (mass <= .001) return 0;
    if (this.deposits.length >= MAX_PATCHES) this.mergeStablePatches();
    // Record compaction preserves material; this separate generous vertex budget
    // bounds memory even during an indefinitely long free-play session.
    if (this.deposits.length >= MAX_PATCHES || this.deposits.reduce((sum, d) => sum + d.mesh.geometry.getAttribute('position').count, 0) >= MAX_VERTICES) return 0;
    // A trowelful spreads and packs across a rough chase edge. Its growth axis
    // follows the working face instead of amplifying each tiny fracture facet.
    normal = normal.z > .25 ? normal.clone().lerp(Z,.65).normalize() : normal;
    const radius = .028 + Math.sqrt(mass) * .085, orientation = new THREE.Quaternion().setFromUnitVectors(Z, normal);
    const tangent = new THREE.Vector3(1, 0, 0).applyQuaternion(orientation), up = new THREE.Vector3(0, 1, 0).applyQuaternion(orientation);
    const openings = this.openings(), vertices: Array<THREE.Vector3 | null> = [];
    const count = 20;
    // Shared projected vertices produce a coherent surface rather than floating balls.
    for (let ring = 0; ring <= 2; ring++) for (let i = 0; i < (ring ? count : 1); i++) {
      const angle = i * Math.PI * 2 / count, noise = 1 + .075 * Math.sin(angle * 7 + p.x * 53 + p.y * 37);
      const q = p.clone().addScaledVector(tangent, Math.cos(angle) * radius * ring / 2 * noise).addScaledVector(up, Math.sin(angle) * radius * ring / 2 * noise);
      const hit = this.contact(q.clone().addScaledVector(normal, .11), normal.clone().negate(), .22);
      vertices.push(hit && !hit.box && hit.normal.dot(normal) > .15 && Math.abs(hit.point.clone().sub(p).dot(normal)) < .08 ? hit.point : null);
    }
    const triangles: THREE.Vector3[][] = [];
    const add = (a: number, b: number, c: number): void => {
      const va = vertices[a], vb = vertices[b], vc = vertices[c]; if (!va || !vb || !vc) return;
      const middle = va.clone().add(vb).add(vc).multiplyScalar(1 / 3);
      const support = this.contact(middle.clone().addScaledVector(normal, .035), normal.clone().negate(), .07);
      if (!support || support.box) return;
      for (const piece of this.clipOpenings([va, vb, vc], openings)) for (let i = 1; i < piece.length - 1; i++) triangles.push([piece[0], piece[i], piece[i + 1]]);
    };
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      add(0, 1 + i, 1 + j); add(1 + i, 21 + i, 21 + j); add(1 + i, 21 + j, 1 + j);
    }
    let area = 0;
    for (const [a, b, c] of triangles) area += new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).length() * .5;
    if (area < 1e-6) return 0;
    const thickness = Math.min(.018, mass / (DENSITY * Math.PI * radius * radius)), held = Math.min(mass, area * thickness * DENSITY);
    if (held < .001) return 0;
    const positions: number[] = [], offset = normal.clone().multiplyScalar(thickness);
    const emit = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void => {
      // Extruded side/top faces are clipped again: oblique normals cannot enter an opening.
      for (const piece of this.clipOpenings([a, b, c], openings)) for (let i = 1; i < piece.length - 1; i++) for (const v of [piece[0], piece[i], piece[i + 1]]) positions.push(v.x, v.y, v.z);
    };
    for (const [a, b, c] of triangles) {
      const aa = a.clone().add(offset), bb = b.clone().add(offset), cc = c.clone().add(offset);
      emit(aa, bb, cc); emit(c, b, a);
      for (const [v, w, vv, ww] of [[a, b, aa, bb], [b, c, bb, cc], [c, a, cc, aa]]) { emit(v, w, ww); emit(v, ww, vv); }
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); this.finishGeometry(geometry);
    const mesh = new THREE.Mesh(geometry, this.mortarMaterial); mesh.receiveShadow = mesh.castShadow = true; mesh.name = 'Surface conforming mortar with clipped box openings'; this.group.add(mesh);
    this.deposits.push({ position: p.clone(), radius, mass: held, mesh, age: 0, normal: normal.clone(), support: 1 - this.moistureAt(p).film });
    this.geometryRevision++; return held;
  }

  /** Compact two stable nearby records without deleting their geometry or mass. */
  private mergeStablePatches(): void {
    let a = -1, b = -1, distance = Infinity;
    for (let i = 0; i < this.deposits.length; i++) {
      if (this.deposits[i].age < 1.3) continue;
      for (let j = i + 1; j < this.deposits.length; j++) {
        if (this.deposits[j].age < 1.3) continue;
        const delta = this.deposits[i].position.distanceToSquared(this.deposits[j].position);
        if (delta < distance) { a = i; b = j; distance = delta; }
      }
    }
    if (a < 0) return;
    const first = this.deposits[a], second = this.deposits[b];
    const p = first.mesh.geometry.getAttribute('position'), q = second.mesh.geometry.getAttribute('position');
    const positions = new Float32Array((p.count + q.count) * 3); positions.set(p.array); positions.set(q.array, p.count * 3);
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); this.finishGeometry(geometry);
    first.mesh.geometry.dispose(); first.mesh.geometry = geometry;
    first.normal.multiplyScalar(first.mass).addScaledVector(second.normal, second.mass).normalize();
    first.mass += second.mass; first.age = Math.min(first.age, second.age); first.support = Math.min(first.support, second.support);
    first.position.copy(geometry.boundingSphere!.center); first.radius = geometry.boundingSphere!.radius;
    this.group.remove(second.mesh); second.mesh.geometry.dispose(); this.deposits.splice(b, 1); this.geometryRevision++;
  }

  /** Leveling moves the real opening. Reclip existing triangles against its new
   * transform; surface-area ratio estimates detached mass, not exact CSG volume. */
  private refreshOpeningGeometry(): void {
    const boxes = this.openings();
    const signature = boxes.map(box => box.inverse.elements.map(v => v.toFixed(5)).join(',')).join('|');
    if (signature === this.openingSignature) return;
    this.openingSignature = signature;
    if (!this.deposits.length) return;
    for (let index = this.deposits.length - 1; index >= 0; index--) {
      const deposit = this.deposits[index], old = deposit.mesh.geometry.getAttribute('position');
      const positions: number[] = []; let beforeArea = 0, afterArea = 0;
      for (let i = 0; i < old.count; i += 3) {
        const a = new THREE.Vector3().fromBufferAttribute(old, i), b = new THREE.Vector3().fromBufferAttribute(old, i + 1), c = new THREE.Vector3().fromBufferAttribute(old, i + 2);
        beforeArea += new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).length();
        for (const piece of this.clipOpenings([a, b, c], boxes)) for (let j = 1; j < piece.length - 1; j++) {
          const aa = piece[0], bb = piece[j], cc = piece[j + 1];
          if(new THREE.Vector3().crossVectors(bb.clone().sub(aa),cc.clone().sub(aa)).lengthSq()<1e-18)continue;
          afterArea += new THREE.Vector3().crossVectors(bb.clone().sub(aa), cc.clone().sub(aa)).length();
          for (const p of [aa, bb, cc]) positions.push(p.x, p.y, p.z);
        }
      }
      const loss = deposit.mass * THREE.MathUtils.clamp(1 - afterArea / Math.max(1e-12, beforeArea), 0, 1);
      // Clipping may partition an entirely exterior triangle into several pieces.
      // Keeping unchanged area avoids exponential tessellation on every level nudge.
      if (loss < 1e-8) continue;
      deposit.mass -= loss; this.stuckMass = Math.max(0, this.stuckMass - loss);
      if (loss > 1e-8) {
        const position = deposit.position.clone().addScaledVector(deposit.normal, .03);
        if (this.projectiles.length < 48) this.spawnClod(position, new THREE.Vector3(0, -.35, .12), loss);
        else {
          // Merge detached material into a nearby existing moving clod at capacity.
          let nearest = this.projectiles[0];
          for (const clod of this.projectiles) if (clod.mesh.position.distanceToSquared(position) < nearest.mesh.position.distanceToSquared(position)) nearest = clod;
          nearest.mass += loss; const scale = Math.cbrt(nearest.mass / .24); nearest.mesh.scale.set(.032 * scale, .023 * scale, .045 * scale);
        }
      }
      deposit.mesh.geometry.dispose();
      if (positions.length < 9 || deposit.mass < 1e-8) { this.group.remove(deposit.mesh); this.deposits.splice(index, 1); }
      else { const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); this.finishGeometry(geometry); deposit.mesh.geometry = geometry; }
    }
    this.geometryRevision++;
  }

  update(dt: number): void {
    dt = Math.min(.12, Math.max(0, dt)); this.simulationTime += dt; this.recovery = Math.max(0, this.recovery - dt); this.jetTime -= dt; this.jet.visible = this.jetTime > 0;
    this.refreshOpeningGeometry();
    this.maintenanceTime += dt;
    for (const [key, cell] of this.water) {
      cell.pore = Math.max(0, cell.pore - dt * .0008); cell.film = Math.max(0, cell.film - dt * .045);
      (cell.mesh.material as THREE.MeshBasicMaterial).opacity = .25 * cell.pore + .15 * cell.film;
      if (cell.pore < .002 && cell.film < .002) { this.group.remove(cell.mesh); cell.mesh.geometry.dispose(); (cell.mesh.material as THREE.Material).dispose(); this.water.delete(key); }
      if (this.maintenanceTime > .4 && cell.film > .55 && this.streams.length < 30) {
        const mesh = new THREE.Mesh(this.wetGeometry, this.wetMaterial.clone()); mesh.scale.set(.14, .65, 1); mesh.position.copy(cell.position).addScaledVector(cell.normal, .003); mesh.quaternion.copy(cell.mesh.quaternion); this.group.add(mesh);
        this.streams.push({ mesh, speed: .04 + cell.film * .1, life: 1.6 }); cell.film -= .025;
      }
    }
    for (let i = this.streams.length - 1; i >= 0; i--) {
      const stream = this.streams[i]; stream.life -= dt; stream.mesh.position.y -= stream.speed * dt;
      (stream.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(.2, stream.life * .15);
      if (stream.life <= 0 || stream.mesh.position.y < 0) { this.group.remove(stream.mesh); (stream.mesh.material as THREE.Material).dispose(); this.streams.splice(i, 1); }
    }
    for (let i = this.deposits.length - 1; i >= 0; i--) {
      const deposit = this.deposits[i]; deposit.age += dt;
      // Weak fresh deposits can release a cohesive lump; sound ones do not drip like paint.
      if (deposit.age > 1.2 && deposit.age < 1.2 + dt && deposit.support < .45 && this.projectiles.length < 48) {
        this.stuckMass = Math.max(0, this.stuckMass - deposit.mass); this.spawnClod(deposit.position.clone().addScaledVector(deposit.normal, .018), deposit.normal.clone().multiplyScalar(.10).add(new THREE.Vector3(0, -.25, 0)), deposit.mass);
        this.group.remove(deposit.mesh); deposit.mesh.geometry.dispose(); this.deposits.splice(i, 1); this.geometryRevision++; this.lastOutcome = 'Excess water weakened the fresh patch; a clump fell.';
      }
    }
    if (this.maintenanceTime > .4) { this.maintenanceTime = 0; this.updateStages(); }
    const steps = Math.max(1, Math.ceil(dt / .012)), h = dt / steps;
    for (let step = 0; step < steps; step++) for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const clod = this.projectiles[i], a = clod.mesh.position, next = a.clone().addScaledVector(clod.velocity, h); next.y -= .5 * 9.81 * h * h; clod.velocity.y -= 9.81 * h; clod.age += h;
      const d = next.clone().sub(a), hit = this.contact(a, d.clone().normalize(), d.length());
      if (hit) {
        const fraction = hit.box || this.insideBox(hit.point) || clod.contacts > 2 ? 0 : this.retention(hit.point, clod.velocity, hit.normal);
        const held = this.deposit(hit.point, clod.mass * fraction, hit.normal); this.stuckMass += held; clod.mass -= held; clod.contacts++;
        this.lastOutcome = held > .07 ? 'Mortar held. Pack all four sides before leveling.' : held > .005 ? 'Some mortar held; excess is falling.' : 'Glancing / wet contact: mortar slipped off.';
        if (clod.mass < .001) { this.floorMass += clod.mass; this.group.remove(clod.mesh); this.projectiles.splice(i, 1); continue; }
        if (hit.normal.y > .4 && clod.contacts >= 2 && Math.abs(clod.velocity.dot(hit.normal)) < 1.6) {
          this.restOnLedge(clod, hit); this.projectiles.splice(i, 1); continue;
        }
        // Clear the newly deposited thickness as well as the old hit surface.
        clod.mesh.position.copy(hit.point).addScaledVector(hit.normal, .030);
        const vn = clod.velocity.dot(hit.normal); clod.velocity.addScaledVector(hit.normal, -vn).multiplyScalar(.3).addScaledVector(hit.normal, .16); clod.velocity.y = Math.min(-.4, clod.velocity.y - .22);
        const scale = Math.cbrt(clod.mass / .24); clod.mesh.scale.set(.032 * scale, .023 * scale, .045 * scale); continue;
      }
      clod.mesh.position.copy(next); clod.mesh.rotation.x += h * 3;
      if (next.y < .012) { this.settle(clod); this.projectiles.splice(i, 1); }
      // No age-based teleport to floor: trajectories continue falling under gravity.
    }
  }
  /** Low-energy residue rests on the ledge it actually hit. It is neither glued
   * mortar nor floor waste, and contributes no installation coverage by itself. */
  private restOnLedge(clod: Clod, hit: Contact): void {
    this.restingMass += clod.mass;
    const radius = Math.max(.009, Math.cbrt(clod.mass / DENSITY) * 1.5);
    clod.mesh.position.copy(hit.point).addScaledVector(hit.normal, .006);
    clod.mesh.quaternion.setFromUnitVectors(Z, hit.normal); clod.mesh.scale.set(radius, radius * .8, .008); clod.mesh.updateMatrixWorld(true);
    const source = this.clodGeometry.getAttribute('position'), positions: number[] = [], boxes = this.openings();
    for (let i = 0; i < source.count; i += 3) {
      const triangle = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(source, i + j).applyMatrix4(clod.mesh.matrixWorld));
      for (const polygon of this.clipOpenings(triangle, boxes)) for (let j = 1; j < polygon.length - 1; j++) for (const v of [polygon[0], polygon[j], polygon[j + 1]]) positions.push(v.x, v.y, v.z);
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); this.finishGeometry(geometry);
    clod.mesh.geometry = geometry; clod.mesh.position.set(0, 0, 0); clod.mesh.quaternion.identity(); clod.mesh.scale.set(1, 1, 1); clod.mesh.updateMatrixWorld(true);
    clod.mesh.name = 'Loose mortar resting on actual masonry ledge'; clod.mesh.receiveShadow = true;
    this.resting.push({ mesh: clod.mesh, mass: clod.mass });
    // Consolidate nearby resting batches without moving material to the floor or
    // deleting it. Each batch retains world-space triangles and a real bound.
    if (this.resting.length > 64) {
      let first = 0, second = 1, distance = Infinity;
      for (let a = 0; a < this.resting.length; a++) for (let b = a + 1; b < this.resting.length; b++) {
        const ga = this.resting[a].mesh.geometry.boundingSphere!, gb = this.resting[b].mesh.geometry.boundingSphere!;
        const d = ga.center.distanceToSquared(gb.center); if (d < distance) { distance = d; first = a; second = b; }
      }
      const a = this.resting[first], b = this.resting[second], aa = a.mesh.geometry.getAttribute('position'), bb = b.mesh.geometry.getAttribute('position');
      const merged = new Float32Array((aa.count + bb.count) * 3); merged.set(aa.array); merged.set(bb.array, aa.count * 3);
      const replacement = new THREE.BufferGeometry(); replacement.setAttribute('position', new THREE.BufferAttribute(merged, 3)); replacement.computeVertexNormals(); replacement.computeBoundingSphere();
      a.mesh.geometry.dispose(); a.mesh.geometry = replacement; a.mass += b.mass; this.group.remove(b.mesh); b.mesh.geometry.dispose(); this.resting.splice(second, 1);
    }
    this.lastOutcome = 'Loose excess came to rest on a real masonry ledge.';
  }
  private settle(clod: Clod): void {
    this.floorMass += clod.mass; clod.mesh.position.y = .005;
    const radius = Math.max(.008, Math.cbrt(clod.mass / DENSITY) * 1.8); clod.mesh.scale.set(radius, .006, radius * .8); clod.mesh.userData.mass = clod.mass;
    if (this.settled.length < 96) this.settled.push(clod.mesh);
    else {
      let closest = this.settled[0]; for (const mesh of this.settled) if (mesh.position.distanceToSquared(clod.mesh.position) < closest.position.distanceToSquared(clod.mesh.position)) closest = mesh;
      closest.userData.mass += clod.mass; const r = Math.cbrt(closest.userData.mass / DENSITY) * 1.8; closest.scale.set(r, .006, r * .8); this.group.remove(clod.mesh);
    }
  }
  private updateStages(): void { for (const point of this.points) if (point.stage === 'fitted' && this.evaluateCoverage(point, true) >= .68) point.setStage('mortared'); }
  coverage(point: InstallationPoint): number { return this.evaluateCoverage(point, false); }
  private evaluateCoverage(point: InstallationPoint, stableOnly: boolean): number {
    point.updateWorldMatrix(true, true);
    const key = `${point.definition.id}:${stableOnly}`, transform = point.boxGroup.matrixWorld.elements.map(v => v.toFixed(5)).join(',');
    const cached = this.coverageCache.get(key);
    if (cached && cached.revision === this.geometryRevision && cached.transform === transform && this.simulationTime - cached.time < .2) return cached.value;
    const width = point.boxGroup.groupWidth / 2 + .026, height = point.boxGroup.groupHeight / 2 + .024, counts = [0, 0, 0, 0];
    const center = point.boxGroup.getWorldPosition(new THREE.Vector3()), reach = Math.hypot(width, height) + .09;
    const meshes = this.deposits.filter(deposit => (!stableOnly || deposit.age >= 1.3) && deposit.position.distanceTo(center) <= reach + deposit.radius).map(deposit => deposit.mesh);
    for (let side = 0; side < 4; side++) for (let i = 0; i < 12; i++) {
      const t = -.9 + 1.8 * i / 11;
      const q = new THREE.Vector3(side < 2 ? t * width : side === 2 ? -width : width, side < 2 ? side === 0 ? -height : height : t * height, .024).applyMatrix4(point.boxGroup.matrixWorld);
      const direction = new THREE.Vector3(0, 0, -1).transformDirection(point.boxGroup.matrixWorld);
      this.ray.set(q, direction); this.ray.near = 0; this.ray.far = .065;
      // Actual clipped triangle coverage and box-local depth, never XY bounding circles.
      if (this.ray.intersectObjects(meshes, false).length > 0) counts[side]++;
    }
    const value = Math.min(...counts) / 12;
    this.coverageCache.set(key, { time: this.simulationTime, revision: this.geometryRevision, transform, value }); return value;
  }
  get telemetry() { return { angleDegrees: this.angleDegrees, power: this.charge, recovery: this.recovery, airborne: this.projectiles.length, launchedKg: this.launchedMass, stuckKg: this.stuckMass, restingKg: this.restingMass, restingBatches: this.resting.length, floorKg: this.floorMass, movingKg: this.projectiles.reduce((sum, clod) => sum + clod.mass, 0), wetCells: this.water.size, patches: this.deposits.length, outcome: this.lastOutcome, acceleratedSetting: true, geometryLimit: MAX_PATCHES, coverage: this.points.map(point => ({ id: point.definition.id, fraction: this.coverage(point) })) }; }
}
