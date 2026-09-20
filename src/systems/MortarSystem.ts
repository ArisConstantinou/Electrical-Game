import * as THREE from 'three';
import type { InstallationPoint } from '../electrical/InstallationPoint';
import type { BrickWall } from '../world/BrickWall';
import { MortarField, type MortarFieldChunk, type MortarImpactFootprint } from './MortarField';
import { mortarImpactFootprint } from './MortarImpact';
import { WATER_GUN_MODES, type WaterGunSetting } from './WaterGun';
import { sampleTrowelMotion, TROWEL_CHARGE_SECONDS, TROWEL_FULL_CHARGE_GRACE_SECONDS, TROWEL_RELEASE_SECONDS, TROWEL_CAST_SECONDS } from '../player/TrowelMotion';

type WetBatch = { mesh: THREE.Mesh; used: number; live: number; free: Array<{ start: number; count: number }> };
type WetPatch = { batch: WetBatch; start: number; count: number; alpha: number; pending?:boolean };
type WaterCell = { pore: number; film: number; patch: WetPatch; position: THREE.Vector3; normal: THREE.Vector3; surfaceRevision?:number };
type Clod = { mesh: THREE.Mesh; velocity: THREE.Vector3; mass: number; age: number; contacts: number; slurry: boolean; bond: number; variation:number; cleanRelease:boolean; impactNormal?:THREE.Vector3 };
type Deposit = { fieldKey?: string; position: THREE.Vector3; radius: number; mass: number; mesh: THREE.Mesh; age: number; normal: THREE.Vector3; support: number };
type Contact = { point: THREE.Vector3; normal: THREE.Vector3; distance: number; box: boolean };
type Opening = { inverse: THREE.Matrix4; halfWidth: number; halfHeight: number; minZ: number; maxZ: number };
type FieldMeshBatch = { snapshot: MortarField; keys: string[]; chunks: MortarFieldChunk[]; openings: Opening[] };
const Z = new THREE.Vector3(0, 0, 1);
const DENSITY = 1900;
const MAX_PATCHES = 256;
// Bound each GPU buffer, rather than silently rejecting new wet wall areas.
const WET_BATCH_VERTICES = 12288;
// Overlap the 8 cm moisture lattice, so a swept wet surface has no dry pinholes.
const WET_FOOTPRINT_SIZE = .16;

/** One connected paste skin, with coarse clumps, thin torn lips and aggregate.
 * Four shared variants and one shared morph target avoid per-clod vertex work. */
function mortarClodGeometry(variant:number):THREE.BufferGeometry {
  const geometry=new THREE.SphereGeometry(1,32,20);
  const positions=geometry.getAttribute('position'),colors:number[]=[],stretched:number[]=[];
  const phase=variant*1.37;
  for(let i=0;i<positions.count;i++){
    const x=positions.getX(i),y=positions.getY(i),z=positions.getZ(i);
    const broad=Math.sin(x*5.3+z*3.7+phase)*Math.cos(y*4.8-z*3.1-phase);
    const folds=Math.sin(x*13.1+y*7.7+phase)*Math.sin(z*12.7-y*8.9);
    const grit=Math.sin(x*43.7+y*35.1+phase)*Math.cos(z*47.3-x*21.1);
    const radial=.96+broad*.25+folds*.11+grit*.026;
    // The free edge has alternating lobes and narrow, drooping paste fingers.
    const edge=Math.pow(Math.max(0,1-Math.abs(y)),3);
    const lip=edge*(.15*Math.sin(Math.atan2(z,x)*7+phase)+.07*Math.sin(Math.atan2(z,x)*13-phase));
    const px=x*(radial+lip),py=y*radial+edge*folds*.12,pz=z*(radial+lip);
    positions.setXYZ(i,px,py,pz);
    const trailing=THREE.MathUtils.clamp((1-z)*.5,0,1);
    stretched.push(px*(1-.23*trailing),py*(.9-.2*trailing)+.16*trailing*trailing,pz*(1.25+.25*trailing));
    const color=new THREE.Color(0x817969).multiplyScalar(.94+broad*.065+grit*.075+Math.max(0,folds)*.055);
    colors.push(color.r,color.g,color.b);
  }
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.computeVertexNormals();
  geometry.morphAttributes.position=[new THREE.Float32BufferAttribute(stretched,3)];
  const target=new THREE.BufferGeometry();target.setAttribute('position',new THREE.Float32BufferAttribute(stretched,3));target.setIndex(geometry.index!.clone());target.computeVertexNormals();
  geometry.morphAttributes.normal=[target.getAttribute('normal').clone()];target.dispose();
  geometry.computeBoundingSphere();
  const skin=geometry.toNonIndexed();geometry.dispose();return skin;
}

/** Qualitative wet mortar: finite mass, real surface contact and separate fresh-mortar stability.
 * See docs/MORTAR_APPLICATION_RESEARCH.md; these coefficients are not calibrated. */
