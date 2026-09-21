import * as THREE from 'three';
import { attribute, texture as sampleTexture, uv } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';

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
masonryFaceMaterial.colorNode = sampleTexture(brickFace, uv().mul(patch.zw).add(patch.xy)).rgb;
