import * as THREE from 'three';
import { attribute, min, mix, normalMap, positionWorld, sin, smoothstep, texture as sampleTexture, uv, vec2, vec3 } from 'three/tsl';
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
const laidClay = mix(photographed, clayInterior, siteClayReady.mul(.25)).mul(clayRibShade);
// The real recessed joints remain geometry. Only a little trowel squeeze-out
// reaches each uneven fired-clay edge; broad faces keep their photographed clay.
const mortarNoise = sin(positionWorld.x.mul(74).add(positionWorld.y.mul(39)))
  .mul(sin(positionWorld.y.mul(121).sub(positionWorld.z.mul(57))));
const mortarGrain = sin(positionWorld.x.mul(503)).mul(sin(positionWorld.y.mul(617)));
const mortarPigment = vec3(.42, .405, .375).mul(mortarGrain.mul(.09).add(.94));
const mortarReach = mortarNoise.mul(.008).add(.014);
const mortarCoverage = smoothstep(.55, .89, mortarNoise.mul(.5).add(.5)).mul(.43);
const intactUv = uv();
const intactEdge = min(min(intactUv.x, intactUv.x.oneMinus()), min(intactUv.y, intactUv.y.oneMinus()));
const intactMortar = smoothstep(mortarReach.sub(.008), mortarReach.add(.010), intactEdge).oneMinus().mul(mortarCoverage);
masonryFaceMaterial.colorNode = mix(laidClay, mortarPigment, intactMortar);
// A pressed-clay face has long horizontal ribs. Keep the material-specific
// relief on the exposed face while physical mortar joints stay geometric.
masonryFaceMaterial.normalNode = normalMap(sampleTexture(clayRibNormal, uv()), vec2(.75, .75));

/** Damaged units retain their photographed original broad faces; newly opened
 * clay and the longitudinal chambers use the material lattice's vertex color. */
export const damagedMasonryMaterial = new MeshStandardNodeMaterial({ roughness: 1 });
damagedMasonryMaterial.name = 'Photographed clay with true fractured interior';
const brokenUv = attribute<'vec2'>('brickLocalUv', 'vec2');
const brokenEdge = min(min(brokenUv.x, brokenUv.x.oneMinus()), min(brokenUv.y, brokenUv.y.oneMinus()));
const brokenMortar = smoothstep(mortarReach.sub(.008), mortarReach.add(.010), brokenEdge).oneMinus().mul(mortarCoverage);
const brokenColor = attribute<'vec3'>('color', 'vec3');
const texturedBreak = mix(brokenColor, clayInterior,
  smoothstep(.08, .2, brokenColor.r.sub(brokenColor.g)).mul(siteClayReady).mul(.42));
damagedMasonryMaterial.colorNode = mix(texturedBreak,
  mix(mix(sampleTexture(brickFace, uv()).rgb, clayInterior, siteClayReady.mul(.25)).mul(clayRibShade),
    mortarPigment, brokenMortar),
  attribute('brickFace', 'float')).mul(attribute('brickTint', 'vec3'));
