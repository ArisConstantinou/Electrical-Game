import * as THREE from 'three';
import { attribute, mix, normalMap, texture as sampleTexture, uv, vec2 } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { clayRibShade, siteClayImage, siteClayReady } from './BrickRibbing';

// Poly Haven "Red Brick" by Rob Tuytel, CC0: https://polyhaven.com/a/red_brick
// Physical clay units choose mortar-free photographed patches; the geometry
// and backing material supply the mortar joints instead of painting them twice.
const brickFace = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}assets/masonry/red-brick-polyhaven-1k.jpg`);
brickFace.colorSpace = THREE.SRGBColorSpace;
brickFace.anisotropy = 8;
brickFace.wrapS = brickFace.wrapT = THREE.RepeatWrapping;
const brickNormal = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}assets/masonry/red-brick-normal-1k.webp`);
brickNormal.anisotropy = 8;
brickNormal.wrapS = brickNormal.wrapT = THREE.RepeatWrapping;

export const masonryFaceMaterial = new MeshStandardNodeMaterial({ roughness: 1 });
masonryFaceMaterial.name = 'Varied photographed fired-clay units';
const patch = attribute<'vec4'>('brickPatch', 'vec4');
const photoUv = uv().mul(patch.zw).add(patch.xy);
const photographed = sampleTexture(brickFace, photoUv).rgb;
const clayInterior = sampleTexture(siteClayImage, vec2(uv().x, uv().y.mul(.66).add(.32))).rgb;
masonryFaceMaterial.colorNode = mix(photographed, clayInterior, siteClayReady.mul(.42)).mul(clayRibShade);
// Sample the exact same mortar-free crop as the albedo. This changes only the
// lighting response of each fired-clay face; the physical joints stay geometric.
masonryFaceMaterial.normalNode = normalMap(sampleTexture(brickNormal, photoUv), vec2(.42, .42));

// An exposed ceiling block shows its pressed clay underside, not the generated
// rib study used to soften wall faces. Keep the photographed crops distinct.
export const claySoffitFaceMaterial = new MeshStandardNodeMaterial({ roughness: 1 });
claySoffitFaceMaterial.name = 'Photographed fired-clay ceiling infill';
claySoffitFaceMaterial.colorNode = photographed;
claySoffitFaceMaterial.normalNode = normalMap(sampleTexture(brickNormal, photoUv), vec2(.3, .3));
// The overhead face misses the warm bounce reaching the adjacent clay wall.
// Keep the photographed variation while bringing the two faces into the same
// apparent material family at their structural junction.
claySoffitFaceMaterial.emissive.set(0x8b5740);
claySoffitFaceMaterial.emissiveIntensity = .12;
