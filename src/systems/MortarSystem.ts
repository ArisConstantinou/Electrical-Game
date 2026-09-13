import * as THREE from 'three';
import type { InstallationPoint } from '../electrical/InstallationPoint';
import type { BrickWall } from '../world/BrickWall';
import { MortarField } from './MortarField';
import { WATER_GUN_MODES, type WaterGunSetting } from './WaterGun';

type WaterCell = { pore: number; film: number; mesh: THREE.Mesh; position: THREE.Vector3; normal: THREE.Vector3 };
type Clod = { mesh: THREE.Mesh; velocity: THREE.Vector3; mass: number; age: number; contacts: number; slurry: boolean; bond: number };
type Deposit = { fieldKey?: string; position: THREE.Vector3; radius: number; mass: number; mesh: THREE.Mesh; age: number; normal: THREE.Vector3; support: number };
type Contact = { point: THREE.Vector3; normal: THREE.Vector3; distance: number; box: boolean };
type Opening = { inverse: THREE.Matrix4; halfWidth: number; halfHeight: number; minZ: number; maxZ: number };
const Z = new THREE.Vector3(0, 0, 1);
const DENSITY = 1900;
const MAX_PATCHES = 256;
const MAX_WATER = 240;


/** Qualitative wet mortar: finite mass, real surface contact and separate fresh-mortar stability.
 * See docs/MORTAR_APPLICATION_RESEARCH.md; these coefficients are not calibrated. */
export class MortarSystem {
  readonly group = new THREE.Group();
  readonly field = new MortarField();
  onRunoff?: (event: { point: THREE.Vector3; normal: THREE.Vector3; litres: number; mortarKg: number }) => void;
  onWaterEmission?: (event: { origin: THREE.Vector3; velocity: THREE.Vector3; litres: number }) => void;
  washedMass = 0;
  waterGunLitres = 0;
  readonly waterGunDirection = new THREE.Vector3(0, 0, -1);
  private pendingWashMass = 0;
  private readonly pendingWashPoint = new THREE.Vector3();
  private readonly pendingWashNormal = new THREE.Vector3(0,0,1);
  private fieldMeshTime = 0;
  private supportDirty = false;
  private lastWallRemovalCount = -1;
  readonly water = new Map<string, WaterCell>();
  readonly deposits: Deposit[] = [];
  readonly projectiles: Clod[] = [];
  readonly target = new THREE.Mesh(new THREE.RingGeometry(.023, .028, 24), new THREE.MeshBasicMaterial({ color: 0xe6cc76, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: .85 }));
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
  private readonly mortarMaterial = new THREE.MeshStandardMaterial({ color: 0x817969, roughness: .84, flatShading: false, side: THREE.DoubleSide });
  private readonly clodGeometry = new THREE.SphereGeometry(1, 18, 12).toNonIndexed();
  private readonly wetGeometry = new THREE.PlaneGeometry(.125, .125);
  private readonly wetMaterial: THREE.MeshBasicMaterial;
  private readonly ray = new THREE.Raycaster();
  private wasHeld = false;
  private releasedPhase = 0;
  private recoveringThrow = false;
  private releaseCount = 0;
  private faceSplash = 0;
  private maintenanceTime = 0;
  private simulationTime = 0;
  private geometryRevision = 0;
  private openingSignature = '';
  private readonly coverageCache = new Map<string, { time: number; revision: number; transform: string; value: number }>();
  private readonly streams: Array<{ mesh: THREE.Mesh; speed: number; life: number }> = [];

