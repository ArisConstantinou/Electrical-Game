/// <reference types="vite/client" />
import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { attribute, dot, floor, fract, mix, positionWorld, sin, smoothstep, texture as sampleTexture, uniform, uv, vec2 } from 'three/tsl';
import { GAME_CONFIG } from '../data/gameConfig';
import { laserBand, laserTint, laserEmission } from '../systems/LaserProjection';
import type { InstallationDefinition } from '../data/installationRules';
import type { InstallationPoint } from '../electrical/InstallationPoint';
import { MasonryVolume, type MasonryFragment, type MasonryVolumeOptions } from './MasonryVolume';
import { brickFacePatch } from './BrickFacePatch';

export type SprayMode = 'dots' | 'live';
export type MasonryImpactKind = 'chase-chip' | 'demolish-chip' | 'demolish-crack' | 'demolish-spall' | 'demolish-split' | 'demolish-break';
export interface ChiselContact { point: THREE.Vector3; direction: THREE.Vector3; edge: THREE.Vector3; energyJ: number; chisel: 'flat' | 'pointed'; widthM?: number; bladeOffsetM?: number }
export interface MasonryImpact {
  releaseDirection?: { x: number; y: number; z: number }; releaseEnergyJ?: number;
  points: THREE.Vector3[]; kind: MasonryImpactKind; brickSize: THREE.Vector3; seed: number; destroyed: boolean;
  fragments: MasonryFragment[]; removedVolume: number;
}
// Poly Haven "Red Brick" by Rob Tuytel, CC0: https://polyhaven.com/a/red_brick
// Each exposed physical clay unit samples one mortar-free photographed face.
const brickImageReady = uniform(0);
const brickImage = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}assets/masonry/red-brick-polyhaven-1k.jpg`, () => { brickImageReady.value = 1; });
brickImage.colorSpace = THREE.SRGBColorSpace;
brickImage.anisotropy = 8;
brickImage.wrapS = brickImage.wrapT = THREE.RepeatWrapping;
const wallMaterial = new MeshStandardNodeMaterial({ roughness: 1, metalness: 0, flatShading: true });
wallMaterial.name = 'Reference clay face with independent fractured masonry';
const masonryColor = attribute<'vec3'>('color', 'vec3');
const grain = fract(sin(dot(floor(positionWorld.xy.mul(1800)), vec2(127.1,311.7))).mul(43758.5453));
const mottling = sin(positionWorld.x.mul(93).add(sin(positionWorld.y.mul(71)))).mul(sin(positionWorld.y.mul(127)));
const grooves = smoothstep(.82,.99,sin(positionWorld.y.mul(3200)));
const rawMasonry = masonryColor.mul(grain.mul(.15).add(.90).add(mottling.mul(.045)).sub(grooves.mul(.035)));
const photographedClay = sampleTexture(brickImage, uv()).rgb.mul(masonryColor.r.div(.49));
// A face mask keeps real mortar joints, internal chambers and broken edges on
// their own rough clay/mortar colors in both WebGPU and the WebGL backend.
wallMaterial.colorNode = mix(mix(rawMasonry, photographedClay, attribute<'float'>('brickFace', 'float').mul(brickImageReady)),laserTint,laserBand);
wallMaterial.emissiveNode=laserEmission;
type MeshData = ReturnType<MasonryVolume['buildChunkMesh']>;

/** The wall owns one continuous material volume. Brick IDs never select damage. */
export class BrickWall extends THREE.Group {
  readonly volume: MasonryVolume;
  readonly performanceBudget = {workerMeshing:true, maxInFlightMeshes:2, supportNodesPerFrame:2048};
  private meshWorker: Worker | null = null;
  private readonly pendingMeshes = new Map<string,number>();
  private readonly meshVersions = new Map<string,number>();
  private readonly meshStarted = new Map<string,number>();
  private readonly inFlightMeshes = new Set<string>();
  private meshRevision = 0;
  private lastWorkerMs = 0;
  private peakGeometryLatencyMs = 0;
  private workerError = '';
  chiselType: 'flat' | 'pointed' = 'flat';
  chiselEnergyJ = 4;
  private widthM = .05;
  get chiselWidthM(): number { return this.widthM; }
  set chiselWidthM(value: number) { if(Number.isFinite(value)) this.widthM = THREE.MathUtils.clamp(value, .01, .05); }
  chiselEdgeAngle = 0;
  chiselTiltDegrees = 15;
  chiselSideDegrees = -15;
  contactProvider: ((camera: THREE.Camera) => ChiselContact | null) | null = null;
  private readonly chunks = new Map<string, THREE.Mesh>();
  private readonly pristineRanges = new Map<string, {start: number; count: number}>();
  private readonly pristine: THREE.Mesh;
  private readonly raycaster = new THREE.Raycaster();
  private readonly canvas = document.createElement('canvas');
  private readonly paint: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly samples = new Map<string, THREE.Vector3[]>();
  private readonly installations = new Map<string, InstallationPoint>();
  private lastPaintPoint: THREE.Vector3 | null = null;
  private paintCount = 0;
  private impactCount = 0;
  private removedVolume = 0;
  private removedNodes = 0;
  private maxDepth = 0;
  private lastCalculationMs = 0;
  private lastMeshMs = 0;
  private peakCalculationMs = 0;
  private peakMeshMs = 0;
  private lastResult: ReturnType<MasonryVolume['impact']> | null = null;
  private lastCoverage = new Map<string, {revision:number; value:number}>();

  constructor(_definitions: InstallationDefinition[], options: MasonryVolumeOptions = {}) {
    super();
    this.volume = new MasonryVolume(options);
    this.name = 'Brittle hollow clay masonry — shells, cells, ribs and mortar';
    this.userData.studioEntityId = 'world:brick-wall';
    // All untouched chunks share ONE draw call. Their indices are retired locally
    // when a chunk becomes volumetric; no hit rebuilds this facade or the building.
    const positions: number[] = [], normals: number[] = [], colors: number[] = [], indices: number[] = [];
    for (const key of this.volume.chunkKeys) {
      const data = this.volume.buildPristineChunkMesh(key);
      const vertexOffset = positions.length / 3;
      const start = indices.length;
      for (let i = 0; i < data.positions.length; i++) { positions.push(data.positions[i]); normals.push(data.normals[i]); colors.push(data.colors[i]); }
      for (let i = 0; i < data.positions.length / 3; i++) indices.push(vertexOffset + i);
      this.pristineRanges.set(key, {start, count: indices.length - start});
    }
    const base = new THREE.BufferGeometry();
    base.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    base.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    base.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.addBrickSurfaceAttributes(base);
    base.setIndex(indices);
    base.index!.setUsage(THREE.DynamicDrawUsage);
    base.computeBoundingSphere();
    this.pristine = new THREE.Mesh(base, wallMaterial);
    this.pristine.name = 'Batched untouched masonry';
    this.pristine.userData.studioEntityId = 'world:brick-wall:permanent-field';
    this.pristine.castShadow = this.pristine.receiveShadow = true;
    this.add(this.pristine);
    this.canvas.width = 2048; this.canvas.height = 1024;
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('Paint canvas unavailable');
    this.paint = context;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    const paintSurface = new THREE.Mesh(new THREE.PlaneGeometry(6, 3), new THREE.MeshBasicMaterial({map: this.texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2}));
    paintSurface.position.set(0, 1.5, GAME_CONFIG.room.wallFrontZ + .003);
    paintSurface.name = 'Player spray marks'; paintSurface.raycast = () => undefined;
    this.add(paintSurface);
    if (this.performanceBudget.workerMeshing && typeof Worker !== 'undefined') {
      this.meshWorker = new Worker(new URL('./masonry.worker.ts', import.meta.url), {type:'module'});
      this.meshWorker.onmessage = event => {
        const {key,revision,data,milliseconds}=event.data as {key:string;revision:number;data:MeshData;milliseconds:number};
        this.inFlightMeshes.delete(key);
        if(this.meshVersions.get(key)===revision) {
          this.applyChunkMesh(key,data);
          this.lastWorkerMs=milliseconds;
          this.peakGeometryLatencyMs=Math.max(this.peakGeometryLatencyMs,performance.now()-(this.meshStarted.get(key)??performance.now()));
        }
        this.dispatchMeshes();
      };
      this.meshWorker.onerror = event => {
        this.workerError=event.message;this.meshWorker?.terminate();this.meshWorker=null;
        for(const key of new Set([...this.pendingMeshes.keys(),...this.inFlightMeshes])) this.applyChunkMesh(key,this.volume.buildChunkMesh(key));
        this.pendingMeshes.clear();this.inFlightMeshes.clear();
      };
    }
  }

  registerInstallations(points: InstallationPoint[]): void { for (const point of points) this.installations.set(point.definition.id, point); }
  /** Prepare the main work wall for the PVC phase. Each 200 mm chase is a real
   * cleared volume, wide enough for several parallel 20 mm conduits. */
  prepareMultiPipeChases(points: readonly InstallationPoint[], width=.20): {widthM:number;removedNodes:number} {
    let removedNodes=0;
    for(const point of points){
      const centre=point.position;
      const chaseHalfWidth=width/2+.008;
      const cavityHalfWidth=point.boxGroup.groupWidth/2+.024;
      const boxHalfHeight=point.boxGroup.groupHeight/2+.022;
      removedNodes+=this.volume.carveBox(
        {x:centre.x-chaseHalfWidth,y:-.01,z:this.volume.frontZ-.058},
        {x:centre.x+chaseHalfWidth,y:centre.y-boxHalfHeight,z:this.volume.frontZ+.002},
      );
      removedNodes+=this.volume.carveBox(
        {x:centre.x-cavityHalfWidth,y:centre.y-boxHalfHeight,z:this.volume.frontZ-.058},
        {x:centre.x+cavityHalfWidth,y:centre.y+boxHalfHeight,z:this.volume.frontZ+.002},
      );
      const samples:THREE.Vector3[]=[];
      for(let y=.012;y<=centre.y-boxHalfHeight-.008;y+=.04)
        for(const offset of [-width*.375,0,width*.375])samples.push(new THREE.Vector3(centre.x+offset,y,this.volume.frontZ-.02));
      this.samples.set(point.definition.id,samples);
    }
    this.removedNodes=this.volume.removedNodeCount;
    this.removedVolume=this.volume.removedVolume;
    this.maxDepth=Math.max(this.maxDepth,.058);
    this.flushGeometry();
    return{widthM:width,removedNodes};
  }
  aim(camera: THREE.Camera, maxDistance:number = GAME_CONFIG.interaction.maxDistance): { point: THREE.Vector3 } | null {
    // This ray needs only the camera transform, not every finger/tool child.
    camera.updateWorldMatrix(true, false);
    this.raycaster.setFromCamera(new THREE.Vector2(), camera);
    const hit = this.volume.raycast(this.raycaster.ray.origin, this.raycaster.ray.direction, maxDistance);
    if (!hit) return null;
    // Concrete columns stand in front of this masonry. Never drill through them
    // by hitting the brick volume hidden behind the structural member.
    if (Math.abs(hit.point.x) > 2.54 && Math.abs(hit.point.x) < 2.9) return null;
    return {point: new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z)};
  }
  isSolidAt(x: number, y: number, z: number): boolean { return this.volume.isOccupied(x, y, z); }
  removeAtAim(camera: THREE.Camera, _continuing = false): MasonryImpact | null { return this.strike(camera); }
  processPendingSupport(): MasonryImpact | null {
    if(!this.volume.pendingSupportCount) return null;
    const result=this.volume.processPendingSupport(this.performanceBudget.supportNodesPerFrame);
    if(!result?.removedNodes) return null;
    this.removedNodes=this.volume.removedNodeCount;this.removedVolume=this.volume.removedVolume;
    this.lastCoverage.clear();this.lastResult=result;
    this.flushGeometry();
    return {points:result.fragments.map(f=>new THREE.Vector3(f.position.x,f.position.y,f.position.z)),kind:'demolish-split',brickSize:new THREE.Vector3(.05,.05,.02),seed:result.seed,destroyed:false,fragments:result.fragments,removedVolume:result.removedVolume};
  }
  recessChaseAtAim(camera: THREE.Camera, _pointId: string): MasonryImpact | null {
    // CHASE uses the same physical contact; spray guides the player, never a cutter.
    return this.strike(camera);
  }
  private strike(camera: THREE.Camera): MasonryImpact | null {
    let contact = this.contactProvider?.(camera) ?? null;
    if (!this.contactProvider) {
      const hit = this.aim(camera);
      if (hit) contact = {point: hit.point, direction: camera.getWorldDirection(new THREE.Vector3()), edge: new THREE.Vector3(Math.cos(this.chiselEdgeAngle), Math.sin(this.chiselEdgeAngle), 0), energyJ: this.chiselEnergyJ, chisel: this.chiselType};
    }
    if (!contact) return null;
    return this.strikeContact(contact);
  }
  /** Independent workers submit physical contact without replacing the player's provider. */
  strikeContact(contact: ChiselContact): MasonryImpact | null {
    const start = performance.now();
    const result = this.volume.impact({ ...contact, widthM: contact.widthM ?? this.chiselWidthM, trim: this.chiselTiltDegrees < 0 });
    if (!result.contact) return null;
    this.lastResult = result;
    this.impactCount++;
    this.removedNodes += result.removedNodes;
    this.removedVolume += result.removedVolume;
    if (result.removedNodes) this.maxDepth = Math.min(this.volume.depth, Math.max(this.maxDepth, this.volume.frontZ - contact.point.z + .008));
    this.lastCalculationMs = performance.now() - start;
    this.peakCalculationMs = Math.max(this.peakCalculationMs, this.lastCalculationMs);
    const meshStart = performance.now();
    this.flushGeometry();
    this.clearPaint(contact.point, .045);
    this.lastMeshMs = performance.now() - meshStart;
    this.peakMeshMs = Math.max(this.peakMeshMs, this.lastMeshMs);
    const detached = result.fragments.some(fragment => fragment.detached);
    return {points: [contact.point.clone()], kind: detached ? 'demolish-split' : result.removedNodes > 30 ? 'demolish-spall' : result.removedNodes ? 'demolish-chip' : 'demolish-crack', brickSize: new THREE.Vector3(.055, .035, .016), seed: result.seed, destroyed: false, fragments: result.fragments, removedVolume: result.removedVolume, releaseDirection: result.releaseDirection, releaseEnergyJ: result.releaseEnergyJ};
  }
  flushGeometry(): void {
    for(const key of this.volume.takeDirtyChunks()) {
      if(!this.meshWorker || !this.performanceBudget.workerMeshing) {this.applyChunkMesh(key,this.volume.buildChunkMesh(key));continue;}
      const revision=++this.meshRevision;
      this.meshVersions.set(key,revision);this.pendingMeshes.set(key,revision);this.meshStarted.set(key,performance.now());
    }
    this.dispatchMeshes();
  }
  private dispatchMeshes(): void {
    if(!this.meshWorker) return;
    for(const [key,revision] of this.pendingMeshes) {
      if(this.inFlightMeshes.size>=this.performanceBudget.maxInFlightMeshes) break;
      if(this.inFlightMeshes.has(key)) continue;
      const job=this.volume.exportMeshJob(key);
      this.pendingMeshes.delete(key);this.inFlightMeshes.add(key);
      this.meshWorker.postMessage({key,revision,job},[job.xCoordinates.buffer,job.yCoordinates.buffer,job.zCoordinates.buffer,job.materials.buffer,job.exposed.buffer,job.nodeColors.buffer]);
    }
  }
  async waitForGeometry(): Promise<void> {
    while(this.pendingMeshes.size || this.inFlightMeshes.size) await new Promise(resolve=>setTimeout(resolve,8));
  }
  private applyChunkMesh(key:string,data:MeshData): void {
    this.volume.cacheSurfaceMesh(key,data.positions);
    const geometry=this.geometry(data), previous=this.chunks.get(key);
    if(previous) {previous.geometry.dispose();previous.geometry=geometry;return;}
    const chunk=new THREE.Mesh(geometry,wallMaterial);
    chunk.name=`Fractured masonry patch ${key}`;chunk.userData.studioEntityId=`world:brick-wall:patch:${key}`;
    chunk.castShadow=chunk.receiveShadow=true;this.chunks.set(key,chunk);this.add(chunk);
    const range=this.pristineRanges.get(key);
    if(range) {
      const index=this.pristine.geometry.index!;
      for(let i=range.start;i<range.start+range.count;i++) index.setX(i,0);
      index.addUpdateRange(range.start,range.count);index.needsUpdate=true;
    }
  }
  private geometry(data: MeshData): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
    this.addBrickSurfaceAttributes(geometry);
    geometry.computeBoundingSphere();
    return geometry;
  }

  private addBrickSurfaceAttributes(geometry: THREE.BufferGeometry): void {
    const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal'), colors = geometry.getAttribute('color');
    const coordinates = new Float32Array(positions.count * 2), faces = new Float32Array(positions.count);
    const pitchX = this.volume.width / 21, course = this.volume.height / 23;
    for (let i = 0; i < positions.count; i += 3) {
      const originalPlane = [0, 1, 2].every(j => {
        const z = positions.getZ(i + j);
        return Math.abs(z - this.volume.frontZ) < 1e-5 || Math.abs(z - (this.volume.frontZ - this.volume.depth)) < 1e-5;
      });
      const clay = colors.getX(i) > colors.getY(i) * 2;
      const face = Number(clay && originalPlane && Math.abs(normals.getZ(i)) > .999);
      const centreX = (positions.getX(i) + positions.getX(i + 1) + positions.getX(i + 2)) / 3;
      const centreY = (positions.getY(i) + positions.getY(i + 1) + positions.getY(i + 2)) / 3;
      const row = Math.floor(centreY / course);
      const stagger = (row % 2) * pitchX / 2;
      const column = Math.floor((centreX + this.volume.width / 2 - stagger) / pitchX);
      const left = -this.volume.width / 2 + column * pitchX + stagger;
      const patch = brickFacePatch(row, column);
      for (let j = 0; j < 3; j++) {
        coordinates[(i + j) * 2] = patch[0] + patch[2] * (positions.getX(i + j) - left) / pitchX;
        coordinates[(i + j) * 2 + 1] = patch[1] + patch[3] * (positions.getY(i + j) - row * course) / course;
        faces[i + j] = face;
      }
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(coordinates, 2));
    geometry.setAttribute('brickFace', new THREE.BufferAttribute(faces, 1));
  }

  canFitBoxes(point: InstallationPoint): boolean {
    const p = point.position;
    // Clearance also covers the small initial placement error and final leveling.
    return this.volume.cavityBox({x:p.x-point.boxGroup.groupWidth/2-.008, y:p.y-.047, z:p.z-.049}, {x:p.x+point.boxGroup.groupWidth/2+.008, y:p.y+.047, z:p.z+.001}).clear;
  }
  canFitConduit(point: InstallationPoint): boolean {
    const startY = point.position.y - point.boxGroup.groupHeight / 2;
    for (let y=.08; y<startY; y+=.012) {
      if (!this.volume.cavityBox({x:point.position.x-.012,y:y-.006,z:-2.446}, {x:point.position.x+.012,y:y+.006,z:-2.42}).clear) return false;
    }
    return true;
  }
  getChaseCoverage(pointId: string): number {
    const cached = this.lastCoverage.get(pointId);
    if (cached?.revision === this.impactCount) return cached.value;
    const points = this.samples.get(pointId) ?? [];
    let cleared = 0;
    for (const p of points) if (this.volume.cavityBox({x:p.x-.009,y:p.y-.009,z:-2.45}, {x:p.x+.009,y:p.y+.009,z:-2.411}).clear) cleared++;
    const result = points.length ? cleared / points.length : 0;
    this.lastCoverage.set(pointId, {revision:this.impactCount,value:result});
    return result;
  }
  spray(camera: THREE.Camera, pointId: string, mode: SprayMode = 'live', color = 0x087fce): THREE.Vector3 | null {
    const hit = this.aim(camera); if (!hit) return null;
    const p = hit.point;
    const samples = this.samples.get(pointId) ?? [];
    if (!samples.length || samples[samples.length-1].distanceToSquared(p) > .0009) samples.push(p.clone());
    if (samples.length > 1800) samples.shift(); this.samples.set(pointId, samples); this.lastCoverage.delete(pointId);
    const pixel = (v: THREE.Vector3) => ({x:(v.x/6+.5)*2048,y:(1-v.y/3)*1024});
    const a = pixel(mode === 'live' ? this.lastPaintPoint ?? p : p), b = pixel(p);
    this.paint.strokeStyle = `#${color.toString(16).padStart(6,'0')}`;
    this.paint.lineCap = 'round'; this.paint.lineJoin = 'round'; this.paint.globalAlpha = .8; this.paint.lineWidth = mode === 'live' ? 8 : 12;
    this.paint.beginPath(); this.paint.moveTo(a.x,a.y); this.paint.lineTo(b.x+.05,b.y); this.paint.stroke(); this.paint.globalAlpha=1;
    this.texture.needsUpdate=true; this.lastPaintPoint=mode==='live'?p.clone():null; this.paintCount++;
    return p;
  }
  endSprayStroke(): void { this.lastPaintPoint = null; }
  showMarks(_pointId: string): void { /* Player-authored paint is already visible. */ }
  private clearPaint(point: THREE.Vector3, radius: number): void {
    // A blank mark canvas has nothing to erase. Avoid uploading its 8 MB
    // texture on every chisel blow until the player has actually painted it.
    if (!this.paintCount) return;
    this.paint.save(); this.paint.globalCompositeOperation='destination-out'; this.paint.beginPath();
    this.paint.arc((point.x/6+.5)*2048,(1-point.y/3)*1024,radius/6*2048,0,Math.PI*2);this.paint.fill();this.paint.restore();this.texture.needsUpdate=true;
  }
  get freeMarkCount(): number { return this.paintCount; }
  get telemetry() {
    let triangles = 0, geometryBytes = 0;
    for (const mesh of this.chunks.values()) { triangles += mesh.geometry.getAttribute('position').count / 3; geometryBytes += mesh.geometry.getAttribute('position').array.byteLength * 3; }
    return {model:'sparse-3d-brittle-masonry', trimming:this.volume.trimmingState, pendingSupportJobs:this.volume.pendingSupportCount, volumeBytes:this.volume.memoryBytes, pendingMeshes:this.pendingMeshes.size+this.inFlightMeshes.size,workerMeshing:Boolean(this.meshWorker),lastWorkerMs:this.lastWorkerMs,peakGeometryLatencyMs:this.peakGeometryLatencyMs,workerError:this.workerError, impactCount:this.impactCount, removedNodes:this.removedNodes, removedVolumeCm3:this.removedVolume*1e6, maximumDepthMm:this.maxDepth*1000, damagedChunks:this.chunks.size, surfaceTriangles:triangles, geometryBytes, deformedWallCells:0, lastCalculationMs:this.lastCalculationMs, peakCalculationMs:this.peakCalculationMs, lastMeshMs:this.lastMeshMs, peakMeshMs:this.peakMeshMs, lastImpact:this.lastResult ? {removedNodes:this.lastResult.removedNodes,removedByMaterial:this.lastResult.removedByMaterial,stats:this.lastResult.stats} : null, fractureSegments:0, fractureRendering:'removed-material-surfaces', openedFissureNodes:this.lastResult?.stats.openedFissureNodes??0};
  }
  saveDamage() { return {volume:this.volume.serialize(),cracks:[] as Array<{points:Array<{x:number;y:number;z:number}>;width:number}>,impactCount:this.impactCount,removedVolume:this.removedVolume,maxDepth:this.maxDepth}; }
  restoreDamage(saved: ReturnType<BrickWall['saveDamage']>): void {
    this.volume.restore(saved.volume);
    this.impactCount=saved.impactCount;this.removedNodes=this.volume.removedNodeCount;this.removedVolume=this.volume.removedVolume;this.maxDepth=saved.maxDepth;
    this.lastCoverage.clear();this.lastResult=null;
    this.flushGeometry();
  }
}
