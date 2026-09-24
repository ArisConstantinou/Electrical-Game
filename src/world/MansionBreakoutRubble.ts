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
const dust = new THREE.MeshStandardMaterial({ color: 0xb1a196, vertexColors: true, roughness: 1, flatShading: true, side: THREE.DoubleSide });

/** Bounded, batched debris that follows saved/removed masonry without spawning
 * a simulated mesh for every small chip on mobile. */
export class MansionBreakoutRubble {
  readonly group = new THREE.Group();
  private readonly clayShards = new THREE.InstancedMesh(shard, clay, 360);
  private readonly renderShards = new THREE.InstancedMesh(shard, render, 150);
  private readonly sections = new THREE.InstancedMesh(hollowSection, clay, 72);
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
    for (const mesh of [this.clayShards, this.renderShards, this.sections]) {
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
      this.clayShards.count = this.renderShards.count = this.sections.count = 0;
      return;
    }
    this.group.visible = true;
    const minimum = Math.min(...centers), maximum = Math.max(...centers);
    const center = (minimum + maximum) * .5;
    const spread = Math.max(.2, Math.min(1.25, (maximum - minimum) * .5 + .23));
    const peak = Math.min(.20, centers.length * .0032);
    const bounds = `${minimum}:${maximum}:${Math.floor(centers.length / 5)}:${impactSide}`;
    if (bounds !== this.moundBounds) {
      this.moundBounds = bounds;
      const positions: number[] = [], colors: number[] = [], indices: number[] = [];
      const sectors = 24, rings = 5;
      for (const side of [impactSide]) {
        const first = positions.length / 3;
        for (let ring = 0; ring <= rings; ring++) for (let sector = 0; sector < sectors; sector++) {
          const angle = sector / sectors * Math.PI * 2;
          const radius = ring / rings;
          const wobble = 1 + (scatter(sector + ring * sectors, side + 20) - .5) * .20;
          const along = center + Math.cos(angle) * spread * radius * wobble;
          const out = side * (.27 + Math.sin(angle) * .26 * radius * wobble);
          const height = .003 + peak * (1 - radius ** 1.7) * (.88 + scatter(sector, ring + side + 60) * .18);
          positions.push(this.alongX ? along : out, height, this.alongX ? out : along);
          const mix = scatter(sector, ring + side + 90);
          colors.push(.37 + mix * .09, .29 + mix * .06, .23 + mix * .055);
          if (ring === rings) continue;
          const next = first + (ring + 1) * sectors + sector;
          const nextAround = first + (ring + 1) * sectors + (sector + 1) % sectors;
          const current = first + ring * sectors + sector;
          const currentAround = first + ring * sectors + (sector + 1) % sectors;
          indices.push(current, next, nextAround, current, nextAround, currentAround);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      this.mound.geometry.dispose();
      this.mound.geometry = geometry;
    }
    const place = (mesh: THREE.InstancedMesh, count: number, kind: 'clay' | 'render' | 'section') => {
      const previous = mesh.count;
      mesh.count = count;
      if (previous >= count) return;
      const density = kind === 'clay' ? 5.5 : kind === 'render' ? 2.3 : 1.12;
      for (let i = previous; i < count; i++) {
        const seed = i + (kind === 'render' ? 173 : kind === 'section' ? 817 : 0);
        const source = centers[Math.min(centers.length - 1, Math.floor(i / density))];
        const along = source + (scatter(seed, 1) - scatter(seed, 2)) * .25;
        const side = impactSide;
        const out = side * (.10 + scatter(seed, 4) * .43);
        const mound = Math.max(0, 1 - Math.abs(along - center) / (spread + .1)) * Math.max(0, 1 - (Math.abs(out) - .15) / .5);
        const long = kind === 'section' ? .16 + scatter(seed, 5) * .20
          : kind === 'clay' ? .025 + scatter(seed, 5) ** 2 * .15 : .035 + scatter(seed, 5) * .18;
        const narrow = kind === 'section' ? .075 + scatter(seed, 6) * .075
          : kind === 'clay' ? .018 + scatter(seed, 6) * .065 : .020 + scatter(seed, 6) * .09;
        const height = kind === 'section' ? .085 + scatter(seed, 7) * .055
          : kind === 'clay' ? .018 + scatter(seed, 7) * .055 : .020 + scatter(seed, 7) * .055;
        const layer = i % 5;
        this.position.set(this.alongX ? along : out,
          mound * peak * (.74 + layer * .055) + height * (kind === 'section' ? .57 : .30) +
            (kind === 'render' && scatter(seed, 17) < .42 ? .045 : 0) +
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
    place(this.clayShards, Math.min(360, Math.ceil(centers.length * 5.5)), 'clay');
    place(this.renderShards, Math.min(150, Math.ceil(centers.length * 2.3)), 'render');
    place(this.sections, Math.min(72, Math.floor(centers.length * 1.12)), 'section');
  }
}
