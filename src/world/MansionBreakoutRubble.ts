import * as THREE from 'three';
import { siteClayImage } from './BrickRibbing';
import { siteMaterial } from './SiteMaterials';
import { MaterialId, type MasonryFragment } from './MasonryVolume';

const scatter = (index: number, salt: number): number => {
  let h = Math.imul(index + 1, 0x7feb352d) ^ Math.imul(salt + 7, 0x846ca68b);
  h = Math.imul(h ^ h >>> 16, 0x7feb352d);
  return ((h ^ h >>> 15) >>> 0) / 4294967296;
};

// A low polygon chipped plate: the same mesh is instanced for every clay and
// grey render fragment. All scale and color variation stays on the instances.
const shard = new THREE.BufferGeometry();
{
  const outline = [[-.5, -.32], [-.31, -.48], [.21, -.42], [.5, -.16], [.39, .34], [-.08, .46], [-.46, .24]];
  const vertices: number[] = [], uvs: number[] = [];
  for (const y of [.14, -.14]) for (const [x, z] of outline) {
    vertices.push(x, y, z); uvs.push(x + .5, z + .5);
  }
  const indices: number[] = [];
  for (let i = 1; i < outline.length - 1; i++) indices.push(0, i, i + 1, 7, 7 + i + 1, 7 + i);
  for (let i = 0; i < outline.length; i++) {
    const next = (i + 1) % outline.length;
    indices.push(i, 7 + i, next, next, 7 + i, 7 + next);
  }
  shard.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  shard.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  shard.setIndex(indices);
  shard.computeVertexNormals();
}

const section = new THREE.Shape();
section.moveTo(-.5, -.39);
section.lineTo(-.44, -.5); section.lineTo(.31, -.5); section.lineTo(.5, -.37);
section.lineTo(.46, .39); section.lineTo(.34, .5); section.lineTo(-.39, .46);
section.lineTo(-.5, .28); section.closePath();
for (const x of [-.23, .23]) for (const y of [-.23, .23]) {
  const hole = new THREE.Path();
  for (let i = 0; i < 12; i++) {
    const angle = -i * Math.PI / 6, cosine = Math.cos(angle), sine = Math.sin(angle);
    const notch = 1 + Math.sin(i * 8.3 + x * 17 + y * 13) * .055;
    const px = x + Math.sign(cosine) * Math.sqrt(Math.abs(cosine)) * .155 * notch;
    const py = y + Math.sign(sine) * Math.sqrt(Math.abs(sine)) * .155 * notch;
    if (!i) hole.moveTo(px, py); else hole.lineTo(px, py);
  }
  hole.closePath(); section.holes.push(hole);
}
const hollowSection = new THREE.ExtrudeGeometry(section, { depth: 1, steps: 1, bevelEnabled: false, curveSegments: 7 });
hollowSection.translate(0, 0, -.5);

const clay = new THREE.MeshStandardMaterial({ map: siteClayImage, color: 0xe8d7cc, roughness: 1, flatShading: true });
const render = siteMaterial('concrete', 0xd8d0c5);
render.flatShading = true;
const bedCanvas = document.createElement('canvas');
bedCanvas.width = bedCanvas.height = 512;
const bedContext = bedCanvas.getContext('2d');
if (!bedContext) throw new Error('Rubble material canvas unavailable');
bedContext.fillStyle = '#783e2e';
bedContext.fillRect(0, 0, 512, 512);
let bedSeed = 0x4b1d9a37;
const bedRandom = (): number => {
  bedSeed = (Math.imul(bedSeed, 1664525) + 1013904223) >>> 0;
  return bedSeed / 4294967296;
};
const bedColors = ['#985039', '#89442f', '#a55a3e', '#78392a', '#9d9084', '#77716a'];
for (let i = 0; i < 2800; i++) {
  const x = bedRandom() * 512, y = bedRandom() * 512;
  const size = i < 600 ? 4 + bedRandom() * 9 : 1 + bedRandom() * 4;
  const colorIndex = Math.floor(bedRandom() * (i % 5 ? 4 : bedColors.length));
  bedContext.fillStyle = bedColors[colorIndex];
  bedContext.beginPath();
  bedContext.moveTo(x - size * .6, y - size * .2);
  bedContext.lineTo(x - size * .1, y - size * .6);
  bedContext.lineTo(x + size * .6, y - size * .3);
  bedContext.lineTo(x + size * .4, y + size * .5);
  bedContext.lineTo(x - size * .4, y + size * .4);
  bedContext.closePath();
  bedContext.fill();
}
const bedTexture = new THREE.CanvasTexture(bedCanvas);
bedTexture.name = 'Crushed clay and plaster fragments';
bedTexture.colorSpace = THREE.SRGBColorSpace;
bedTexture.wrapS = bedTexture.wrapT = THREE.RepeatWrapping;
bedTexture.anisotropy = 4;
const rubbleBed = new THREE.MeshStandardMaterial({ map: bedTexture, roughness: 1, flatShading: true,
  side: THREE.DoubleSide });