export class MortarSystem {
  /** Optional physical batch; reservation happens once at the committed wrist release. */
  reserveScoop?: (requestedKg:number) => number;
  scoopBond?: () => number;
  hasScoop?: () => boolean;
  readonly group = new THREE.Group();
  readonly field = new MortarField();
  onRunoff?: (event: { point: THREE.Vector3; normal: THREE.Vector3; litres: number; mortarKg: number }) => void;
  onWaterEmission?: (event: { origin: THREE.Vector3; velocity: THREE.Vector3; litres: number }) => void;
  onLaunch?: (event:{speed:number;phase:number})=>void;
  onImpact?: (event:{speed:number;retainedKg:number;incidence:number})=>void;
  washedMass = 0;
  waterGunLitres = 0;
  readonly waterGunDirection = new THREE.Vector3(0, 0, -1);
  private pendingWashMass = 0;
  private readonly pendingWashPoint = new THREE.Vector3();
  private readonly pendingWashNormal = new THREE.Vector3(0,0,1);
  private fieldMeshTime = 0;
  private pendingFieldMesh:FieldMeshBatch|null=null;
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
  private readonly clodGeometry = mortarClodGeometry(0);
  private readonly clodGeometries = [this.clodGeometry,mortarClodGeometry(1),mortarClodGeometry(2),mortarClodGeometry(3)];
  private readonly clodMaterial = new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:.88,side:THREE.DoubleSide});
  private readonly clodDirection = new THREE.Vector3();
  private clodSequence = 0;
  private readonly wetGeometry = new THREE.PlaneGeometry(.125, .125);
  private readonly wetMaterial: THREE.MeshBasicMaterial;
  private readonly wetBatches: WetBatch[] = [];
  private readonly wetBatchMaterial: THREE.MeshBasicMaterial;
  private wetWallRevision=-1;
  private readonly pendingWetCells=new Set<WaterCell>();
  private readonly pendingWetBatch:WetBatch;
  private readonly ray = new THREE.Raycaster();
  private wasHeld = false;
  private heldSeconds = 0;
  private overheld = false;
  private releasedPhase = 0;
  private recoveringThrow = false;
  private pendingCast: { phase: number; elapsed: number } | null = null;
  private rearmOnRelease = false;
  private queuedRelease: number | null = null;
  private recoverySkipSeconds = 0;
  private releaseCount = 0;
  private faceSplash = 0;
  private maintenanceTime = 0;
  private simulationTime = 0;
  private geometryRevision = 0;
  private openingSignature = '';
  private previousOpenings: Opening[] = [];
  private supportRevision = '';
  private supportCacheTime = -Infinity;
  private supportVolume: unknown;
  private readonly supportColumns = new Map<string,number|null>();
  private readonly coverageCache = new Map<string, { time: number; revision: number; transform: string; value: number }>();
  private readonly streams: Array<{ mesh: THREE.Mesh; speed: number; life: number }> = [];
  private lastImpactFootprint:MortarImpactFootprint|null=null;

  constructor(scene: THREE.Scene, private readonly wall: BrickWall, private readonly points: InstallationPoint[]) {
    this.group.name = 'Wet mortar, water and construction spills';
    this.group.userData.studioEntityId = 'mortar-application';
    scene.add(this.group); this.group.add(this.target);
    this.target.visible = false; this.target.renderOrder = 8;
    // A separable feather sums to even coverage on the 8 cm lattice. Optical
    // absorption composes smoothly where saturated neighbours overlap, instead
    // of stamping dark radial dots into an otherwise dry-looking brick face.
    const size = 64, data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = x / (size-1) * 2 - 1, v = y / (size-1) * 2 - 1;
      const weight = (1-Math.abs(u)) * (1-Math.abs(v));
      const alpha = 1-Math.exp(-.55*weight);
      const i = (y * size + x) * 4; data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = Math.round(alpha * 255);
    }
    const texture = new THREE.DataTexture(data, size, size);texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.needsUpdate = true;
    this.wetMaterial = new THREE.MeshBasicMaterial({ color: 0x302d22, map: texture, transparent: true, opacity: .2, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide });
    this.wetBatchMaterial = this.wetMaterial.clone();
    this.wetBatchMaterial.vertexColors = true; this.wetBatchMaterial.opacity = 1;
    // Pending patches draw zero vertices. This tiny shared sample also warms
    // the exact wet batch attributes before the first hose contact.
    const placeholder=new THREE.BufferGeometry();
    placeholder.setAttribute('position',new THREE.Float32BufferAttribute([-.02,-.02,0,.02,-.02,0,0,.02,0],3));
    placeholder.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,.5,1],2));
    placeholder.setAttribute('color',new THREE.BufferAttribute(new Uint8Array(12).fill(255),4,true));
    this.pendingWetBatch={mesh:new THREE.Mesh(placeholder,this.wetBatchMaterial),used:0,live:0,free:[]};
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
  /** Seed the actual mortar field around an installed box group. This is the
   * same finite collision/coverage volume produced by player trowel casts. */
  prepareInstalledBox(point:InstallationPoint):number {
    point.updateWorldMatrix(true,true);
    const width=point.boxGroup.groupWidth/2+.026,height=point.boxGroup.groupHeight/2+.024;
    let added=0;
    for(let side=0;side<4;side++)for(let i=0;i<20;i++){
      const t=-.9+1.8*i/19;
      const local=new THREE.Vector3(side<2?t*width:side===2?-width:width,side<2?side===0?-height:height:t*height,-.025);
      added+=this.deposit(local.applyMatrix4(point.boxGroup.matrixWorld),.08,Z,false,.18,undefined,side*.19+i*.07,true);
    }
    this.stuckMass+=added;
    this.field.finishImpact();
    this.field.tick(1.4);
    this.syncFieldGeometry();
    return added;
  }
  cancel(): void {
    this.wasHeld = false; this.charge = 0; this.heldSeconds = 0; this.overheld = false;
    if (this.pendingCast) { this.pendingCast = null; this.releasedPhase = 0; this.recoveringThrow = false; }
    this.rearmOnRelease = false;
    this.queuedRelease = null;
  }
  /** Timing controls one finite scoop; the committed wrist motion releases it
   * later, at the actual blade position rather than at the button-up pose. */
  get throwFeedback() {
    const recovering=this.recovery>0&&this.recoveringThrow;
    const casting=Boolean(this.pendingCast)||recovering;
    const active=this.wasHeld||casting,phase=this.wasHeld?this.charge:this.pendingCast?.phase??(recovering?this.releasedPhase:0);
    const quality:'ready'|'early'|'perfect'|'late'=this.overheld||!active?'ready':phase<.42?'early':phase<=.58?'perfect':'late';
    const castElapsed=this.pendingCast?.elapsed??(recovering?TROWEL_CAST_SECONDS-this.recovery:null);
    // Expiring the throwing bar does not move or reload the held trowel.
    const motion=sampleTrowelMotion({holding:this.wasHeld,charge:casting?(this.pendingCast?.phase??this.releasedPhase):this.overheld?1:phase,castElapsed});
    motion.loadVisible=motion.loadVisible&&(this.hasScoop?.()??true);
    return {holding:this.wasHeld,overheld:this.overheld,phase,quality,swingDegrees:motion.rollDegrees,strength:phase,splash:this.faceSplash,lastRelease:this.releaseCount,casting,castElapsed,stage:motion.stage,motion};
  }
  swing(held: boolean, dt: number, camera: THREE.Camera, origin: THREE.Vector3 | (() => THREE.Vector3)): void {
    dt=Math.max(0,Number.isFinite(dt)?dt:0);
    // A cast already required button-up. Any new hold is a new gesture, even
    // while the wrist returns. Charge it now and retain at most one release.
    this.chargeInput(held,dt);
    if (this.pendingCast) {
      this.pendingCast.elapsed=Math.min(TROWEL_CAST_SECONDS,this.pendingCast.elapsed+dt);
      if(this.pendingCast.elapsed+1e-9<TROWEL_RELEASE_SECONDS)return;
      const phase=this.pendingCast.phase,elapsed=this.pendingCast.elapsed;
      // The phase clock is already advanced when the rig samples its pose.
      const point=typeof origin==='function'?origin():origin;
      this.releaseScoop(phase,camera,point);
      this.pendingCast=null;
      this.recovery=Math.max(0,TROWEL_CAST_SECONDS-elapsed);this.recoveringThrow=true;
      // Game calls swing and update for the same physics slice. The pending
      // clock already consumed that slice, so recovery must not consume it twice.
      this.recoverySkipSeconds=dt;
      return;
    }
    if (this.recovery > 0) return;
    if(this.queuedRelease!==null){
      this.releasedPhase=this.queuedRelease;this.pendingCast={phase:this.queuedRelease,elapsed:0};this.queuedRelease=null;
    }
  }
  private chargeInput(held:boolean,dt:number):void {
    if(this.queuedRelease!==null)return;
    if(this.rearmOnRelease){if(!held){this.rearmOnRelease=false;if(this.overheld)this.wasHeld=false;this.overheld=false;}return;}
    if (held) {
      this.heldSeconds += dt;
      if(this.heldSeconds + 1e-9 >= TROWEL_CHARGE_SECONDS + TROWEL_FULL_CHARGE_GRACE_SECONDS){
        // Expiry must neither commit a cast nor start charging another scoop
        // under the same finger. Only a release and fresh press can rearm it.
        this.wasHeld=true;this.charge=0;this.heldSeconds=0;
        this.overheld=true;this.rearmOnRelease=true;this.releasedPhase=0;
        this.lastOutcome='Throwing bar reset: release, then hold again to charge.';
        return;
      }
      this.wasHeld = true; this.charge = Math.min(1, this.heldSeconds / TROWEL_CHARGE_SECONDS);
    }
    else if (this.wasHeld) {
      this.queuedRelease=this.charge;
      this.wasHeld=false;this.charge=0;this.heldSeconds=0;
    }
  }
  private releaseScoop(phase:number,camera:THREE.Camera,tip:THREE.Vector3):void {
    const late=THREE.MathUtils.clamp((phase-.58)/.42,0,1),backFraction=late*.55;
    // Reserve the whole finite scoop atomically, including its backward share.
    if(this.projectiles.length+(late>0?3:1)>48)return;
    const origin=this.releaseOrigin(camera,tip),quality=this.scoopBond?.()??1;
    const mass=this.reserveScoop?.(.65)??.65;
    if(!Number.isFinite(mass)||mass<=0){this.lastOutcome='No ready mortar nearby. Mix a batch and bring the bucket to the work.';return;}
    const bond=(phase<.42?.04+.96*(phase/.42)**2:1)*quality;
    const launchVelocity=this.velocity(camera,phase,origin);this.spawnClod(origin,launchVelocity,mass*(1-backFraction),false,bond,phase>=.42&&phase<=.58);this.onLaunch?.({speed:launchVelocity.length(),phase});
    if(late>0){
      const towardFace=camera.getWorldPosition(new THREE.Vector3()).sub(origin);
      if(towardFace.lengthSq()<1e-6)camera.getWorldDirection(towardFace).negate();
      towardFace.normalize().multiplyScalar(1.6+late*2.4);
      const right=new THREE.Vector3(1,0,0).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
      for(const side of [-1,1])this.spawnClod(origin,towardFace.clone().addScaledVector(right,side*.35),mass*backFraction/2,true,0);
    }
    this.launchedMass+=mass;this.releasedPhase=phase;this.releaseCount++;this.faceSplash=Math.max(this.faceSplash,late);
    this.lastOutcome=phase<.42?'Early release: weak adhesion; loose mortar will slide down.':late>0?'Late release: mortar splashes back; part of the scoop still reaches the wall.':'Perfect release: good transfer; aim at clean, damp masonry.';
  }
  velocity(camera: THREE.Camera, power: number, origin?: THREE.Vector3): THREE.Vector3 {
    const direction = camera.getWorldDirection(new THREE.Vector3());
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
    const speed=2+THREE.MathUtils.clamp(power,0,1)*6;
    if(origin){
      const hit=this.contact(camera.getWorldPosition(new THREE.Vector3()),direction,8);
      if(hit){
        // Converge the offset blade onto the crosshair, including gravity. A
        // parallel camera ray used to coat the rim above the intended cavity.
        const delta=hit.point.clone().sub(origin),b=9.81*delta.y-speed*speed;
        const discriminant=b*b-9.81*9.81*delta.lengthSq();
        if(discriminant>=0&&b<0&&delta.lengthSq()>1e-8){
          const time=Math.sqrt(2*delta.lengthSq()/(-b+Math.sqrt(discriminant)));
          const velocity=delta.multiplyScalar(1/time);velocity.y+=4.905*time;
          // The default 12-degree loft is the sighted setting. Manual loft
          // adjustments still raise/lower the cast; timing retains its speed.
          return velocity.applyAxisAngle(right,THREE.MathUtils.degToRad(this.angleDegrees-12));
        }
      }
    }
    return direction.applyAxisAngle(right, THREE.MathUtils.degToRad(this.angleDegrees)).multiplyScalar(speed);
  }
  /** A close wrist swing can put the model's tip through a wall or the growing
   * bed. Start on the visible side of the first obstruction, never inside it. */
  private releaseOrigin(camera: THREE.Camera, tip: THREE.Vector3): THREE.Vector3 {
    const eye=camera.getWorldPosition(new THREE.Vector3()),direction=tip.clone().sub(eye),distance=direction.length();
    if(distance<1e-8)return tip.clone();
    direction.multiplyScalar(1/distance);
    const hit=this.contact(eye,direction,distance+.025);
    let travel=hit?Math.max(0,hit.distance-.025):distance;
    const frontZ=this.wall.volume.frontZ;
    // A tip inside an OPEN hollow also starts beyond the receiving face and
    // sends the scoop sideways into internal ribs, especially on mobile.
    if(typeof frontZ==='number'&&eye.z>frontZ+.05&&direction.z<-.001)
      travel=Math.min(travel,(frontZ+.05-eye.z)/direction.z);
    return eye.addScaledVector(direction,travel);
  }
  preview(camera: THREE.Camera, origin: THREE.Vector3, visible: boolean): void {
    this.target.visible = false; if (!visible) return;
    const p = this.releaseOrigin(camera,origin), v = this.velocity(camera, this.wasHeld ? this.charge : .5,p);
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
    const volume=this.wall.volume;
    // Pristine planar masonry retains its compact regular footprint. Once the
    // substrate is fractured, use its actual facets rather than joining 40 mm
    // samples across 8 mm fracture geometry and crossing back into the wall.
    if(typeof volume.surfaceTriangles==='function'&&volume.surfaceRevisionAt(point)>0&&this.field.sample(point)<.1)return this.fractureWaterFootprint(point,normal,origin);
    const rotation = new THREE.Quaternion().setFromUnitVectors(Z, normal), inverse = rotation.clone().invert();
    const samples: Array<THREE.Vector3 | null> = [], size = 4, positions: number[] = [], uvs: number[] = [];
    for (let y = 0; y <= size; y++) for (let x = 0; x <= size; x++) {
      const target = new THREE.Vector3((x / size - .5) * WET_FOOTPRINT_SIZE, (y / size - .5) * WET_FOOTPRINT_SIZE, 0).applyQuaternion(rotation).add(point);
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
        positions.push(local.x, local.y, local.z); uvs.push(local.x / WET_FOOTPRINT_SIZE + .5, local.y / WET_FOOTPRINT_SIZE + .5);
      }
    };
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const a = y * (size + 1) + x; add(a, a + 1, a + size + 2); add(a, a + size + 2, a + size + 1); }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.computeVertexNormals(); return geometry;
  }
  private fractureWaterFootprint(point:THREE.Vector3,normal:THREE.Vector3,origin:THREE.Vector3):THREE.BufferGeometry{
    const rotation=new THREE.Quaternion().setFromUnitVectors(Z,normal),inverse=rotation.clone().invert(),bounds=new THREE.Box3();
    const half=WET_FOOTPRINT_SIZE*.5,depth=.035;
    for(const x of [-half,half])for(const y of [-half,half])for(const z of [-depth,depth])bounds.expandByPoint(new THREE.Vector3(x,y,z).applyQuaternion(rotation).add(point));
    const facets=this.wall.volume.surfaceTriangles(bounds.min,bounds.max),positions:number[]=[],uvs:number[]=[],openings=this.openings();
    // Bin the actual facets in the spray's projective plane. Visibility then
    // intersects a handful of nearby triangles instead of marching the full
    // masonry field once for every tessellated facet.
    const localOrigin=origin.clone().sub(point).applyQuaternion(inverse),bins=new Map<string,THREE.Vector3[][]>();
    const localTriangles:THREE.Vector3[][]=[];
    const projected=(p:THREE.Vector3)=>({x:(p.x-localOrigin.x)*localOrigin.z/(localOrigin.z-p.z)+localOrigin.x,y:(p.y-localOrigin.y)*localOrigin.z/(localOrigin.z-p.z)+localOrigin.y});
    const binSize=.008;
    const extent=half*localOrigin.z/(localOrigin.z-depth),minBin=Math.floor(-extent/binSize),maxBin=Math.floor(extent/binSize);
    for(let i=0;i<facets.length;i+=9){
      const triangle=[0,3,6].map(offset=>new THREE.Vector3().fromArray(facets,i+offset).sub(point).applyQuaternion(inverse));localTriangles.push(triangle);
      const screen=triangle.map(projected),x0=Math.max(minBin,Math.floor(Math.min(...screen.map(p=>p.x))/binSize)),x1=Math.min(maxBin,Math.floor(Math.max(...screen.map(p=>p.x))/binSize)),y0=Math.max(minBin,Math.floor(Math.min(...screen.map(p=>p.y))/binSize)),y1=Math.min(maxBin,Math.floor(Math.max(...screen.map(p=>p.y))/binSize));
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const key=`${x},${y}`,list=bins.get(key);if(list)list.push(triangle);else bins.set(key,[triangle]);}
    }
    const visibilityRay=new THREE.Ray(localOrigin),intersection=new THREE.Vector3();
    const clip=(polygon:THREE.Vector3[],axis:'x'|'y'|'z',limit:number,sign:number):THREE.Vector3[]=>{
      const result:THREE.Vector3[]=[];
      for(let i=0;i<polygon.length;i++){
        const a=polygon[i],b=polygon[(i+1)%polygon.length],da=limit-sign*a[axis],db=limit-sign*b[axis];
        if(da>=0)result.push(a);
        if((da>=0)!==(db>=0))result.push(a.clone().lerp(b,da/(da-db)));
      }
      return result;
    };
    for(let i=0;i<facets.length;i+=9){
      const triangle=[0,3,6].map(offset=>new THREE.Vector3().fromArray(facets,i+offset));
      const faceNormal=new THREE.Vector3().subVectors(triangle[1],triangle[0]).cross(new THREE.Vector3().subVectors(triangle[2],triangle[0]));
      if(faceNormal.lengthSq()<1e-18)continue;
      faceNormal.normalize();
      if(faceNormal.dot(normal)<.15)continue;
      let polygon=localTriangles[i/9];
      for(const axis of ['x','y','z'] as const)for(const sign of [-1,1])polygon=clip(polygon,axis,axis==='z'?depth:half,sign);
      if(polygon.length<3)continue;
      const world=polygon.map(p=>p.clone().applyQuaternion(rotation).add(point));
      const center=polygon.reduce((sum,p)=>sum.add(p),new THREE.Vector3()).multiplyScalar(1/polygon.length),screen=projected(center),distance=center.distanceTo(localOrigin);
      visibilityRay.direction.copy(center).sub(localOrigin).normalize();
      if((bins.get(`${Math.floor(screen.x/binSize)},${Math.floor(screen.y/binSize)}`)??[]).some(face=>visibilityRay.intersectTriangle(face[0],face[1],face[2],false,intersection)&&intersection.distanceTo(localOrigin)<distance-.00001))continue;
      for(const piece of this.clipOpenings(world,openings))for(let j=1;j<piece.length-1;j++){
        // Clipping can leave sub-pixel slivers smaller than the surface offset.
        if(new THREE.Triangle(piece[0],piece[j],piece[j+1]).getArea()<1e-8)continue;
        for(const vertex of [piece[0],piece[j],piece[j+1]]){
        const local=vertex.clone().sub(point).applyQuaternion(inverse);
        uvs.push(local.x/WET_FOOTPRINT_SIZE+.5,local.y/WET_FOOTPRINT_SIZE+.5);
        local.copy(vertex).addScaledVector(faceNormal,.0001).sub(point).applyQuaternion(inverse);positions.push(local.x,local.y,local.z);
        }
      }
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.userData.conforming=true;return geometry;
  }
  /** Keep all contacted moisture cells; several hundred clipped footprints share
   * one draw call. A render-object budget must never become an absorption limit. */
  private addWetPatch(point: THREE.Vector3, normal: THREE.Vector3): WetPatch {
    // Centre the visual footprint on its moisture lattice rather than the first
    // random ray inside it; neighbouring hits then produce an even soaked area.
    const rotation=new THREE.Quaternion().setFromUnitVectors(Z,normal),center=point.clone().applyQuaternion(rotation.clone().invert());
    center.x=Math.round(center.x/.08)*.08;center.y=Math.round(center.y/.08)*.08;center.applyQuaternion(rotation);
    const receiving=this.contact(center.clone().addScaledVector(normal,.18),normal.clone().negate(),.20);
    if(receiving&&!receiving.box&&receiving.normal.dot(normal)>.95&&receiving.point.distanceTo(center)<.008)center.copy(receiving.point);
    else center.copy(point);
    const geometry=this.waterFootprint(center,normal,center.clone().addScaledVector(normal,.18));
    const source=geometry.getAttribute('position'),uv=geometry.getAttribute('uv'),count=source.count;
    let batch:WetBatch|undefined,start=0;
    for(const candidate of this.wetBatches){
      const index=candidate.free.findIndex(slot=>slot.count>=count);
      if(index>=0){batch=candidate;const slot=candidate.free[index];start=slot.start;slot.start+=count;slot.count-=count;if(!slot.count)candidate.free.splice(index,1);break;}
      if(candidate.used+count<=candidate.mesh.geometry.getAttribute('position').count){batch=candidate;start=candidate.used;candidate.used+=count;break;}
    }
    if(!batch){
      const capacity=Math.max(WET_BATCH_VERTICES*(geometry.userData.conforming?4:1),count),buffer=new THREE.BufferGeometry();
      buffer.setAttribute('position',new THREE.BufferAttribute(new Float32Array(capacity*3),3).setUsage(THREE.DynamicDrawUsage));
      buffer.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(capacity*2),2).setUsage(THREE.DynamicDrawUsage));
      const colors=new Uint8Array(capacity*4);colors.fill(255);
      buffer.setAttribute('color',new THREE.BufferAttribute(colors,4,true).setUsage(THREE.DynamicDrawUsage));
      const mesh=new THREE.Mesh(buffer,this.wetBatchMaterial);mesh.name='Batched absorbed masonry moisture';mesh.frustumCulled=false;
      batch={mesh,used:count,live:0,free:[]};this.wetBatches.push(batch);this.group.add(mesh);
    }
    batch.live++;
    const positions=batch.mesh.geometry.getAttribute('position') as THREE.BufferAttribute,uvs=batch.mesh.geometry.getAttribute('uv') as THREE.BufferAttribute;
    const offset=center.clone().addScaledVector(normal,geometry.userData.conforming?0:.0015),p=new THREE.Vector3();
    for(let i=0;i<count;i++){p.fromBufferAttribute(source,i).applyQuaternion(rotation).add(offset);positions.setXYZ(start+i,p.x,p.y,p.z);uvs.setXY(start+i,uv.getX(i),uv.getY(i));}
    positions.addUpdateRange(start*3,count*3);positions.needsUpdate=true;uvs.addUpdateRange(start*2,count*2);uvs.needsUpdate=true;
    batch.mesh.geometry.setDrawRange(0,batch.used);geometry.dispose();
    const patch={batch,start,count,alpha:-1};this.setWetAlpha(patch,0);return patch;
  }
  private setWetAlpha(patch:WetPatch,opacity:number):void {
    if(patch.pending)return;
    const alpha=Math.round(THREE.MathUtils.clamp(opacity,0,1)*255);if(alpha===patch.alpha)return;patch.alpha=alpha;
    const colors=patch.batch.mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    for(let i=patch.start;i<patch.start+patch.count;i++)colors.array[i*4+3]=alpha;
    colors.addUpdateRange(patch.start*4,patch.count*4);colors.needsUpdate=true;
  }
  private removeWetPatch(patch:WetPatch):void {
    if(patch.pending)return;
    this.setWetAlpha(patch,0);const batch=patch.batch;
    batch.free.push({start:patch.start,count:patch.count});batch.live--;
    if(!batch.live){this.group.remove(batch.mesh);batch.mesh.geometry.dispose();this.wetBatches.splice(this.wetBatches.indexOf(batch),1);}
  }
  private pendingWetPatch():WetPatch{return{batch:this.pendingWetBatch,start:0,count:0,alpha:0,pending:true};}
  get pendingWetGeometry():number{return this.pendingWetCells.size;}
  /** Called once per presented frame, outside physics catch-up. Water absorption
   * is immediate; only its surface tessellation waits in this lossless queue. */
  flushWetGeometry(limit=1,budgetMs=Infinity):number{
    let built=0;const started=performance.now();
    while(built<limit&&this.pendingWetCells.size){
      const cell=this.pendingWetCells.values().next().value!;this.pendingWetCells.delete(cell);
      cell.patch=this.addWetPatch(cell.position,cell.normal);
      cell.surfaceRevision=this.wall.volume.surfaceRevisionAt?.(cell.position);
      this.setWetAlpha(cell.patch,.65*cell.pore+.35*cell.film);built++;
      if(performance.now()-started>=budgetMs)break;
    }
    return built;
  }
  moistureAt(p: THREE.Vector3): { pore: number; film: number } {
    const exact = this.water.get(this.waterKey(p)); if (exact) return exact;
    let best: WaterCell | undefined, distance = .10;
    for (const cell of this.water.values()) { const d = cell.position.distanceTo(p); if (d < distance && Math.abs(cell.position.z - p.z) < .025) { distance = d; best = cell; } }
    return best ?? { pore: 0, film: 0 };
  }
  retention(p: THREE.Vector3, v: THREE.Vector3, normal: THREE.Vector3, cleanRelease=false): number {
    const wet = this.moistureAt(p), speed = v.length(), incidence = Math.max(0, -v.clone().normalize().dot(normal));
    const receiver=this.field.stateAt(p.clone().addScaledVector(normal,-.006));
    let prepared=receiver.value>.35&&receiver.age<3600?.90*(1-Math.min(.65,receiver.dilution*.3)):(.35+.65*Math.min(1,wet.pore/.45));
    const volume=this.wall.volume,depth=volume.frontZ-p.z,incoming=speed>0?Math.max(0,-v.z/speed):0;
    // A scoop driven into a real backed recess keys between its exposed ribs.
    // A tiny grazing facet cannot reject the entire scoop as if it struck an
    // open flat wall. Called only after contact with an actual receiver;
    // deposition still requires backed, unblocked columns. Outward residue
    // receives no confinement boost and open-air rays never reach this path.
    const confined=incoming>.2&&depth>.012&&depth<(volume.depth??.2)+.008
      ? THREE.MathUtils.smoothstep(depth,.012,.035) : 0;
    if(confined>0)prepared=Math.max(prepared,.88*confined);
    // Judge a sighted transfer by its approach to the wall, not the tiny rib
    // or fresh-mortar facet first touched. Capacity still clips the real void.
    const wallApproach=cleanRelease&&depth>=-.012&&depth<(volume.depth??.2)+.008?incoming:0;
    const effectiveIncidence=Math.max(incidence,wallApproach,confined*(.65+.25*incoming));
    // A correctly timed wrist transfer seats a cohesive scoop against the
    // receiver. Dry brick must not reject a compulsory 5% of every perfect
    // scoop before the volume solver checks available room. Oblique,
    // flooded and low-energy contacts still lose material; capacity remains
    // authoritative and poor batch quality is applied separately below.
    if(cleanRelease){
      prepared=Math.max(prepared,1-Math.min(.65,receiver.dilution*.3));
      const seating=THREE.MathUtils.smoothstep(effectiveIncidence,.35,.70);
      const incidenceTransfer=THREE.MathUtils.lerp(effectiveIncidence**1.3,1,seating);
      return THREE.MathUtils.clamp(prepared*(1-.8*wet.film)*Math.min(1,speed/2)*incidenceTransfer/(1+Math.max(0,speed-6)*.12),0,1);
    }
    return THREE.MathUtils.clamp(prepared * (1 - .8 * wet.film) * Math.min(1, speed / 2) * effectiveIncidence ** 1.3 / (1 + Math.max(0, speed - 6) * .12), 0, .93);
  }
  launch(origin: THREE.Vector3, velocity: THREE.Vector3, mass = .65): void {
    if (this.projectiles.length >= 48 || !Number.isFinite(mass) || mass <= 0) return;
    this.spawnClod(origin, velocity, mass); this.launchedMass += mass;
  }
  createRenderWarmup():THREE.Group{
    const group=new THREE.Group();group.name='Mortar render warmup';group.userData.transient=true;
    for(const geometry of this.clodGeometries){const mesh=new THREE.Mesh(geometry,this.clodMaterial);mesh.castShadow=true;mesh.frustumCulled=false;mesh.scale.setScalar(.04);group.add(mesh);}
    const deposit=new THREE.Mesh(this.wetGeometry,this.mortarMaterial);deposit.castShadow=deposit.receiveShadow=true;deposit.frustumCulled=false;group.add(deposit);
    const wet=new THREE.Mesh(this.pendingWetBatch.mesh.geometry,this.wetBatchMaterial);wet.frustumCulled=false;group.add(wet);
    return group;
  }
  private spawnClod(origin: THREE.Vector3, velocity: THREE.Vector3, mass: number, slurry = false, bond = 1, cleanRelease=false): void {
    const variation=this.clodSequence++,mesh = new THREE.Mesh(this.clodGeometries[variation%this.clodGeometries.length], this.clodMaterial); mesh.position.copy(origin); mesh.castShadow = true;
    mesh.name='Cohesive wet mortar with ragged edges';
    const clod={ mesh, velocity: velocity.clone(), mass, age: 0, contacts: 0, slurry, bond, variation, cleanRelease };
    this.updateClodAppearance(clod);
    this.group.add(mesh); this.projectiles.push(clod);
  }
  private updateClodAppearance(clod:Clod):void {
    const scale=Math.cbrt(clod.mass/.65),speed=clod.velocity.length();
    if(clod.impactNormal){
      // Rejected paste has already flattened against its receiver. Keep that
      // contact frame while gravity carries it down; aligning the skin to the
      // rebound velocity made it flip beside the adhered bed and inflate again.
      if(clod.mesh.morphTargetInfluences)clod.mesh.morphTargetInfluences[0]=0;
      // Preserve the flying skin's scale volume while spreading it tangentially.
      clod.mesh.scale.set(.075*scale,.066*scale,(.046*.030*.064/(.075*.066))*scale);
      clod.mesh.quaternion.setFromUnitVectors(Z,clod.impactNormal);
      return;
    }
    const stretch=(.3+.7*Math.exp(-clod.age*5))*Math.min(1,speed/4);
    if(clod.mesh.morphTargetInfluences)clod.mesh.morphTargetInfluences[0]=stretch;
    clod.mesh.scale.set(.046*scale,.030*scale,.064*scale);
    if(speed>.01)clod.mesh.quaternion.setFromUnitVectors(Z,this.clodDirection.copy(clod.velocity).multiplyScalar(1/speed));
  }
  /** Compatibility entry point: material is added only by a released scoop. */
  pack(_camera: THREE.Camera): boolean { return false; }

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

  private deposit(p: THREE.Vector3, mass: number, normal: THREE.Vector3, sync=true,footprintMass=mass,impactVelocity?:THREE.Vector3,variation=0,seatScoop=false): number {
    if (mass <= .001) return 0;
    // An impact facet must not rotate a separate sheet. Wet material joins a
    // fixed-world scalar volume and grows along the working face.
    const growth = normal.z > .25 ? normal.clone().lerp(Z, .65).normalize() : normal.clone();
    const volume = this.wall.volume;
    let boxes=this.openings(),blockerRevision=this.geometryRevision;
    const blocked = (q: THREE.Vector3): boolean => {
      // Settling outlives this impact by 0.24 s. A newly placed or rotated box
      // must immediately update its exclusion volume for those later steps.
      if(blockerRevision!==this.geometryRevision){boxes=this.openings();blockerRevision=this.geometryRevision;}
      if (typeof volume.isOccupied === 'function' && volume.isOccupied(q.x,q.y,q.z)) return true;
      return boxes.some(box => { const local=q.clone().applyMatrix4(box.inverse); return Math.abs(local.x)<box.halfWidth && Math.abs(local.y)<box.halfHeight && local.z>box.minZ && local.z<box.maxZ; });
    };
    const frontZ=typeof volume.frontZ==='number'?volume.frontZ:(normal.z>.5?0:undefined);
    const cacheSupport=typeof volume.removedNodeCount==='number';
    const supportRevision=`${volume.removedNodeCount}:${volume.impactCount}`;
    if(supportRevision!==this.supportRevision||this.supportVolume!==volume||this.simulationTime-this.supportCacheTime>.2||this.supportColumns.size>4096){
      this.supportRevision=supportRevision;this.supportVolume=volume;this.supportCacheTime=this.simulationTime;this.supportColumns.clear();
    }
    const impact=impactVelocity?mortarImpactFootprint(impactVelocity,normal,variation):undefined;if(impact)this.lastImpactFootprint=impact;
    const profile=frontZ===undefined?undefined:{frontZ,impact,supportZ:(x:number,y:number):number|null=>{
      const key=`${Math.round(x/this.field.spacing)},${Math.round(y/this.field.spacing)}`;
      if(cacheSupport&&this.supportColumns.has(key))return this.supportColumns.get(key)!;
      const origin=new THREE.Vector3(x,y,frontZ+.016),hit=volume.raycast(origin,new THREE.Vector3(0,0,-1),.22);
      const support=hit?hit.point.z:null;if(cacheSupport)this.supportColumns.set(key,support);return support;
    }};
    // Adhesion changes quantity, not the width of a scoop spreading across an
    // existing bed. Shrinking both trapped casts on full lips above empty gaps.
    const receiver=this.field.stateAt(p);
    const spread=seatScoop||receiver.value>=.35||(frontZ!==undefined&&frontZ-p.z>.012)?footprintMass:mass;
    const held = this.field.add(p, growth, mass, blocked,profile,spread);
    if (held > 0) { if(sync)this.syncFieldGeometry(); this.geometryRevision++; }
    return held;
  }

  private syncFieldGeometry(maxChunks=Infinity): void {
    // Explicit synchronous callers need the latest field (e.g. offline setup).
    // During play, freeze one immutable generation and prepare bounded chunks.
    // Live settling/washing may continue without restarting that batch.
    if(maxChunks===Infinity)this.cancelFieldMeshBatch();
    if(!this.pendingFieldMesh){
      if(!this.field.dirty.size)return;
      const snapshot=maxChunks===Infinity?this.field:this.field.createMeshSnapshot(),keys=[...snapshot.dirty];
      if(snapshot!==this.field)for(const key of keys)this.field.dirty.delete(key);
      this.pendingFieldMesh={snapshot,keys,chunks:[],openings:this.openings()};
    }
    const batch=this.pendingFieldMesh;
    batch.chunks.push(...batch.snapshot.remesh(triangle=>this.clipOpenings(triangle,batch.openings),maxChunks));
    if(batch.snapshot.dirty.size)return;
    // Publish every touching chunk together. Publishing one at a time exposed
    // different surfaces on either side of a seam after each plastic movement.
    for(const chunk of batch.chunks){
      const index=this.deposits.findIndex(d=>d.fieldKey===chunk.key),old=index<0?undefined:this.deposits[index];
      if(!chunk.geometry.getAttribute('position').count){chunk.geometry.dispose();if(old){this.group.remove(old.mesh);old.mesh.geometry.dispose();this.deposits.splice(index,1);}continue;}
      const sphere=chunk.geometry.boundingSphere!;
      if(old){old.mesh.geometry.dispose();old.mesh.geometry=chunk.geometry;old.position.copy(sphere.center);old.radius=sphere.radius;old.mass=chunk.mass;old.age=chunk.age;old.support=1-Math.min(1,chunk.dilution);}
      else {const mesh=new THREE.Mesh(chunk.geometry,this.mortarMaterial);mesh.name='Continuous wet mortar volume';mesh.castShadow=mesh.receiveShadow=true;this.group.add(mesh);this.deposits.push({fieldKey:chunk.key,position:sphere.center.clone(),radius:sphere.radius,mass:chunk.mass,mesh,age:chunk.age,normal:Z.clone(),support:1-Math.min(1,chunk.dilution)});}
    }
    this.pendingFieldMesh=null;
    this.fieldMeshTime=0;
  }
  private cancelFieldMeshBatch():void {
    const batch=this.pendingFieldMesh;if(!batch)return;
    for(const chunk of batch.chunks)chunk.geometry.dispose();
    for(const key of batch.keys)this.field.dirty.add(key);
    this.pendingFieldMesh=null;
  }
  get pendingGeometryChunks():number {return this.field.dirty.size+(this.pendingFieldMesh?.snapshot.dirty.size??0);}
  async waitForGeometry():Promise<void> {while(this.pendingGeometryChunks||this.pendingWetCells.size){if(this.pendingGeometryChunks)this.syncFieldGeometry(1);this.flushWetGeometry(1);await new Promise(resolve=>setTimeout(resolve,0));}}

  /** A pressed box extrudes fresh mortar out of its occupied envelope. Backing
   * behind the actual casing stays in place; excess remains counted as slurry. */
  pressBox(point:InstallationPoint):{displacedKg:number;repackedKg:number;looseKg:number}{
    this.cancelFieldMeshBatch();
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
    this.openingSignature='';this.geometryRevision++;
    return{displacedKg:removed,repackedKg:held,looseKg:loose};
  }

  private refreshOpeningGeometry(): void {
    const boxes=this.openings(),signature=boxes.map(box=>box.inverse.elements.map(v=>v.toFixed(5)).join(',')).join('|');
    if(signature===this.openingSignature)return;this.openingSignature=signature;
    this.cancelFieldMeshBatch();
    const removed=this.field.removeWhere(q=>boxes.some(box=>{const local=q.clone().applyMatrix4(box.inverse);return Math.abs(local.x)<box.halfWidth&&Math.abs(local.y)<box.halfHeight && local.z>box.minZ && local.z<box.maxZ;}));
    if(removed>0){this.stuckMass=Math.max(0,this.stuckMass-removed);const point=this.deposits[0]?.position??new THREE.Vector3(0,1,0);this.queueSlurry(point,Z,removed);}
    // Clipping only changes in the old/new opening prisms. Invalidating the
    // whole bed delayed a small insertion by more than a second on large beds.
    const changed=[...boxes.filter(box=>!this.previousOpenings.some(old=>old.inverse.equals(box.inverse))),...this.previousOpenings.filter(old=>!boxes.some(box=>box.inverse.equals(old.inverse)))];
    for(const box of changed){
      const transform=box.inverse.clone().invert(),bounds=new THREE.Box3();
      for(const x of [-box.halfWidth,box.halfWidth])for(const y of [-box.halfHeight,box.halfHeight])for(const z of [box.minZ,box.maxZ])bounds.expandByPoint(new THREE.Vector3(x,y,z).applyMatrix4(transform));
      this.field.invalidateRegion(bounds.min,bounds.max);
    }
    this.previousOpenings=boxes;this.geometryRevision++;
  }

  private queueSlurry(point:THREE.Vector3,normal:THREE.Vector3,mass:number):void {
    if(mass<=0)return;this.pendingWashPoint.multiplyScalar(this.pendingWashMass).addScaledVector(point,mass);this.pendingWashMass+=mass;this.pendingWashPoint.multiplyScalar(1/this.pendingWashMass);this.pendingWashNormal.copy(normal);
  }

  /** Litres are a delivered quantity, not litres/second. Fresh mortar can be
   * diluted/washed away; substrate prewetting is a separate state. */
  applyWater(point:THREE.Vector3,normal:THREE.Vector3,litres:number):{absorbedLitres:number;runoffLitres:number;washedMortarKg:number} {
    litres=Math.max(0,litres);let cell=this.water.get(this.waterKey(point));
    if(!cell){cell={pore:0,film:0,patch:this.pendingWetPatch(),position:point.clone(),normal:normal.clone(),surfaceRevision:this.wall.volume.surfaceRevisionAt?.(point)};this.water.set(this.waterKey(point),cell);this.pendingWetCells.add(cell);}
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
    const updateStart=performance.now();
    dt = Math.min(.12, Math.max(0, dt)); this.simulationTime += dt;
    const recoveryDt=Math.max(0,dt-this.recoverySkipSeconds);
    this.recoverySkipSeconds=Math.max(0,this.recoverySkipSeconds-dt);
    this.recovery = Math.max(0, this.recovery - recoveryDt); this.faceSplash=Math.max(0,this.faceSplash-dt*.28);
    this.refreshOpeningGeometry();
    this.maintenanceTime += dt;
    const wallRevision=this.wall.volume.surfaceRevision;
    if(wallRevision!==undefined&&wallRevision!==this.wetWallRevision){
      this.wetWallRevision=wallRevision;
      for(const cell of this.water.values()){
        const revision=this.wall.volume.surfaceRevisionAt(cell.position);if(revision===cell.surfaceRevision)continue;
        this.removeWetPatch(cell.patch);cell.patch=this.pendingWetPatch();cell.surfaceRevision=revision;this.pendingWetCells.add(cell);
      }
    }
    for (const [key, cell] of this.water) {
      cell.pore = Math.max(0, cell.pore - dt * .0008); cell.film = Math.max(0, cell.film - dt * .045);
      this.setWetAlpha(cell.patch,.65 * cell.pore + .35 * cell.film);
      if (cell.pore < .002 && cell.film < .002) { this.removeWetPatch(cell.patch); this.pendingWetCells.delete(cell);this.water.delete(key); continue; }
      if (this.maintenanceTime > .4 && cell.film > .55 && this.streams.length < 30) {
        const mesh = new THREE.Mesh(this.wetGeometry, this.wetMaterial.clone()); mesh.scale.set(.14, .65, 1); mesh.position.copy(cell.position).addScaledVector(cell.normal, .003); mesh.quaternion.setFromUnitVectors(Z,cell.normal); this.group.add(mesh);
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
        if(released.mass>0){this.cancelFieldMeshBatch();this.stuckMass=Math.max(0,this.stuckMass-released.mass);this.queueSlurry(released.point,Z,released.mass);this.geometryRevision++;}
      }
    }
    for(const deposit of this.deposits)deposit.age+=dt;
    if(this.pendingWashMass>.002&&this.projectiles.length<48){this.spawnClod(this.pendingWashPoint.clone().addScaledVector(this.pendingWashNormal,.025),new THREE.Vector3(0,-.25,.08),this.pendingWashMass,true);this.pendingWashMass=0;}
    if (this.maintenanceTime > .4) { this.maintenanceTime = 0; this.updateStages(); }
    const steps = Math.max(1, Math.ceil(dt / .012)), h = dt / steps;
    for (let step = 0; step < steps; step++) for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const clod = this.projectiles[i], a = clod.mesh.position, next = a.clone().addScaledVector(clod.velocity, h); next.y -= .5 * 9.81 * h * h; clod.velocity.y -= 9.81 * h; clod.age += h;
      const d = next.clone().sub(a), hit = this.contact(a, d.clone().normalize(), d.length());
      if (hit) {
        clod.impactNormal??=hit.normal.clone().negate();
        const fraction = clod.slurry || hit.box || this.insideBox(hit.point) || clod.contacts > 2 ? 0 : this.retention(hit.point, clod.velocity, hit.normal,clod.cleanRelease&&clod.contacts===0)*clod.bond;
        // A clean wrist transfer spreads the same scoop over a wider receiving
        // area. If nearby fresh mortar already fills that first footprint,
        // continue feathering the PERFECT transfer outward instead of turning
        // the still cohesive remainder into an artificial floor clod.
        const targetMass=clod.mass*fraction;
        let held=this.deposit(hit.point,targetMass,hit.normal,false,clod.mass*(clod.cleanRelease?2.6:1),clod.velocity,clod.variation,clod.cleanRelease);
        if(clod.cleanRelease&&clod.contacts===0&&fraction>.999){
          for(const spread of [4.5,7,11]){
            const remaining=targetMass-held;if(remaining<.001)break;
            held+=this.deposit(hit.point,remaining,hit.normal,false,clod.mass*spread,clod.velocity,clod.variation,true);
          }
        }
        this.stuckMass += held;
        if(held>0){
          this.field.finishImpact();
          // Contact and its final union skin belong to the same presented
          // frame. Do not retire the flying scoop while an older snapshot is
          // still waiting to publish, then expand the adhered bed later.
          this.syncFieldGeometry();
        }
        if(clod.contacts===0&&!clod.slurry){const speed=clod.velocity.length(),incidence=speed>1e-6?Math.abs(clod.velocity.clone().multiplyScalar(1/speed).dot(hit.normal)):0;this.onImpact?.({speed,retainedKg:held,incidence});}
        clod.contacts++;
        clod.mass -= held;
        // Rejected weak throws cannot become a second, stronger throw when they
        // hit a lower rib. They flow down under the same contact/gravity solver.
        if(clod.bond<.999)clod.slurry=true;
        this.lastOutcome = held > .07 ? 'Mortar held. Fill all four sides before leveling.' : held > .005 ? 'Some mortar held; excess is falling.' : 'Little free capacity or glancing contact: excess slumps off.';
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
        continue;
      }
      clod.mesh.position.copy(next);
      if (next.y < .012) { this.settle(clod); this.projectiles.splice(i, 1); }
      // No age-based teleport to floor: trajectories continue falling under gravity.
    }
    for(const clod of this.projectiles)this.updateClodAppearance(clod);
    // Include this frame's impacts. Keep coherent seam publication, but use
    // the available frame budget instead of waiting one frame for every chunk.
    // Deposition itself shares this budget: do not add a remesh spike to an
    // expensive impact. A pending batch still gets one chunk after 100 ms so
    // sustained work cannot starve presentation indefinitely.
    for(let count=0;this.pendingGeometryChunks&&count<12;count++){
      if(performance.now()-updateStart>=8&&(count>0||this.fieldMeshTime<.1))break;
      this.syncFieldGeometry(1);
    }
  }
  /** Low-energy residue rests on the ledge it actually hit. It is neither glued
   * mortar nor floor waste, and contributes no installation coverage by itself. */
  private restOnLedge(clod: Clod, hit: Contact): void {
    this.restingMass += clod.mass;
    const radius = Math.max(.009, Math.cbrt(clod.mass / DENSITY) * 1.5);
    clod.mesh.position.copy(hit.point).addScaledVector(hit.normal, .006);
    clod.mesh.quaternion.setFromUnitVectors(Z, hit.normal); clod.mesh.scale.set(radius, radius * .8, .008); clod.mesh.updateMatrixWorld(true);
    if(clod.mesh.morphTargetInfluences)clod.mesh.morphTargetInfluences[0]=0;
    const source = clod.mesh.geometry.getAttribute('position'), positions: number[] = [], boxes = this.openings();
    for (let i = 0; i < source.count; i += 3) {
      const triangle = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(source, i + j).applyMatrix4(clod.mesh.matrixWorld));
      for (const polygon of this.clipOpenings(triangle, boxes)) for (let j = 1; j < polygon.length - 1; j++) for (const v of [polygon[0], polygon[j], polygon[j + 1]]) positions.push(v.x, v.y, v.z);
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); this.finishGeometry(geometry);
    clod.mesh.geometry = geometry; clod.mesh.material=this.mortarMaterial;clod.mesh.updateMorphTargets();clod.mesh.position.set(0, 0, 0); clod.mesh.quaternion.identity(); clod.mesh.scale.set(1, 1, 1); clod.mesh.updateMatrixWorld(true);
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
    if(clod.mesh.morphTargetInfluences)clod.mesh.morphTargetInfluences[0]=0;
    clod.mesh.quaternion.identity();
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
  get telemetry() { return { angleDegrees: this.angleDegrees, power: this.charge, throwFeedback:this.throwFeedback, recovery: this.recovery, airborne: this.projectiles.length, launchedKg: this.launchedMass, stuckKg: this.stuckMass, restingKg: this.restingMass, restingBatches: this.resting.length, floorKg: this.floorMass, movingKg: this.pendingWashMass + this.projectiles.reduce((sum, clod) => sum + clod.mass, 0), washedKg: this.washedMass, volumeField: this.field.statistics, lastImpactFootprint:this.lastImpactFootprint, wetCells: this.water.size, pendingWetGeometry:this.pendingWetGeometry, wetDrawCalls: this.wetBatches.length, patches: this.deposits.length, outcome: this.lastOutcome, initialStabilitySeconds: 1.3, freshWorkingSeconds: 3600, geometryLimit: MAX_PATCHES, coverage: this.points.map(point => ({ id: point.definition.id, fraction: this.coverage(point) })) }; }
}
