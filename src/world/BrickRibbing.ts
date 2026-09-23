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
export const clayRibShade = clayRibHeight.mul(.19).oneMinus().add(shoulder.mul(.028));

// One fine normal profile is shared by all exposed clay faces. The ten raised
// bands per unit are visible under moving daylight without thousands of tiny
// strip meshes or any change to the collision/demolition volume.
const ribPixels = new Uint8Array(16 * 256 * 4);
for (let y = 0; y < 256; y++) for (let x = 0; x < 16; x++) {
  const phase = y / 256 * 10 % 1;
  const slope = phase < .16 ? .76 * Math.sin(Math.PI * phase / .16)
    : phase > .84 ? -.76 * Math.sin(Math.PI * (phase - .84) / .16) : 0;
  const grain = Math.sin(x * 13.7 + y * 2.93) * .025;
  const ny = THREE.MathUtils.clamp(slope + grain, -.9, .9);
  const nz = Math.sqrt(1 - ny * ny);
  const index = (y * 16 + x) * 4;
  ribPixels[index] = 128;
  ribPixels[index + 1] = Math.round((ny * .5 + .5) * 255);
  ribPixels[index + 2] = Math.round((nz * .5 + .5) * 255);
  ribPixels[index + 3] = 255;
}
export const clayRibNormal = new THREE.DataTexture(ribPixels, 16, 256, THREE.RGBAFormat);
clayRibNormal.name = 'Pressed horizontal clay rib relief';
clayRibNormal.wrapS = clayRibNormal.wrapT = THREE.RepeatWrapping;
clayRibNormal.minFilter = THREE.LinearMipmapLinearFilter;
clayRibNormal.magFilter = THREE.LinearFilter;
clayRibNormal.generateMipmaps = true;
clayRibNormal.needsUpdate = true;