  constructor(scene: THREE.Scene, private readonly wall: BrickWall, private readonly points: InstallationPoint[]) {
    this.group.name = 'Wet mortar, water and construction spills';
    this.group.userData.studioEntityId = 'mortar-application';
    scene.add(this.group); this.group.add(this.target);
    this.target.visible = false; this.target.renderOrder = 8;
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
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n float grain=fract(sin(dot(floor(mortarWorld*1600.0),vec3(127.1,311.7,74.7)))*43758.5453); diffuseColor.rgb*=.96+grain*.06;');
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
  /** Timing is a learnable game gesture. It modifies a finite scoop, while
   * substrate moisture, incidence and actual cavity contact still decide adhesion. */
  get throwFeedback() {
    const recovering=this.recovery>0&&this.recoveringThrow;
    const active=this.wasHeld||recovering,phase=this.wasHeld?this.charge:recovering?this.releasedPhase:0;
    const quality:'ready'|'early'|'perfect'|'late'=!active?'ready':phase<.42?'early':phase<=.58?'perfect':'late';
    const swingDegrees=this.wasHeld?-50+phase*140:recovering?(-50+phase*140)*THREE.MathUtils.smoothstep(this.recovery/.65,0,1):0;
    return {holding:this.wasHeld,phase,quality,swingDegrees,strength:phase,splash:this.faceSplash,lastRelease:this.releaseCount};
  }
  swing(held: boolean, dt: number, camera: THREE.Camera, origin: THREE.Vector3): void {
    if (this.recovery > 0) { this.cancel(); return; }
    if (held) { this.wasHeld = true; this.charge = Math.min(1, this.charge + dt / .95); }
    else if (this.wasHeld) {
      const phase=this.charge,late=THREE.MathUtils.clamp((phase-.58)/.42,0,1),backFraction=late*.55;
      // Reserve the entire scoop atomically; never lose the backward share at
      // the projectile budget. Explicit launch() retains its original contract.
      if(this.projectiles.length+(late>0?3:1)<=48){
        const mass=.65,bond=phase<.42?.04+.96*(phase/.42)**2:1;
        this.spawnClod(origin,this.velocity(camera,phase),mass*(1-backFraction),false,bond);
        if(late>0){
          const towardFace=camera.getWorldPosition(new THREE.Vector3()).sub(origin);
          if(towardFace.lengthSq()<1e-6)camera.getWorldDirection(towardFace).negate();
          towardFace.normalize().multiplyScalar(1.6+late*2.4);
          const right=new THREE.Vector3(1,0,0).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
          for(const side of [-1,1])this.spawnClod(origin,towardFace.clone().addScaledVector(right,side*.35),mass*backFraction/2,true,0);
        }
        this.launchedMass+=mass;this.releasedPhase=phase;this.releaseCount++;this.faceSplash=Math.max(this.faceSplash,late);
        this.lastOutcome=phase<.42?'Early release: weak adhesion; loose mortar will slide down.':late>0?'Late release: mortar splashes back; part of the scoop still reaches the wall.':'Perfect release: good transfer; aim at clean, damp masonry.';
        this.recovery=.65;this.recoveringThrow=true;
      }
      this.cancel();
    }
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
  wet(camera: THREE.Camera, origin: THREE.Vector3, dt: number, setting: WaterGunSetting = WATER_GUN_MODES[0], surfaceAt: (x:number,z:number)=>number = ()=>0, nozzleDirection?:THREE.Vector3): void {
    const totalLitres=Math.max(0,dt)*setting.flowLitresPerSecond;if(!totalLitres)return;
    this.waterGunLitres+=totalLitres;
    const direction=camera.getWorldDirection(new THREE.Vector3()),cameraOrigin=camera.getWorldPosition(new THREE.Vector3());
    const aim=this.contact(cameraOrigin,direction,8);
    this.waterGunDirection.copy(nozzleDirection??(aim?aim.point.clone().sub(origin).normalize():direction));
    // Multiple physical rays share exactly one delivered volume. The dedicated
    // room-water renderer draws the continuous jet; no straight blue overlay.
    const rotation=new THREE.Quaternion().setFromUnitVectors(Z,this.waterGunDirection);
    const count=13;
    for(let i=0;i<count;i++){
      const angle=i*2.399963229728653,radius=i===0?0:Math.sqrt(i/(count-1));
      const ray=new THREE.Vector3(Math.cos(angle)*radius*setting.spreadRadians,Math.sin(angle)*radius*setting.spreadRadians,1).normalize().applyQuaternion(rotation);
      const litres=totalLitres/count,velocity=ray.clone().multiplyScalar(setting.speedMps);
      let previous=origin.clone(),local:Contact|null=null;
      const flight=8/setting.speedMps;
      for(let step=1;step<=24;step++){
        const time=flight*step/24,next=origin.clone().addScaledVector(velocity,time);next.y-=4.905*time*time;
        const delta=next.clone().sub(previous),hit=this.contact(previous,delta.clone().normalize(),delta.length());
        const height=surfaceAt(next.x,next.z);
        const floorFraction=next.y<=height?THREE.MathUtils.clamp((previous.y-height)/Math.max(.000001,previous.y-next.y),0,1):Infinity;
        if(hit&&hit.distance<delta.length()*floorFraction){local=hit;break;}
        if(floorFraction<=1)break;
        previous=next;
      }
      if(!local){this.onWaterEmission?.({origin:origin.clone(),velocity,litres});continue;}
      if(local.box||this.insideBox(local.point)){this.onRunoff?.({point:local.point.clone(),normal:local.normal.clone(),litres,mortarKg:0});continue;}
      this.applyWater(local.point,local.normal,litres);
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
    const receiver=this.field.stateAt(p.clone().addScaledVector(normal,-.006));
    const prepared=receiver.value>.35&&receiver.age<3600?.90*(1-Math.min(.65,receiver.dilution*.3)):(.35+.65*Math.min(1,wet.pore/.45));
    return THREE.MathUtils.clamp(prepared * (1 - .8 * wet.film) * Math.min(1, speed / 2) * incidence ** 1.3 / (1 + Math.max(0, speed - 6) * .12), 0, .93);
  }
  launch(origin: THREE.Vector3, velocity: THREE.Vector3, mass = .65): void {
    if (this.projectiles.length >= 48 || !Number.isFinite(mass) || mass <= 0) return;
    this.spawnClod(origin, velocity, mass); this.launchedMass += mass;
  }
  private spawnClod(origin: THREE.Vector3, velocity: THREE.Vector3, mass: number, slurry = false, bond = 1): void {
    const mesh = new THREE.Mesh(this.clodGeometry, this.mortarMaterial); mesh.position.copy(origin); mesh.castShadow = true;
    const scale = Math.cbrt(mass / .65); mesh.scale.set(.046 * scale, .030 * scale, .064 * scale);
    this.group.add(mesh); this.projectiles.push({ mesh, velocity: velocity.clone(), mass, age: 0, contacts: 0, slurry, bond });
  }
  /** Close cohesive packing is available at every real reachable surface or gap. */
  pack(camera: THREE.Camera): boolean {
    if (this.recovery > 0) return false;
    const hit = this.contact(camera.getWorldPosition(new THREE.Vector3()), camera.getWorldDirection(new THREE.Vector3()), .9);
    if (!hit || hit.box || this.insideBox(hit.point)) return false;
    const mass = .65, fraction = this.retention(hit.point, hit.normal.clone().multiplyScalar(-2), hit.normal);
    const held = this.deposit(hit.point, mass * fraction, hit.normal);
    if (!held) return false;
    this.launchedMass += mass; this.stuckMass += held;
    this.spawnClod(hit.point.clone().addScaledVector(hit.normal, .015), hit.normal.clone().multiplyScalar(.12).add(new THREE.Vector3(0, -.15, 0)), mass - held);
    this.recovery = .4; this.recoveringThrow=false;this.releasedPhase=0;this.cancel();this.lastOutcome = held<mass*.25?'The nearby void is full; loose excess slumps off.':'Packed into the exposed cavity; loose excess falls.'; return true;
  }

  /** Earliest current solid, including deposited mortar and actual box casing. */
  private contact(origin: THREE.Vector3, direction: THREE.Vector3, distance: number): Contact | null {
    if (distance <= 1e-8) return null;
    const wallHit = this.wall.volume.raycast(origin, direction, distance);
    let result: Contact | null = wallHit ? { point: new THREE.Vector3(wallHit.point.x, wallHit.point.y, wallHit.point.z), normal: new THREE.Vector3(wallHit.normal.x, wallHit.normal.y, wallHit.normal.z), distance: new THREE.Vector3(wallHit.point.x, wallHit.point.y, wallHit.point.z).distanceTo(origin), box: false } : null;
    this.ray.set(origin, direction); this.ray.near = .0001; this.ray.far = distance;
    const fieldHit=this.field.raycast(origin,direction,result?Math.min(distance,result.distance):distance);
    if(fieldHit&&(!result||fieldHit.distance<result.distance))result={...fieldHit,box:false};
    const meshes: THREE.Object3D[] = [];
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
      for (const box of point.boxGroup.boxes) result.push({ inverse: box.matrixWorld.clone().invert(), halfWidth: box.width / 2 - .001, halfHeight: box.height / 2 - .001, minZ: -(box.depth ?? .047), maxZ: 20 });
    }
    return result;
  }
  private insideBox(p: THREE.Vector3): boolean { return this.openings().some(box => { const q = p.clone().applyMatrix4(box.inverse); return Math.abs(q.x) < box.halfWidth && Math.abs(q.y) < box.halfHeight && q.z > box.minZ && q.z < box.maxZ; }); }

  /** Subtract opening prisms from every face, including edge crossings and tilted boxes. */
  private clipOpenings(polygon: THREE.Vector3[], openings: Opening[]): THREE.Vector3[][] {
    let pieces = [polygon];
    for (const box of openings) {
      const outside: THREE.Vector3[][] = [];
      for (const piece of pieces) {
        const local=piece.map(p=>p.clone().applyMatrix4(box.inverse));
        if(local.every(p=>p.x>=box.halfWidth-1e-9)||local.every(p=>p.x<=-box.halfWidth+1e-9)||local.every(p=>p.y>=box.halfHeight-1e-9)||local.every(p=>p.y<=-box.halfHeight+1e-9)||local.every(p=>p.z<=box.minZ+1e-9)||local.every(p=>p.z>=box.maxZ-1e-9)){outside.push(piece);continue;}
        let remaining = piece;
        for (const [axis, sign, extent] of [[0, 1, box.halfWidth], [0, -1, box.halfWidth], [1, 1, box.halfHeight], [1, -1, box.halfHeight], [2, 1, box.maxZ], [2, -1, -box.minZ]]) {
          if (remaining.length < 3) break;
          const inside: THREE.Vector3[] = [], rejected: THREE.Vector3[] = [];
          for (let i = 0; i < remaining.length; i++) {
            const a = remaining[i], b = remaining[(i + 1) % remaining.length];
            const la = a.clone().applyMatrix4(box.inverse), lb = b.clone().applyMatrix4(box.inverse);
            const da = (axis === 0 ? la.x : axis === 1 ? la.y : la.z) * sign - extent, db = (axis === 0 ? lb.x : axis === 1 ? lb.y : lb.z) * sign - extent;
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

  private deposit(p: THREE.Vector3, mass: number, normal: THREE.Vector3, sync=true): number {
    if (mass <= .001) return 0;
    // An impact facet must not rotate a separate sheet. Wet material joins a
    // fixed-world scalar volume and grows along the working face.
    const growth = normal.z > .25 ? normal.clone().lerp(Z, .65).normalize() : normal.clone();
    const boxes = this.openings(), volume = this.wall.volume;
    const blocked = (q: THREE.Vector3): boolean => {
      if (typeof volume.isOccupied === 'function' && volume.isOccupied(q.x,q.y,q.z)) return true;
      return boxes.some(box => { const local=q.clone().applyMatrix4(box.inverse); return Math.abs(local.x)<box.halfWidth && Math.abs(local.y)<box.halfHeight && local.z>box.minZ && local.z<box.maxZ; });
    };
    const frontZ=typeof volume.frontZ==='number'?volume.frontZ:(normal.z>.5?0:undefined);
    const profile=frontZ===undefined?undefined:{frontZ,supportZ:(x:number,y:number):number|null=>{
      const origin=new THREE.Vector3(x,y,frontZ+.016),hit=volume.raycast(origin,new THREE.Vector3(0,0,-1),.22);
      return hit?hit.point.z:null;
    }};
    const held = this.field.add(p, growth, mass, blocked,profile);
    if (held > 0) { if(sync)this.syncFieldGeometry(); this.geometryRevision++; }
    return held;
  }

  private syncFieldGeometry(): void {
    const boxes=this.openings();
    for(const chunk of this.field.remesh(triangle=>this.clipOpenings(triangle,boxes))){
      const index=this.deposits.findIndex(d=>d.fieldKey===chunk.key),old=index<0?undefined:this.deposits[index];
      if(!chunk.geometry.getAttribute('position').count){chunk.geometry.dispose();if(old){this.group.remove(old.mesh);old.mesh.geometry.dispose();this.deposits.splice(index,1);}continue;}
      const sphere=chunk.geometry.boundingSphere!;
      if(old){old.mesh.geometry.dispose();old.mesh.geometry=chunk.geometry;old.position.copy(sphere.center);old.radius=sphere.radius;old.mass=chunk.mass;old.age=chunk.age;old.support=1-Math.min(1,chunk.dilution);}
      else {const mesh=new THREE.Mesh(chunk.geometry,this.mortarMaterial);mesh.name='Continuous wet mortar volume';mesh.castShadow=mesh.receiveShadow=true;this.group.add(mesh);this.deposits.push({fieldKey:chunk.key,position:sphere.center.clone(),radius:sphere.radius,mass:chunk.mass,mesh,age:chunk.age,normal:Z.clone(),support:1-Math.min(1,chunk.dilution)});}
    }
    this.fieldMeshTime=0;
  }

  /** A pressed box extrudes fresh mortar out of its occupied envelope. Backing
   * behind the actual casing stays in place; excess remains counted as slurry. */
  pressBox(point:InstallationPoint):{displacedKg:number;repackedKg:number;looseKg:number}{
    point.updateWorldMatrix(true,true);
    const regions=point.boxGroup.boxes.map(box=>({inverse:box.matrixWorld.clone().invert(),width:box.width/2+.002,height:box.height/2+.002,depth:box.depth}));
    const removed=this.field.removeWhere(q=>regions.some(region=>{const p=q.clone().applyMatrix4(region.inverse);return Math.abs(p.x)<region.width&&Math.abs(p.y)<region.height&&p.z>=-region.depth&&p.z<.12;}),true);
    if(!removed)return{displacedKg:0,repackedKg:0,looseKg:0};
    this.stuckMass=Math.max(0,this.stuckMass-removed);
    let held=0;
    for(const box of point.boxGroup.boxes)for(const side of [-1,1]){
      for(const horizontal of [true,false]){
        const p=new THREE.Vector3(horizontal?side*(box.width/2+.027):0,horizontal?0:side*(box.height/2+.026),-box.depth*.55).applyMatrix4(box.matrixWorld);
        held+=this.deposit(p,removed/(point.boxGroup.boxes.length*4),Z,false);
      }
    }
    this.stuckMass+=held;
    const loose=Math.max(0,removed-held);
    if(loose)this.queueSlurry(point.boxGroup.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0,0,.015)),Z,loose);
    this.openingSignature='';this.field.invalidateGeometry();this.syncFieldGeometry();this.geometryRevision++;
    return{displacedKg:removed,repackedKg:held,looseKg:loose};
  }

  private refreshOpeningGeometry(): void {
    const boxes=this.openings(),signature=boxes.map(box=>box.inverse.elements.map(v=>v.toFixed(5)).join(',')).join('|');
    if(signature===this.openingSignature)return;this.openingSignature=signature;
    const removed=this.field.removeWhere(q=>boxes.some(box=>{const local=q.clone().applyMatrix4(box.inverse);return Math.abs(local.x)<box.halfWidth&&Math.abs(local.y)<box.halfHeight && local.z>box.minZ && local.z<box.maxZ;}));
    if(removed>0){this.stuckMass=Math.max(0,this.stuckMass-removed);const point=this.deposits[0]?.position??new THREE.Vector3(0,1,0);this.queueSlurry(point,Z,removed);}
    this.field.invalidateGeometry();this.syncFieldGeometry();this.geometryRevision++;
  }

  private queueSlurry(point:THREE.Vector3,normal:THREE.Vector3,mass:number):void {
    if(mass<=0)return;this.pendingWashPoint.multiplyScalar(this.pendingWashMass).addScaledVector(point,mass);this.pendingWashMass+=mass;this.pendingWashPoint.multiplyScalar(1/this.pendingWashMass);this.pendingWashNormal.copy(normal);
  }

  /** Litres are a delivered quantity, not litres/second. Fresh mortar can be
   * diluted/washed away; substrate prewetting is a separate state. */
  applyWater(point:THREE.Vector3,normal:THREE.Vector3,litres:number):{absorbedLitres:number;runoffLitres:number;washedMortarKg:number} {
    litres=Math.max(0,litres);let cell=this.water.get(this.waterKey(point));
    if(!cell&&this.water.size<MAX_WATER){const geometry=this.waterFootprint(point,normal,point.clone().addScaledVector(normal,.18));const mesh=new THREE.Mesh(geometry,this.wetMaterial.clone());mesh.position.copy(point).addScaledVector(normal,.0015);mesh.quaternion.setFromUnitVectors(Z,normal);this.group.add(mesh);cell={pore:0,film:0,mesh,position:point.clone(),normal:normal.clone()};this.water.set(this.waterKey(point),cell);}
    const washed=this.field.wash(point,litres);
    let restingWash=0;
    for(let i=this.resting.length-1;i>=0;i--){
      const clod=this.resting[i],geometry=clod.mesh.geometry,sphere=geometry.boundingSphere;
      if(!sphere||point.distanceTo(sphere.center)>sphere.radius+.008)continue;
      const loss=Math.min(clod.mass,litres*.70),old=clod.mass;clod.mass-=loss;restingWash+=loss;this.restingMass-=loss;
      if(clod.mass<1e-6){this.group.remove(clod.mesh);geometry.dispose();this.resting.splice(i,1);}
      else{const positions=geometry.getAttribute('position'),scale=Math.cbrt(clod.mass/old),q=new THREE.Vector3();
        for(let j=0;j<positions.count;j++){q.fromBufferAttribute(positions,j).sub(sphere.center).multiplyScalar(scale).add(sphere.center);positions.setXYZ(j,q.x,q.y,q.z);}positions.needsUpdate=true;geometry.computeBoundingSphere();}
    }
    const washedTotal=washed.removedKg+restingWash;
    if(restingWash>0){this.washedMass+=restingWash;this.queueSlurry(point,normal,restingWash);}
    const absorbed=cell?Math.min(litres*.85,Math.max(0,1-cell.pore)*.08):0,runoff=litres-absorbed;
    if(cell){cell.pore=Math.min(1,cell.pore+absorbed/.08);cell.film=Math.min(1,cell.film+runoff/.04);}
    if(washed.removedKg>0){this.supportDirty=true;this.stuckMass=Math.max(0,this.stuckMass-washed.removedKg);this.washedMass+=washed.removedKg;this.queueSlurry(point,normal,washed.removedKg);this.geometryRevision++;this.lastOutcome='Fresh mortar softened and washed away; slurry is falling.';}
    this.onRunoff?.({point:point.clone(),normal:normal.clone(),litres:runoff,mortarKg:washedTotal});
    return{absorbedLitres:absorbed,runoffLitres:runoff,washedMortarKg:washedTotal};
  }

  update(dt: number): void {
    dt = Math.min(.12, Math.max(0, dt)); this.simulationTime += dt; this.recovery = Math.max(0, this.recovery - dt); this.faceSplash=Math.max(0,this.faceSplash-dt*.28);
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
    this.field.tick(dt);this.fieldMeshTime+=dt;
    const removalCount=this.wall.volume.removedNodeCount ?? 0;
    if(removalCount!==this.lastWallRemovalCount){this.lastWallRemovalCount=removalCount;this.supportDirty=true;}
    if(this.supportDirty&&this.fieldMeshTime>=.10){
      this.supportDirty=false;
      const volume=this.wall.volume;
      if(typeof volume.isOccupied==='function'){
        const released=this.field.releaseUnsupported(q=>volume.isOccupied(q.x,q.y,q.z));
        if(released.mass>0){this.stuckMass=Math.max(0,this.stuckMass-released.mass);this.queueSlurry(released.point,Z,released.mass);this.geometryRevision++;}
      }
    }
    for(const deposit of this.deposits)deposit.age+=dt;
    if(this.field.dirty.size&&this.fieldMeshTime>=.10)this.syncFieldGeometry();
    if(this.pendingWashMass>.002&&this.projectiles.length<48){this.spawnClod(this.pendingWashPoint.clone().addScaledVector(this.pendingWashNormal,.025),new THREE.Vector3(0,-.25,.08),this.pendingWashMass,true);this.pendingWashMass=0;}
    if (this.maintenanceTime > .4) { this.maintenanceTime = 0; this.updateStages(); }
    const steps = Math.max(1, Math.ceil(dt / .012)), h = dt / steps;
    for (let step = 0; step < steps; step++) for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const clod = this.projectiles[i], a = clod.mesh.position, next = a.clone().addScaledVector(clod.velocity, h); next.y -= .5 * 9.81 * h * h; clod.velocity.y -= 9.81 * h; clod.age += h;
      const d = next.clone().sub(a), hit = this.contact(a, d.clone().normalize(), d.length());
      if (hit) {
        const fraction = clod.slurry || hit.box || this.insideBox(hit.point) || clod.contacts > 2 ? 0 : this.retention(hit.point, clod.velocity, hit.normal)*clod.bond;
        const held = this.deposit(hit.point, clod.mass * fraction, hit.normal); this.stuckMass += held; clod.mass -= held; clod.contacts++;
        // Rejected weak throws cannot become a second, stronger throw when they
        // hit a lower rib. They flow down under the same contact/gravity solver.
        if(clod.bond<.999)clod.slurry=true;
        this.lastOutcome = held > .07 ? 'Mortar held. Pack all four sides before leveling.' : held > .005 ? 'Some mortar held; excess is falling.' : 'Little free capacity or glancing contact: excess slumps off.';
        if (clod.mass < .001) { this.floorMass += clod.mass; this.group.remove(clod.mesh); this.projectiles.splice(i, 1); continue; }
        let narrowLedge=false;
        if(!clod.slurry&&hit.normal.y>.4&&clod.contacts>=2){
          const r=Math.cbrt(clod.mass/DENSITY)*.9,right=new THREE.Vector3(1,0,0).projectOnPlane(hit.normal).normalize(),forward=new THREE.Vector3().crossVectors(hit.normal,right).normalize();let supported=0;
          for(const axis of [right,forward])for(const sign of [-1,1]){
            const probe=hit.point.clone().addScaledVector(axis,r*sign).addScaledVector(hit.normal,.025),support=this.contact(probe,hit.normal.clone().negate(),.04);
            if(support&&support.normal.y>.25&&support.distance<.035)supported++;
          }
          narrowLedge=supported<4;
        }
        if((clod.slurry||narrowLedge||hit.normal.y<.92)&&hit.normal.y>.25){
          // Diluted material flows along a ledge to its real edge; it does not
          // gain a new yield stress and freeze into stacked solid pancakes.
          const flow=new THREE.Vector3(0,-.12,.30).projectOnPlane(hit.normal);
          clod.velocity.copy(flow);clod.mesh.position.copy(hit.point).addScaledVector(hit.normal,.010);
          continue;
        }
        if (hit.normal.y > .4 && clod.contacts >= 2 && Math.abs(clod.velocity.dot(hit.normal)) < 1.6) {
          this.restOnLedge(clod, hit); this.projectiles.splice(i, 1); continue;
        }
        // Clear the newly deposited thickness as well as the old hit surface.
        clod.mesh.position.copy(hit.point).addScaledVector(hit.normal, .030);
        const vn = clod.velocity.dot(hit.normal); clod.velocity.addScaledVector(hit.normal, -vn).multiplyScalar(.3).addScaledVector(hit.normal, .16); clod.velocity.y = Math.min(-.4, clod.velocity.y - .22);
        const scale = Math.cbrt(clod.mass / .65); clod.mesh.scale.set(.032 * scale, .023 * scale, .045 * scale); continue;
      }
      clod.mesh.position.copy(next);
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
  private updateStages(): void { for (const point of this.points) if (point.stage === 'fitted' && (!point.boxGroup.userData.placement||point.boxGroup.userData.placement.secured) && this.evaluateCoverage(point, true) >= .68) point.setStage('mortared'); }
  coverage(point: InstallationPoint): number { return this.evaluateCoverage(point, false); }
  private evaluateCoverage(point: InstallationPoint, stableOnly: boolean): number {
    point.updateWorldMatrix(true, true);
    const key = `${point.definition.id}:${stableOnly}`, transform = point.boxGroup.matrixWorld.elements.map(v => v.toFixed(5)).join(',');
    const cached = this.coverageCache.get(key);
    if (cached && cached.revision === this.geometryRevision && cached.transform === transform && this.simulationTime - cached.time < .2) return cached.value;
    const width = point.boxGroup.groupWidth / 2 + .026, height = point.boxGroup.groupHeight / 2 + .024, counts = [0, 0, 0, 0];
    for (let side = 0; side < 4; side++) for (let i = 0; i < 12; i++) {
      const t = -.9 + 1.8 * i / 11;
      const q = new THREE.Vector3(side < 2 ? t * width : side === 2 ? -width : width, side < 2 ? side === 0 ? -height : height : t * height, .024).applyMatrix4(point.boxGroup.matrixWorld);
      const direction = new THREE.Vector3(0, 0, -1).transformDirection(point.boxGroup.matrixWorld);
      // The segment measures actual occupied material, including when its
      // origin is already inside a thick bed and no exit face lies within65mm.
      // This is the same finite, clipped field used by collision, not an XY mask.
      const hit=this.field.raycast(q,direction,.065);
      if(hit&&(!stableOnly||this.field.stateAt(hit.point).age>=1.3))counts[side]++;
    }
    const value = Math.min(...counts) / 12;
    this.coverageCache.set(key, { time: this.simulationTime, revision: this.geometryRevision, transform, value }); return value;
  }
  get telemetry() { return { angleDegrees: this.angleDegrees, power: this.charge, throwFeedback:this.throwFeedback, recovery: this.recovery, airborne: this.projectiles.length, launchedKg: this.launchedMass, stuckKg: this.stuckMass, restingKg: this.restingMass, restingBatches: this.resting.length, floorKg: this.floorMass, movingKg: this.pendingWashMass + this.projectiles.reduce((sum, clod) => sum + clod.mass, 0), washedKg: this.washedMass, volumeField: this.field.statistics, wetCells: this.water.size, patches: this.deposits.length, outcome: this.lastOutcome, initialStabilitySeconds: 1.3, freshWorkingSeconds: 3600, geometryLimit: MAX_PATCHES, coverage: this.points.map(point => ({ id: point.definition.id, fraction: this.coverage(point) })) }; }
}
