import * as THREE from 'three';

type Surface = 'floor' | 'concrete' | 'plaster' | 'clay';

const textureSources = new Map<Surface, HTMLCanvasElement>();
const textureLoader = new THREE.TextureLoader();
const materialTextures = new Map<string, THREE.Texture>();
const photographed: Partial<Record<Surface, string>> = new URLSearchParams(location.search).get('materials') === 'legacy' ? {} : {
  floor: 'concrete_screed',
  concrete: 'concrete',
  plaster: 'plastered_wall_03',
};
function photographedTexture(surface: Surface, repeatX: number, repeatY: number): THREE.Texture {
  const key = `${surface}:${repeatX}:${repeatY}`;
  const cached = materialTextures.get(key);
  if (cached) return cached;
  const image = textureLoader.load(`${import.meta.env.BASE_URL}assets/site-materials/${photographed[surface]}-albedo-512.webp`);
  image.name = `${surface} albedo 512 CC0`;
  image.colorSpace = THREE.SRGBColorSpace;
  image.wrapS = image.wrapT = THREE.RepeatWrapping;
  image.repeat.set(repeatX, repeatY);
  image.anisotropy = 4;
  materialTextures.set(key, image);
  return image;
}
const hash = (x: number, y: number, seed: number): number => {
  let value = Math.imul(x ^ seed, 374761393) ^ Math.imul(y, 668265263);
  value = Math.imul(value ^ value >>> 13, 1274126177);
  return ((value ^ value >>> 16) >>> 0) / 4294967295;
};

/** Small, deterministic albedo/bump maps: no network assets or per-frame work. */
function source(surface: Surface): HTMLCanvasElement {
  const cached = textureSources.get(surface);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  const size = surface === 'clay' ? 128 : surface === 'concrete' ? 256 : 512;
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Construction material canvas unavailable');
  const pixels = context.createImageData(size, size);
  const seed = { floor: 611, concrete: 912, plaster: 421, clay: 781 }[surface];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size * Math.PI * 2, v = y / size * Math.PI * 2;
    // Periodic broad variation keeps tile edges continuous. Fine pitting is
    // restrained enough to remain readable beneath strong raking daylight.
    const mottling = Math.sin(u * 2 + Math.cos(v * 3)) * 4
      + Math.sin(u * 5 - v * 4) * 2.5 + Math.cos(v * 7 + Math.sin(u * 3)) * 2;
    const grain = hash(x, y, seed);
    const aggregate = hash(Math.floor(x / 3), Math.floor(y / 3), seed + 18);
    let shade = 228 + mottling + (grain - .5) * (surface === 'plaster' ? 35 : 20);
    if (surface === 'plaster') shade += (aggregate - .5) * 18;
    if (surface === 'floor') {
      const coarseAggregate = hash(Math.floor(x / 7), Math.floor(y / 7), seed + 73);
      shade += Math.sin(u * 2 + v * 3) * 4 + (coarseAggregate - .5) * 21;
      if (grain < .018) shade -= 36;
      else if (grain > .986) shade += 16;
    } else if (surface === 'concrete' && aggregate < .05) shade -= 23;
    else if (surface === 'clay' && grain < .06) shade -= 13;
    const index = (y * size + x) * 4;
    pixels.data[index] = THREE.MathUtils.clamp(shade + 2, 0, 255);
    pixels.data[index + 1] = THREE.MathUtils.clamp(shade + 1, 0, 255);
    pixels.data[index + 2] = THREE.MathUtils.clamp(shade - (surface === 'floor' ? 3 : 0), 0, 255);
    pixels.data[index + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  textureSources.set(surface, canvas);
  return canvas;
}

export function siteMaterial(surface: Surface, color: number, repeatX = 1, repeatY = 1): THREE.MeshStandardMaterial {
  if (photographed[surface]) {
    return new THREE.MeshStandardMaterial({
      name: `Scanned ${surface} surface`,
      color,
      map: photographedTexture(surface, repeatX, repeatY),
      roughness: surface === 'concrete' ? .92 : .97,
      metalness: 0,
    });
  }
  const texture = new THREE.CanvasTexture(source(surface));
  texture.name = `Procedural ${surface} aggregate`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = 4;
  return new THREE.MeshStandardMaterial({
    name: `Unfinished ${surface}`,
    color,
    map: texture,
    bumpMap: texture,
    bumpScale: surface === 'plaster' ? .008 : surface === 'concrete' ? .004 : surface === 'floor' ? .005 : .0015,
    roughness: .98,
    metalness: 0,
  });
}

let siteProScreedTexture: THREE.Texture | null = null;
export function siteProScreedMaterial(): THREE.MeshStandardMaterial {
  if (!siteProScreedTexture) {
    siteProScreedTexture = textureLoader.load(`${import.meta.env.BASE_URL}assets/site-materials/site-pro-screed-v1.webp`);
    siteProScreedTexture.name = 'Site Pro unfinished cement screed albedo';
    siteProScreedTexture.colorSpace = THREE.SRGBColorSpace;
    siteProScreedTexture.wrapS = siteProScreedTexture.wrapT = THREE.RepeatWrapping;
    siteProScreedTexture.repeat.set(2, 1.9);
    siteProScreedTexture.anisotropy = 4;
  }
  return new THREE.MeshStandardMaterial({ name: 'Site Pro poured screed', map: siteProScreedTexture, roughness: .98, metalness: 0 });
}

export const matteMaterial = (color: number, roughness = .92): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
