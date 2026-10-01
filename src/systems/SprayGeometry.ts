import * as THREE from 'three';

interface Cache {
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
  version: number;
  index: THREE.BufferAttribute | null;
  indexVersion: number;
  range: string;
  pieces: THREE.BufferGeometry[];
}

const cache = new WeakMap<THREE.BufferGeometry, Cache>();

/** Small spatial pieces share the source vertex buffers. This keeps picking
 * and decal clipping local even when the renderer merges an entire floor. */
export function sprayGeometryPieces(source: THREE.BufferGeometry): THREE.BufferGeometry[] {
  const position = source.getAttribute('position');
  const index = source.index;
  const count = index?.count ?? position.count;
  const usage = position instanceof THREE.InterleavedBufferAttribute ? position.data.usage : position.usage;
  if (count <= 4096 || usage !== THREE.StaticDrawUsage || Object.keys(source.morphAttributes).length)
    return [source];
  const range = `${source.drawRange.start}:${source.drawRange.count}:${source.groups.map(g => `${g.start},${g.count},${g.materialIndex}`).join(';')}`;
  const version = position instanceof THREE.InterleavedBufferAttribute ? position.data.version : position.version;
  const saved = cache.get(source);
  if (saved?.position === position && saved.version === version && saved.index === index &&
      saved.indexVersion === (index?.version ?? 0) && saved.range === range) return saved.pieces;
  const pieces: THREE.BufferGeometry[] = [], vertex = new THREE.Vector3();
  const groups = source.groups.length ? source.groups : [{ start: 0, count, materialIndex: 0 }];
  for (const group of groups) {
    const start = Math.max(group.start, source.drawRange.start);
    const end = Math.min(count, group.start + group.count, source.drawRange.start + source.drawRange.count);
    for (let offset = start; offset < end; offset += 384) {
      const length = Math.min(384, end - offset), geometry = new THREE.BufferGeometry();
      for (const name of Object.keys(source.attributes)) geometry.setAttribute(name, source.getAttribute(name));
      if (index) geometry.setIndex(new THREE.BufferAttribute(index.array.subarray(offset, offset + length), 1));
      else geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from({ length }, (_, i) => offset + i), 1));
      geometry.addGroup(0, length, group.materialIndex);
      geometry.boundingBox = new THREE.Box3();
      for (let i = 0; i < length; i++) geometry.boundingBox.expandByPoint(vertex.fromBufferAttribute(position, geometry.index!.getX(i)));
      geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
      pieces.push(geometry);
    }
  }
  cache.set(source, { position, version, index, indexVersion: index?.version ?? 0, range, pieces });
  return pieces;
}