// Fine debris needs a broken, many-sided outline. A tetrahedron keeps a
// triangular silhouette however much its instances are rotated or scaled.
const makeGritGeometry = (outline: number[][], upper: number[], lower: number[]): THREE.BufferGeometry => {
  const geometry = new THREE.BufferGeometry();
  const vertices: number[] = [], indices: number[] = [];
  for (const heights of [upper, lower]) for (let i = 0; i < outline.length; i++) {
    vertices.push(outline[i][0], heights[i], outline[i][1]);
  }
  for (let i = 1; i < outline.length - 1; i++) {
    indices.push(0, i + 1, i);
    indices.push(outline.length, outline.length + i, outline.length + i + 1);
  }
  for (let i = 0; i < outline.length; i++) {
    const next = (i + 1) % outline.length;
    indices.push(i, next, outline.length + i, next, outline.length + next, outline.length + i);
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
};
const gritFlake = makeGritGeometry(
  [[-.49, -.14], [-.36, -.43], [-.09, -.49], [.29, -.40], [.48, -.19],
    [.45, .12], [.20, .43], [-.13, .47], [-.43, .27]],
  [.29, .37, .25, .34, .22, .35, .27, .39, .24],
  [-.25, -.19, -.32, -.23, -.35, -.20, -.30, -.22, -.34],
);
const gritChunk = makeGritGeometry(
  [[-.46, -.23], [-.25, -.46], [.20, -.42], [.48, -.13], [.34, .36], [-.12, .47], [-.45, .17]],
  [.36, .43, .32, .40, .29, .44, .31],
  [-.35, -.28, -.40, -.30, -.42, -.32, -.39],
);
const clayGritMaterial = new THREE.MeshStandardMaterial({ color: 0x985039, roughness: 1, flatShading: true });
const renderGritMaterial = new THREE.MeshStandardMaterial({ color: 0xaaa196, roughness: 1, flatShading: true });
interface FallingPiece { mesh: THREE.InstancedMesh; slot: number; position: THREE.Vector3; velocity: THREE.Vector3;
  rotation: THREE.Quaternion; spin: THREE.Vector3; scale: THREE.Vector3; settled: boolean }
interface FallingSection { group: THREE.Group; velocity: THREE.Vector3; spin: THREE.Vector3; age: number;
  settled: boolean; dispose: () => void }

/** Bounded, batched debris that follows saved/removed masonry without spawning
 * a simulated mesh for every small chip on mobile. */
export class MansionBreakoutRubble {
  readonly group = new THREE.Group();
  private readonly clayShards = new THREE.InstancedMesh(shard, clay, 600);
  private readonly renderShards = new THREE.InstancedMesh(shard, render, 150);
  private readonly sections = new THREE.InstancedMesh(hollowSection, clay, 32);
  private readonly clayGrit = new THREE.InstancedMesh(gritFlake, clayGritMaterial, 260);
  private readonly clayChunks = new THREE.InstancedMesh(gritChunk, clayGritMaterial, 160);
  private readonly claySlivers = new THREE.InstancedMesh(shard, clayGritMaterial, 110);
  private readonly renderGrit = new THREE.InstancedMesh(gritFlake, renderGritMaterial, 100);
  private readonly renderChunks = new THREE.InstancedMesh(gritChunk, renderGritMaterial, 80);
  private readonly renderSlivers = new THREE.InstancedMesh(shard, renderGritMaterial, 60);
  private readonly mound = new THREE.Mesh(new THREE.BufferGeometry(), rubbleBed);
  private readonly fallingClay = new THREE.InstancedMesh(shard, clay, 64);
  private readonly fallingMortar = new THREE.InstancedMesh(shard, render, 24);
  private readonly falling: FallingPiece[] = [];
  private readonly fallingSections: FallingSection[] = [];
  private clayCursor = 0;
  private mortarCursor = 0;
  private moundBounds = '';
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly tint = new THREE.Color();
  private readonly spinEuler = new THREE.Euler();
  private readonly spinQuaternion = new THREE.Quaternion();

  constructor(private readonly alongX: boolean) {
    this.group.name = 'Fallen clay and plaster from opened masonry';
    this.mound.name = 'Irregular crushed-clay and plaster bed beneath broken blocks';
    this.mound.receiveShadow = true;
    this.mound.raycast = () => undefined;
    this.group.add(this.mound);
    for(const mesh of [this.fallingClay,this.fallingMortar]){
      mesh.count=0;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow=mesh.receiveShadow=true;mesh.frustumCulled=false;
      mesh.raycast=()=>undefined;this.group.add(mesh);
    }
    for (const mesh of [this.clayShards, this.renderShards, this.sections,
      this.clayGrit, this.clayChunks, this.claySlivers,
      this.renderGrit, this.renderChunks, this.renderSlivers]) {
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = mesh === this.sections;
      mesh.receiveShadow = true;
      mesh.raycast = () => undefined;
      this.group.add(mesh);
    }
  }

  get fallingCount():number {
    return this.falling.filter(piece=>!piece.settled).length + this.fallingSections.filter(piece=>!piece.settled).length;
  }

  /** Keep the actual fractured clay mesh for the visible fall, then retire it
   * into the persistent rubble bed. No intact brick is made to vanish in place. */
  adoptSection(group: THREE.Group, impactSide: -1 | 1, seed: number, dispose: () => void): void {
    while (this.fallingSections.length >= 6) this.retireSection(this.fallingSections.shift()!);
    this.group.add(group);
    const random = (salt: number) => scatter(seed, salt);
    const velocity = new THREE.Vector3((random(81) - .5) * .7, .1 + random(82) * .4,
      (random(83) - .5) * .7);
    if (this.alongX) velocity.z = impactSide * (.35 + random(84) * .45);
    else velocity.x = impactSide * (.35 + random(84) * .45);
    this.fallingSections.push({ group, velocity,
      spin: new THREE.Vector3((random(85) - .5) * 3, (random(86) - .5) * 2, (random(87) - .5) * 3),
      age: 0, settled: false, dispose });
    this.group.visible = true;
  }

  private retireSection(section: FallingSection): void {
    section.group.removeFromParent();
    section.dispose();
  }

  /** A few real released fragments fall in front of the impacted face. The
   * bounded instance pool stays small even after long demolition sessions. */
  emit(fragments:readonly MasonryFragment[],origin:THREE.Vector3,rotation:THREE.Quaternion,impactSide:-1|1,seed:number):void{
    const selected=[...fragments].filter(fragment=>fragment.volume>0)
      .sort((a,b)=>b.volume-a.volume).slice(0,8);
    for(let index=0;index<selected.length;index++){
      const fragment=selected[index],grey=fragment.material===MaterialId.Mortar||fragment.material===MaterialId.Render||fragment.material===MaterialId.Concrete;
      const mesh=grey?this.fallingMortar:this.fallingClay;
      const cursor=grey?this.mortarCursor++:this.clayCursor++;
      const slot=cursor%mesh.instanceMatrix.count;
      mesh.count=Math.max(mesh.count,slot+1);
      const prior=this.falling.findIndex(piece=>piece.mesh===mesh&&piece.slot===slot);
      if(prior>=0)this.falling.splice(prior,1);
      const random=(salt:number)=>scatter(seed+index*13,salt);
      const position=new THREE.Vector3(fragment.position.x,fragment.position.y,fragment.position.z)
        .applyQuaternion(rotation).add(origin);
      const velocity=new THREE.Vector3((random(1)-.5)*.7,.3+random(2)*.7,(random(3)-.5)*.7);
      if(this.alongX)velocity.z=impactSide*(.45+random(4)*.9);
      else velocity.x=impactSide*(.45+random(4)*.9);
      const piece:FallingPiece={mesh,slot,position,velocity,rotation:new THREE.Quaternion()
        .setFromEuler(new THREE.Euler(random(5)*2,random(6)*3,random(7)*2)),
        spin:new THREE.Vector3(random(8)*3,random(9)*4,random(10)*3),
        scale:new THREE.Vector3(Math.max(.012,Math.min(.18,fragment.size.x)),
          Math.max(.008,Math.min(.09,fragment.size.y)),Math.max(.008,Math.min(.14,fragment.size.z))),settled:false};
      this.falling.push(piece);
      mesh.setMatrixAt(slot,this.matrix.compose(piece.position,piece.rotation,piece.scale));
      mesh.instanceMatrix.needsUpdate=true;
    }
    if(selected.length)this.group.visible=true;
  }

  step(dt:number):void{
    const elapsed=Math.min(.05,Math.max(0,dt));
    for(const piece of this.falling){
      if(piece.settled)continue;
      piece.velocity.y-=9.8*elapsed;
      piece.position.addScaledVector(piece.velocity,elapsed);
      piece.rotation.multiply(this.spinQuaternion.setFromEuler(this.spinEuler.set(
        piece.spin.x*elapsed,piece.spin.y*elapsed,piece.spin.z*elapsed)));
      const floor=piece.scale.y*.25;
      if(piece.position.y<=floor){
        piece.position.y=floor;
        if(Math.abs(piece.velocity.y)<.45)piece.settled=true;
        else piece.velocity.y=Math.abs(piece.velocity.y)*.16;
        piece.velocity.x*=.55;piece.velocity.z*=.55;
      }
      piece.mesh.setMatrixAt(piece.slot,this.matrix.compose(piece.position,piece.rotation,piece.scale));
      piece.mesh.instanceMatrix.needsUpdate=true;
    }
    for (let i = this.fallingSections.length - 1; i >= 0; i--) {
      const section = this.fallingSections[i];
      section.age += elapsed;
      if (section.age > 3) { this.retireSection(section); this.fallingSections.splice(i, 1); continue; }
      if (section.settled) continue;
      section.velocity.y -= 9.8 * elapsed;
      section.group.position.addScaledVector(section.velocity, elapsed);
      section.group.quaternion.multiply(this.spinQuaternion.setFromEuler(this.spinEuler.set(
        section.spin.x * elapsed, section.spin.y * elapsed, section.spin.z * elapsed)));
      if (section.group.position.y <= .08) {
        section.group.position.y = .08;
        if (Math.abs(section.velocity.y) < .45) section.settled = true;
        else section.velocity.y = Math.abs(section.velocity.y) * .12;
        section.velocity.x *= .55; section.velocity.z *= .55;
      }
    }
  }

  clear():void{
    for (const section of this.fallingSections) this.retireSection(section);
    this.fallingSections.length = 0;
    this.falling.length=0;this.clayCursor=this.mortarCursor=0;
    this.fallingClay.count=this.fallingMortar.count=0;
    this.update([],-1,0);
  }

  update(centers: readonly number[], impactSide: -1 | 1, volumeUnits=centers.length/4): void {
    if (!centers.length) {
      this.group.visible = this.fallingClay.count>0||this.fallingMortar.count>0;
      for (const mesh of [this.clayShards, this.renderShards, this.sections,
        this.clayGrit, this.clayChunks, this.claySlivers,
        this.renderGrit, this.renderChunks, this.renderSlivers]) mesh.count = 0;
      return;
    }
    this.group.visible = true;
    const minimum = Math.min(...centers), maximum = Math.max(...centers);
    const center = (minimum + maximum) * .5;
    const spread = Math.max(.2, Math.min(1.25, (maximum - minimum) * .5 + .23));
    const peak = Math.min(.45, volumeUnits * .055);
    const rampHeight = (along: number, outward: number): number => {
      const edge = THREE.MathUtils.clamp((spread - Math.abs(along - center)) / .24, 0, 1);
      const distance = THREE.MathUtils.clamp((Math.abs(outward) - .115) / .65, 0, 1);
      return peak * edge * (1 - distance) ** 1.28;
    };
    const bounds = `${minimum}:${maximum}:${Math.floor(volumeUnits*20)}:${impactSide}`;
    const changed = bounds !== this.moundBounds;
    if (changed) {
      this.moundBounds = bounds;
      const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
      const columns = 36, depthSteps = 12, rowWidth = columns + 1;
      for (let depth = 0; depth <= depthSteps; depth++) for (let column = 0; column <= columns; column++) {
        const t = depth / depthSteps;
        const index = depth * rowWidth + column;
        const along = center + (column / columns * 2 - 1) * spread * (1 - t * .13)
          + (depth ? (scatter(index, 80) - .5) * .02 : 0);
        const edgeWobble = depth ? (scatter(index, 22) - .5) * (.015 + t * .025) : 0;
        const out = impactSide * (.115 + t * .65 + edgeWobble);
        const slope = rampHeight(along, out);
        const height = Math.max(.003, .003 + slope * (.92 + scatter(index, 31) * .08)
          + (scatter(index, 71) - .5) * .01 * (1 - t));
        positions.push(this.alongX ? along : out, height, this.alongX ? out : along);
        uvs.push(column / columns * 2, t);
        if (depth === depthSteps || column === columns) continue;
        const next = index + rowWidth;
        indices.push(index, next, index + 1, index + 1, next, next + 1);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      this.mound.geometry.dispose();
      this.mound.geometry = geometry;
    }
    const place = (mesh: THREE.InstancedMesh, count: number, kind: 'clay' | 'render' | 'section') => {
      const previous = changed ? 0 : mesh.count;
      mesh.count = count;
      if (previous >= count) return;
      const density = kind === 'clay' ? 9.3 : kind === 'render' ? 2.3 : .5;
      for (let i = previous; i < count; i++) {
        const seed = i + (kind === 'render' ? 173 : kind === 'section' ? 817 : 0);
        const source = centers[Math.min(centers.length - 1, Math.floor(i / density))];
        const along = source + (scatter(seed, 1) - scatter(seed, 2)) * .25;
        const side = impactSide;
        const out = side * (.12 + scatter(seed, 4) ** 1.35 * .78);
        const surface = rampHeight(along, out);
        const largeRender = kind === 'render' && scatter(seed, 18) < .20;
        const long = kind === 'section' ? .16 + scatter(seed, 5) * .20
          : kind === 'clay' ? .012 + scatter(seed, 5) ** 2 * .11
          : largeRender ? .10 + scatter(seed, 5) * .13 : .015 + scatter(seed, 5) * .075;
        const narrow = kind === 'section' ? .075 + scatter(seed, 6) * .075
          : kind === 'clay' ? .008 + scatter(seed, 6) * .055
          : largeRender ? .05 + scatter(seed, 6) * .065 : .012 + scatter(seed, 6) * .045;
        const height = kind === 'section' ? .085 + scatter(seed, 7) * .055
          : kind === 'clay' ? .008 + scatter(seed, 7) * .035
          : largeRender ? .03 + scatter(seed, 7) * .05 : .010 + scatter(seed, 7) * .035;
        const layer = i % 5;
        this.position.set(this.alongX ? along : out,
          surface + height * (kind === 'section' ? .55 : .28) + layer * .003 +
            (kind === 'render' && scatter(seed, 17) < .42 ? .016 : 0) +
            scatter(seed, 8) * .009,
          this.alongX ? out : along);
        const faceUp = kind === 'section' && scatter(seed, 15) < .68;
        const tilt = kind === 'section' ? .70 : .55;
        this.rotation.setFromEuler(new THREE.Euler(
          (faceUp ? -1.28 : 0) + (scatter(seed, 9) - .5) * tilt,
          scatter(seed, 10) * Math.PI * 2, (scatter(seed, 11) - .5) * tilt));
        this.scale.set(long, height, narrow);
        mesh.setMatrixAt(i, this.matrix.compose(this.position, this.rotation, this.scale));
        const shade = .85 + scatter(seed, 12) * .28;
        mesh.setColorAt(i, this.tint.setRGB(shade, shade * (.90 + scatter(seed, 13) * .08), shade * (.84 + scatter(seed, 14) * .12)));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    };
    place(this.clayShards, Math.min(600, Math.ceil(volumeUnits * 9.3)), 'clay');
    place(this.renderShards, Math.min(150, Math.ceil(volumeUnits * 2.3)), 'render');
    place(this.sections, Math.min(32, Math.floor(volumeUnits * .5)), 'section');
    const placeGrit = (mesh: THREE.InstancedMesh, count: number, density: number, salt: number,
      shape: 'flake' | 'chunk' | 'sliver') => {
      const previous = changed ? 0 : mesh.count;
      mesh.count = count;
      if (previous >= count) return;
      for (let i = previous; i < count; i++) {
        const seed = i + salt;
        const source = centers[Math.min(centers.length - 1, Math.floor(i / density))];
        const along = source + (scatter(seed, 1) - scatter(seed, 2)) * .30;
        const scatterOut = scatter(seed, 3);
        const stray = scatter(seed, 15) < .06;
        const out = impactSide * (.12 + (stray ? .68 + scatterOut * .28 : scatterOut ** 2.6 * .62));
        const grain = scatter(seed, 4);
        const size = grain < .32 ? .002 + grain * .018 : .005 + (grain - .32) * .038;
        this.position.set(this.alongX ? along : out,
          .002 + rampHeight(along, out) + size * (shape === 'chunk' ? .32 : .15),
          this.alongX ? out : along);
        this.rotation.setFromEuler(new THREE.Euler(scatter(seed, 6) * Math.PI,
          scatter(seed, 7) * Math.PI * 2, scatter(seed, 8) * Math.PI));
        this.scale.set(size * (shape === 'sliver' ? 1.5 + scatter(seed, 9) * 1.3 : .65 + scatter(seed, 9) * .75),
          size * (shape === 'chunk' ? .65 + scatter(seed, 10) * .65 : .12 + scatter(seed, 10) * .27),
          size * (shape === 'sliver' ? .22 + scatter(seed, 11) * .38 : .55 + scatter(seed, 11) * .8));
        mesh.setMatrixAt(i, this.matrix.compose(this.position, this.rotation, this.scale));
        const shade = .89 + scatter(seed, 12) * .19;
        mesh.setColorAt(i, this.tint.setRGB(shade, shade * (.96 + scatter(seed, 13) * .06),
          shade * (.94 + scatter(seed, 14) * .08)));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    };
    placeGrit(this.clayGrit, Math.min(260, Math.ceil(volumeUnits * 4)), 4, 1301, 'flake');
    placeGrit(this.clayChunks, Math.min(160, Math.ceil(volumeUnits * 2.5)), 2.5, 1703, 'chunk');
    placeGrit(this.claySlivers, Math.min(110, Math.ceil(volumeUnits * 1.6)), 1.6, 1987, 'sliver');
    placeGrit(this.renderGrit, Math.min(100, Math.ceil(volumeUnits * 1.4)), 1.4, 2909, 'flake');
    placeGrit(this.renderChunks, Math.min(80, Math.ceil(volumeUnits * 1.1)), 1.1, 3203, 'chunk');
    placeGrit(this.renderSlivers, Math.min(60, Math.ceil(volumeUnits * .8)), .8, 3509, 'sliver');
  }
}
