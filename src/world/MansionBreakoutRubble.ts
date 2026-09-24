import * as THREE from 'three';
import { siteClayImage } from './BrickRibbing';
import { siteMaterial } from './SiteMaterials';

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
const dust = siteMaterial('plaster', 0xffffff, 3, 3);
dust.vertexColors = true;
dust.normalMap = null;
dust.flatShading = true;
dust.side = THREE.DoubleSide;
const gritGeometry = new THREE.TetrahedronGeometry(1, 0);
const clayGritMaterial = new THREE.MeshStandardMaterial({ color: 0xb3684a, roughness: 1, flatShading: true });
const renderGritMaterial = new THREE.MeshStandardMaterial({ color: 0xaaa196, roughness: 1, flatShading: true });

/** Bounded, batched debris that follows saved/removed masonry without spawning
 * a simulated mesh for every small chip on mobile. */
export class MansionBreakoutRubble {
  readonly group = new THREE.Group();
  private readonly clayShards = new THREE.InstancedMesh(shard, clay, 600);
  private readonly renderShards = new THREE.InstancedMesh(shard, render, 150);
  private readonly sections = new THREE.InstancedMesh(hollowSection, clay, 32);
  private readonly clayGrit = new THREE.InstancedMesh(gritGeometry, clayGritMaterial, 840);
  private readonly renderGrit = new THREE.InstancedMesh(gritGeometry, renderGritMaterial, 480);
  private readonly mound = new THREE.Mesh(new THREE.BufferGeometry(), dust);
  private moundBounds = '';
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly tint = new THREE.Color();

  constructor(private readonly alongX: boolean) {
    this.group.name = 'Fallen clay and plaster from opened masonry';
    this.mound.name = 'Mixed clay and plaster grit beneath broken blocks';
    this.mound.receiveShadow = true;
    this.mound.raycast = () => undefined;
    this.group.add(this.mound);
    for (const mesh of [this.clayShards, this.renderShards, this.sections, this.clayGrit, this.renderGrit]) {
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = mesh === this.sections;
      mesh.receiveShadow = true;
      mesh.raycast = () => undefined;
      this.group.add(mesh);
    }
  }

  update(centers: readonly number[], impactSide: -1 | 1): void {
    if (!centers.length) {
      this.group.visible = false;
      this.clayShards.count = this.renderShards.count = this.sections.count =
        this.clayGrit.count = this.renderGrit.count = 0;
      return;
    }
    this.group.visible = true;
    const minimum = Math.min(...centers), maximum = Math.max(...centers);
    const center = (minimum + maximum) * .5;
    const spread = Math.max(.2, Math.min(1.25, (maximum - minimum) * .5 + .23));
    const peak = Math.min(.45, centers.length * .007);
    const rampHeight = (along: number, outward: number): number => {
      const edge = THREE.MathUtils.clamp((spread - Math.abs(along - center)) / .24, 0, 1);
      const distance = THREE.MathUtils.clamp((Math.abs(outward) - .115) / 1.08, 0, 1);
      return peak * edge * (1 - distance) ** 1.28;
    };
    const bounds = `${minimum}:${maximum}:${Math.floor(centers.length / 5)}:${impactSide}`;
    if (bounds !== this.moundBounds) {
      this.moundBounds = bounds;
      const positions: number[] = [], colors: number[] = [], uvs: number[] = [], indices: number[] = [];
      const columns = 24, depthSteps = 8, rowWidth = columns + 1;
      for (let depth = 0; depth <= depthSteps; depth++) for (let column = 0; column <= columns; column++) {
        const t = depth / depthSteps;
        const index = depth * rowWidth + column;
        const along = center + (column / columns * 2 - 1) * spread;
        const edgeWobble = depth > 0 && depth < depthSteps ? (scatter(index, 22) - .5) * .035 : 0;
        const out = impactSide * (.115 + t * 1.08 + edgeWobble);
        const height = .003 + rampHeight(along, out) * (.91 + scatter(index, 31) * .09);
        positions.push(this.alongX ? along : out, height, this.alongX ? out : along);
        uvs.push(column / columns, t);
        const mix = scatter(index, 49);
        colors.push(.80 + mix * .12, .73 + mix * .11, .67 + mix * .10);
        if (depth === depthSteps || column === columns) continue;
        const next = index + rowWidth;
        indices.push(index, next, index + 1, index + 1, next, next + 1);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      this.mound.geometry.dispose();
      this.mound.geometry = geometry;
    }
    const place = (mesh: THREE.InstancedMesh, count: number, kind: 'clay' | 'render' | 'section') => {
      const previous = mesh.count;
      mesh.count = count;
      if (previous >= count) return;
      const density = kind === 'clay' ? 9.3 : kind === 'render' ? 2.3 : .5;
      for (let i = previous; i < count; i++) {
        const seed = i + (kind === 'render' ? 173 : kind === 'section' ? 817 : 0);
        const source = centers[Math.min(centers.length - 1, Math.floor(i / density))];
        const along = source + (scatter(seed, 1) - scatter(seed, 2)) * .25;
        const side = impactSide;
        const out = side * (.12 + scatter(seed, 4) ** 1.35 * .96);
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
    place(this.clayShards, Math.min(600, Math.ceil(centers.length * 9.3)), 'clay');
    place(this.renderShards, Math.min(150, Math.ceil(centers.length * 2.3)), 'render');
    place(this.sections, Math.min(32, Math.floor(centers.length * .5)), 'section');
    const placeGrit = (mesh: THREE.InstancedMesh, count: number, density: number, salt: number) => {
      const previous = mesh.count;
      mesh.count = count;
      if (previous >= count) return;
      for (let i = previous; i < count; i++) {
        const seed = i + salt;
        const source = centers[Math.min(centers.length - 1, Math.floor(i / density))];
        const along = source + (scatter(seed, 1) - scatter(seed, 2)) * .72;
        const out = impactSide * (.12 + scatter(seed, 3) * 1.18);
        const grain = scatter(seed, 4);
        const size = grain < .32 ? .002 + grain * .018 : .005 + (grain - .32) * .038;
        this.position.set(this.alongX ? along : out,
          .002 + rampHeight(along, out) + size * .35,
          this.alongX ? out : along);
        this.rotation.setFromEuler(new THREE.Euler(scatter(seed, 6) * Math.PI,
          scatter(seed, 7) * Math.PI * 2, scatter(seed, 8) * Math.PI));
        this.scale.set(size * (.75 + scatter(seed, 9) * .7),
          size * (.38 + scatter(seed, 10) * .65), size * (.55 + scatter(seed, 11) * .8));
        mesh.setMatrixAt(i, this.matrix.compose(this.position, this.rotation, this.scale));
        const shade = .75 + scatter(seed, 12) * .42;
        mesh.setColorAt(i, this.tint.setRGB(shade, shade * (.90 + scatter(seed, 13) * .12),
          shade * (.86 + scatter(seed, 14) * .16)));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    };
    placeGrit(this.clayGrit, Math.min(840, Math.ceil(centers.length * 13)), 13, 1301);
    placeGrit(this.renderGrit, Math.min(480, Math.ceil(centers.length * 7.5)), 7.5, 2909);
  }
}
