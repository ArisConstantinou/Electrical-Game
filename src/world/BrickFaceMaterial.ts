import * as THREE from 'three';
import { attribute, mix, normalMap, texture as sampleTexture, uv, vec2 } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { clayRibNormal, clayRibShade, siteClayImage, siteClayReady } from './BrickRibbing';

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
const photoUv = uv().mul(patch.zw).add(patch.xy);
const photographed = sampleTexture(brickFace, photoUv).rgb;
const clayInterior = sampleTexture(siteClayImage, vec2(uv().x, uv().y.mul(.66).add(.32))).rgb;
masonryFaceMaterial.colorNode = mix(photographed, clayInterior, siteClayReady.mul(.62)).mul(clayRibShade);
// A pressed-clay face has long horizontal ribs. Keep the material-specific
// relief on the exposed face while physical mortar joints stay geometric.
masonryFaceMaterial.normalNode = normalMap(sampleTexture(clayRibNormal, uv()), vec2(.75, .75));
