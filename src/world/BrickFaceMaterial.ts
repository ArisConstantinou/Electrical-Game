import * as THREE from 'three';
import { attribute, mix, texture as sampleTexture, uv, vec2 } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { clayRibShade, siteClayImage, siteClayReady } from './BrickRibbing';

// Poly Haven "Red Brick" by Rob Tuytel, CC0: https://polyhaven.com/a/red_brick
// Physical clay units choose mortar-free photographed patches; the geometry
// and backing material supply the mortar joints instead of painting them twice.
const brickFace = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}assets/masonry/red-brick-polyhaven-1k.jpg`);
brickFace.colorSpace = THREE.SRGBColorSpace;
brickFace.anisotropy = 8;
brickFace.wrapS = brickFace.wrapT = THREE.RepeatWrapping;

export const masonryFaceMaterial = new MeshStandardNodeMaterial({ roughness: 1 });
masonryFaceMaterial.name = 'Varied photographed fired-clay units';
const patch = attribute<'vec4'>('brickPatch', 'vec4');
const photographed = sampleTexture(brickFace, uv().mul(patch.zw).add(patch.xy)).rgb;
const clayInterior = sampleTexture(siteClayImage, vec2(uv().x, uv().y.mul(.66).add(.32))).rgb;
masonryFaceMaterial.colorNode = mix(photographed, clayInterior, siteClayReady.mul(.42)).mul(clayRibShade);

// An exposed ceiling block shows its pressed clay underside, not the generated
// rib study used to soften wall faces. Keep the photographed crops distinct.
export const claySoffitFaceMaterial = new MeshStandardNodeMaterial({ roughness: 1 });
claySoffitFaceMaterial.name = 'Photographed fired-clay ceiling infill';
claySoffitFaceMaterial.colorNode = photographed;
