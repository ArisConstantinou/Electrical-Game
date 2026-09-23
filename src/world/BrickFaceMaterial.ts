import * as THREE from 'three';
import { attribute, mix, normalMap, texture as sampleTexture, uv, vec2 } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { clayRibNormal, clayRibShade, siteClayImage, siteClayReady } from './BrickRibbing';

// The reference-derived atlas has independent broad faces; geometry supplies
// each real mortar joint rather than sampling it from a texture.
const brickFace = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}assets/masonry/human-laid-brick-face-atlas-v3.png`);
brickFace.colorSpace = THREE.SRGBColorSpace;
brickFace.anisotropy = 8;
brickFace.wrapS = brickFace.wrapT = THREE.RepeatWrapping;

export const masonryFaceMaterial = new MeshStandardNodeMaterial({ roughness: 1 });
masonryFaceMaterial.name = 'Varied photographed fired-clay units';
const patch = attribute<'vec4'>('brickPatch', 'vec4');
const photoUv = uv().mul(patch.zw).add(patch.xy);
const photographed = sampleTexture(brickFace, photoUv).rgb;
const clayInterior = sampleTexture(siteClayImage, vec2(uv().x, uv().y.mul(.66).add(.32))).rgb;
masonryFaceMaterial.colorNode = mix(photographed, clayInterior, siteClayReady.mul(.25)).mul(clayRibShade);
// A pressed-clay face has long horizontal ribs. Keep the material-specific
// relief on the exposed face while physical mortar joints stay geometric.
masonryFaceMaterial.normalNode = normalMap(sampleTexture(clayRibNormal, uv()), vec2(.75, .75));

/** Damaged units retain their photographed original broad faces; newly opened
 * clay and the longitudinal chambers use the material lattice's vertex color. */
export const damagedMasonryMaterial = new MeshStandardNodeMaterial({ roughness: 1 });
damagedMasonryMaterial.name = 'Photographed clay with true fractured interior';
damagedMasonryMaterial.colorNode = mix(attribute('color', 'vec3'),
  mix(sampleTexture(brickFace, uv()).rgb, clayInterior, siteClayReady.mul(.25)).mul(clayRibShade),
  attribute('brickFace', 'float')).mul(attribute('brickTint', 'vec3'));
