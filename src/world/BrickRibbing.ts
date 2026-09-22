import * as THREE from 'three';
import { positionWorld, sin, smoothstep, uniform } from 'three/tsl';

// The Site Pro source is one ribbed clay unit. Its lower edge contains baked
// mortar; callers sample only the upper clay interior and retain their own
// varied photographic patches and separately modeled physical joints.
export const siteClayReady = uniform(0);
export const siteClayImage = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}assets/masonry/brick-face-site.webp`, () => { siteClayReady.value = 1; });
siteClayImage.colorSpace = THREE.SRGBColorSpace;
siteClayImage.wrapS = siteClayImage.wrapT = THREE.RepeatWrapping;
siteClayImage.anisotropy = 8;

// Site Pro's fired-clay units are extruded with shallow horizontal ribs.
// Keep the clay face irregularity independent of the photographed color patch
// and the separate physical mortar joints. One cycle is roughly 10 mm high.
const cycle = sin(positionWorld.y.mul(620));
const clayRibHeight = smoothstep(.66, .98, cycle);
const shoulder = smoothstep(-.35, .2, sin(positionWorld.y.mul(620).add(1.15)));
export const clayRibShade = clayRibHeight.mul(.055).oneMinus().add(shoulder.mul(.012));
