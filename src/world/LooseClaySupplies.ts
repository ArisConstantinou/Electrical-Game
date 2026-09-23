import * as THREE from 'three';
import { attribute, mix, normalMap, texture as sampleTexture, uv, vec2 } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { brickFacePatch, brickFaceTone } from './BrickFacePatch';
import { clayRibNormal } from './BrickRibbing';

/** One laid unit has four open extrusion chambers all the way through its
 * length. The three shared profiles keep chips occasional, not tiled. */
function looseBrickGeometry(variant: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const outline = variant === 1
    ? [[-.5,-.5],[.5,-.5],[.5,.5],[.39,.5],[.365,.465],[.34,.445],[.29,.5],[-.5,.5]]
    : variant === 2
      ? [[-.5,-.43],[-.46,-.45],[-.42,-.5],[.5,-.5],[.5,.5],[-.5,.5]]
      : [[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]];
  shape.moveTo(outline[0][0], outline[0][1]);
  for (const [x, y] of outline.slice(1)) shape.lineTo(x, y);
  shape.closePath();
  for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) {
    const cx = col ? .25 : -.25, cy = row ? .25 : -.25;
    const bore = new THREE.Path();
    for (let i = 0; i < 16; i++) {
      const angle = -i * Math.PI / 8;
      const rough = 1 + .028 * Math.sin(i * 8.3 + row * 4.7 + col * 6.1 + variant * 3.7);
      const x = cx + Math.cos(angle) * .15 * rough;
      const y = cy + Math.sin(angle) * .165 * rough;
      if (i === 0) bore.moveTo(x, y); else bore.lineTo(x, y);
    }
    bore.closePath(); shape.holes.push(bore);
  }
  let geometry: THREE.BufferGeometry = new THREE.ExtrudeGeometry(shape, { depth: 1, steps: 1, bevelEnabled: false, curveSegments: 4 });
  geometry.translate(0, 0, -.5);
  geometry.rotateY(Math.PI / 2);
  if (geometry.index) { const nonIndexed = geometry.toNonIndexed(); geometry.dispose(); geometry = nonIndexed; }
  const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
  const colors = new Float32Array(position.count * 3), faces = new Float32Array(position.count);
  const coordinates = new Float32Array(position.count * 2);
  const clay = new THREE.Color('#ad6445'), inside = new THREE.Color('#79432f');
  const dusty = new THREE.Color('#b77b58');
  for (let i = 0; i < position.count; i += 3) {
    const outerSide = [0, 1, 2].every(j => Math.abs(Math.abs(position.getZ(i + j)) - .5) < .012 && Math.abs(normal.getZ(i + j)) > .7);
    const top = [0, 1, 2].every(j => position.getY(i + j) > .492 && normal.getY(i + j) > .7);
    const end = [0, 1, 2].every(j => Math.abs(Math.abs(position.getX(i + j)) - .5) < .012 && Math.abs(normal.getX(i + j)) > .7);
    for (let j = 0; j < 3; j++) {
      const k = i + j, color = end ? dusty : outerSide || top ? clay : inside;
      colors.set([color.r, color.g, color.b], k * 3);
      faces[k] = outerSide || top ? 1 : 0;
      coordinates[k * 2] = position.getX(k) + .5;
      coordinates[k * 2 + 1] = top ? position.getZ(k) + .5 : position.getY(k) + .5;
    }
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('brickFace', new THREE.BufferAttribute(faces, 1));
  geometry.setAttribute('uv', new THREE.BufferAttribute(coordinates, 2));
  geometry.computeBoundingSphere();
  return geometry;
}

