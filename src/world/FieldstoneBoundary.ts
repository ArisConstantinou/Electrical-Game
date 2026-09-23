import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const BASE = `${import.meta.env.BASE_URL}assets/site-materials/`;
interface FieldstoneMaterials { stone: THREE.MeshStandardMaterial; mortar: THREE.MeshStandardMaterial; coping: THREE.MeshStandardMaterial }
let cachedMaterials: FieldstoneMaterials | null = null;
function materials(): FieldstoneMaterials {
  if (cachedMaterials) return cachedMaterials;
  const loader = new THREE.TextureLoader();
  const diffuse = loader.load(`${BASE}coral-stone-wall-diff-2k.webp`);
  const normal = loader.load(`${BASE}coral-stone-wall-normal-1k.webp`);
  const height = loader.load(`${BASE}coral-stone-wall-height-1k.webp`);
  diffuse.colorSpace = THREE.SRGBColorSpace;
  for (const map of [diffuse, normal, height]) map.anisotropy = 8;
  cachedMaterials = {
    stone: new THREE.MeshStandardMaterial({
      name: 'Photographed irregular pale fieldstone with real shallow relief',
      map: diffuse, normalMap: normal, normalScale: new THREE.Vector2(.65, .65),
      displacementMap: height, displacementScale: .07, displacementBias: -.027, roughness: 1,
    }),
    mortar: new THREE.MeshStandardMaterial({ color: 0x8e8373, roughness: 1 }),
    coping: new THREE.MeshStandardMaterial({
      name: 'Exposed weathered limestone cap stones', map: diffuse, normalMap: normal,
      normalScale: new THREE.Vector2(.35, .35), roughness: 1,
    }),
  };
  return cachedMaterials;
}

/** A real thickness and a scan-aligned relief face. Sections sample different
 * portions and orientations of the CC0 stone scan to avoid one repeated 2 m tile. */
function reliefFace(name: string, x: number, reverse: boolean, stone: THREE.MeshStandardMaterial): THREE.Mesh {
  const panels: THREE.BufferGeometry[] = [];
  const segmentLength = 2;
  for (let section = 0; section < 30; section++) {
    const panel = new THREE.PlaneGeometry(segmentLength, .84, 16, 8);
    const uv = panel.getAttribute('uv');
    const flipU = section % 4 === 1 || section % 4 === 2;
    const flipV = section % 5 === 2 || section % 5 === 3;
    const topHalf = section % 3 === 0;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i), v = uv.getY(i);
      uv.setXY(i, flipU ? 1 - u : u, (topHalf ? .5 : 0) + (flipV ? 1 - v : v) * .5);
    }
    panel.rotateY(reverse ? Math.PI / 2 : -Math.PI / 2);
    panel.translate(x, .42, -22 + section * segmentLength + segmentLength / 2);
    panels.push(panel);
  }
  const geometry = mergeGeometries(panels, false);
  for (const panel of panels) panel.dispose();
  if (!geometry) throw new Error('Fieldstone relief sections did not merge');
  geometry.computeBoundingSphere();
  const face = new THREE.Mesh(geometry, stone);
  face.name = name;
  face.castShadow = face.receiveShadow = true;
  return face;
}

function stoneCrown(coping: THREE.MeshStandardMaterial): THREE.Mesh {
  const panels: THREE.BufferGeometry[] = [];
  for (let section = 0; section < 30; section++) {
    const panel = new THREE.PlaneGeometry(.6, 2, 2, 8);
    const uv = panel.getAttribute('uv');
    const flip = section % 2 === 1;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, .2 + uv.getX(i) * .3, flip ? 1 - uv.getY(i) : uv.getY(i));
    panel.rotateX(-Math.PI / 2);
    panel.translate(24.17, .845, -21 + section * 2);
    panels.push(panel);
  }
  const geometry = mergeGeometries(panels, false);
  for (const panel of panels) panel.dispose();
  if (!geometry) throw new Error('Fieldstone coping surface did not merge');
  const crown = new THREE.Mesh(geometry, coping);
  crown.name = 'Continuous exposed upper faces between irregular cap stones';
  crown.castShadow = crown.receiveShadow = true;
  return crown;
}

export function createFieldstoneBoundary(): THREE.Group {
  const { stone, mortar, coping } = materials();
  const boundary = new THREE.Group();
  boundary.name = 'Low weathered limestone boundary beside the Cypriot construction site';
  const core = new THREE.Mesh(new THREE.BoxGeometry(.6, .84, 60), mortar);
  core.name = 'Mortar and stone core behind the real fieldstone faces';
  core.position.set(24.17, .42, 8);
  core.castShadow = core.receiveShadow = true;
  boundary.add(core);
  boundary.add(reliefFace('Irregular individual field-boundary stones', 23.855, false, stone));
  boundary.add(reliefFace('Irregular outer fieldstone face', 24.485, true, stone));
  boundary.add(stoneCrown(coping));

  const cap = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), coping, 108);
  cap.name = 'Uneven individually placed fieldstone coping';
  const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), color = new THREE.Color();
  for (let i = 0; i < cap.count; i++) {
    const z = -21.72 + i * .555 + .035 * Math.sin(i * 2.7);
    const y = .81 + .025 * Math.sin(i * 1.93);
    quaternion.setFromEuler(new THREE.Euler(.025 * Math.sin(i * 1.71), .09 * Math.sin(i * 2.19), .03 * Math.cos(i * 1.47)));
    matrix.compose(new THREE.Vector3(24.17 + .018 * Math.sin(i * 2.41), y, z), quaternion,
      new THREE.Vector3(.32 + .035 * Math.sin(i * 1.13), .095 + .018 * Math.cos(i * 1.9), .30 + .025 * Math.sin(i * 2.73)));
    cap.setMatrixAt(i, matrix);
    const shade = .86 + .12 * ((i * .61803398875) % 1);
    cap.setColorAt(i, color.setRGB(shade, shade * .985, shade * .95));
  }
  cap.castShadow = cap.receiveShadow = true;
  cap.computeBoundingSphere();
  boundary.add(cap);
  return boundary;
}