const faceAtlas = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}assets/masonry/human-laid-brick-face-atlas-v3.png`);
faceAtlas.colorSpace = THREE.SRGBColorSpace;
faceAtlas.wrapS = faceAtlas.wrapT = THREE.RepeatWrapping;
faceAtlas.anisotropy = 8;
const looseClayMaterial = new MeshStandardNodeMaterial({ roughness: 1 });
looseClayMaterial.name = 'Photographed loose hollow clay with raw four-bore ends';
const patch = attribute<'vec4'>('brickPatch', 'vec4');
looseClayMaterial.colorNode = mix(attribute('color', 'vec3'), sampleTexture(faceAtlas, uv().mul(patch.zw).add(patch.xy)).rgb,
  attribute('brickFace', 'float')).mul(attribute('brickTone', 'vec3'));
looseClayMaterial.normalNode = normalMap(sampleTexture(clayRibNormal, uv()), vec2(.45, .45));
const profiles = [looseBrickGeometry(0), looseBrickGeometry(1), looseBrickGeometry(2)];

interface Unit { x: number; y: number; z: number; across: boolean; variant: number; row: number; column: number }

function createStack(name: string, units: Unit[], size: [number, number, number]): THREE.Group {
  const group = new THREE.Group(); group.name = name;
  const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3(...size);
  for (let variant = 0; variant < profiles.length; variant++) {
    const batch = units.filter(unit => unit.variant === variant);
    if (!batch.length) continue;
    const geometry = profiles[variant].clone();
    const patches = new Float32Array(batch.length * 4);
    const tones = new Float32Array(batch.length * 3);
    geometry.setAttribute('brickPatch', new THREE.InstancedBufferAttribute(patches, 4));
    geometry.setAttribute('brickTone', new THREE.InstancedBufferAttribute(tones, 3));
    const mesh = new THREE.InstancedMesh(geometry, looseClayMaterial, batch.length);
    mesh.name = `Individual four-bore fired-clay units · wear ${variant}`;
    mesh.castShadow = mesh.receiveShadow = true;
    batch.forEach((unit, index) => {
      const lean = ((Math.imul(unit.column + 5, 73856093) ^ Math.imul(unit.row + 9, 19349663)) % 7) * .001;
      quaternion.setFromEuler(new THREE.Euler(0, unit.across ? Math.PI / 2 : 0, lean));
      mesh.setMatrixAt(index, matrix.compose(new THREE.Vector3(unit.x, unit.y, unit.z), quaternion, scale));
      const tone = brickFaceTone(unit.row, unit.column, 21);
      tones.set(tone, index * 3);
      patches.set(brickFacePatch(unit.row, unit.column, 21), index * 4);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
}

export function createGarageClayStack(): THREE.Group {
  const units: Unit[] = [];
  for (let row = 0; row < 3; row++) {
    const across = row === 1, columns = across ? 6 : 4, lanes = 2;
    for (let lane = 0; lane < lanes; lane++) for (let col = 0; col < columns; col++) {
      const index = lane * columns + col;
      units.push({ x: across ? 10.59 + col * .202 : 10.58 + col * .32,
        y: .20 + row * .125, z: across ? -2.085 + lane * .385 : -2.12 + lane * .37,
        across, variant: (row * 13 + index * 7) % 11 === 0 ? 2 : (row * 5 + index * 3) % 9 === 0 ? 1 : 0,
        row, column: index });
    }
  }
  return createStack('Separate stacked clay units awaiting garage partition work', units, [.30, .12, .17]);
}

export function createCourtyardClayStack(): THREE.Group {
  const units: Unit[] = [];
  for (let row = 0; row < 4; row++) {
    const across = row % 2 === 1, columns = across ? 6 : 4, lanes = across ? 2 : 3;
    for (let lane = 0; lane < lanes; lane++) for (let col = 0; col < columns; col++) {
      const index = lane * columns + col;
      units.push({ x: across ? 16.38 + col * .188 : 16.42 + col * .29,
        y: .19 + row * .125, z: across ? 14.46 + lane * .31 : 14.42 + lane * .19,
        across, variant: (row * 17 + index * 7) % 13 === 0 ? 2 : (row * 3 + index * 11) % 11 === 0 ? 1 : 0,
        row, column: index });
    }
  }
  return createStack('Pallet stack of unlaid clay units in courtyard', units, [.27, .12, .17]);
}

const timberLoader = new THREE.TextureLoader();
const wood = timberLoader.load(`${import.meta.env.BASE_URL}assets/site-materials/wooden_planks-albedo-512.webp`);
wood.colorSpace = THREE.SRGBColorSpace; wood.wrapS = wood.wrapT = THREE.RepeatWrapping; wood.anisotropy = 4;
const woodNormal = timberLoader.load(`${import.meta.env.BASE_URL}assets/site-materials/wooden_planks-normal-512.webp`);
woodNormal.wrapS = woodNormal.wrapT = THREE.RepeatWrapping;
const timber = new THREE.MeshStandardMaterial({ name: 'Weathered pallet timber', map: wood, normalMap: woodNormal,
  normalScale: new THREE.Vector2(.2, .2), color: 0xcfb99a, vertexColors: true, roughness: .96 });

export function createTimberPallet(name: string, width: number, depth: number, x: number, z: number): THREE.Group {
  const group = new THREE.Group(); group.name = name; group.position.set(x, 0, z);
  const boards: THREE.BufferGeometry[] = [];
  const add = (label: string, w: number, h: number, d: number, px: number, py: number, pz: number) => {
    const geometry = new THREE.BoxGeometry(w, h, d);
    geometry.translate(px, py, pz);
    const color = new THREE.Color().setRGB(label.startsWith('Lower') ? .78 : .87 + boards.length % 4 * .035,
      label.startsWith('Lower') ? .78 : .87 + boards.length % 4 * .035,
      label.startsWith('Lower') ? .78 : .87 + boards.length % 4 * .035);
    const colors = new Float32Array(geometry.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) colors.set([color.r, color.g, color.b], i);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    boards.push(geometry);
  };
  for (const offset of [-.39, 0, .39]) {
    add('Open pallet longitudinal bearer', .095, .075, depth - .04, offset * width, .056, 0);
  }
  for (let i = 0; i < 5; i++) {
    add('Separate worn pallet deck board', width - .015, .028, depth * .155, 0, .107,
      (i - 2) * depth * .20);
  }
  for (const offset of [-.32, .32]) add('Lower pallet cross board', width - .015, .022, depth * .16, 0, .014, offset * depth);
  const geometry = mergeGeometries(boards, false);
  for (const board of boards) board.dispose();
  if (!geometry) throw new Error('Could not assemble timber pallet');
  const pallet = new THREE.Mesh(geometry, timber);
  pallet.name = 'Separated pallet boards with open fork spaces';
  pallet.castShadow = pallet.receiveShadow = true;
  group.add(pallet);
  return group;
}
