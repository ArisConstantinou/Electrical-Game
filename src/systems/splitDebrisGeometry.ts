import * as THREE from 'three';

export interface DebrisGeometryPiece { geometry: THREE.BufferGeometry; volume: number }
export interface DebrisGeometrySplit { pieces: [DebrisGeometryPiece, DebrisGeometryPiece]; originalVolume: number }
export interface DebrisSplitOptions { /** Raise only for offline processing, outside the gameplay frame. */ maxVertices?: number }
type Axis = 'x' | 'y' | 'z';
type Triangle = [THREE.Vector3, THREE.Vector3, THREE.Vector3];
const MAX_VERTICES = 12000;
const HARD_MAX_VERTICES = 120000;
const MAX_CUT_SEGMENTS = 2048;

/** Cut the existing local-space solid, preserving its silhouette and cavities.
 * The first piece is below the plane. No positions are scaled or recentered.
 * Open/ambiguous input, degenerate cuts and excessive work return null. */
export function splitDebrisGeometry(geometry: THREE.BufferGeometry, axis: Axis, coordinate?: number, options: DebrisSplitOptions = {}): DebrisGeometrySplit | null {
  if (!['x', 'y', 'z'].includes(axis) || geometry.index) return null;
  const position = geometry.getAttribute('position');
  const maxVertices = Math.min(HARD_MAX_VERTICES, options.maxVertices ?? MAX_VERTICES);
  if (!Number.isFinite(maxVertices) || !position || position.itemSize !== 3 || position.count % 3 || position.count < 12 || position.count > maxVertices) return null;
  const bounds = new THREE.Box3();
  const vertices: THREE.Vector3[] = [];
  for (let i = 0; i < position.count; i++) {
    const p = new THREE.Vector3().fromBufferAttribute(position, i);
    if (![p.x, p.y, p.z].every(Number.isFinite)) return null;
    vertices.push(p); bounds.expandByPoint(p);
  }
  const span = bounds.getSize(new THREE.Vector3()).length(), epsilon = Math.max(1e-9, span * 1e-7);
  // Shared cut vertices may differ by Float32 rounding after a prior cut or
  // transform. Weld only that numerical tolerance, never a voxel-sized gap.
  const weldSize = epsilon * 4, weldBuckets = new Map<string, THREE.Vector3[]>();
  const weld = (p: THREE.Vector3, buckets: Map<string, THREE.Vector3[]>): THREE.Vector3 => {
    const x = Math.floor(p.x / weldSize), y = Math.floor(p.y / weldSize), z = Math.floor(p.z / weldSize);
    const bucketKey = `${x},${y},${z}`, own = buckets.get(bucketKey) ?? [];
    let match = own.find(q => q.distanceToSquared(p) <= weldSize * weldSize);
    if (!match) for (let dx = -1; dx <= 1 && !match; dx++) for (let dy = -1; dy <= 1 && !match; dy++) for (let dz = -1; dz <= 1 && !match; dz++) {
      if (dx || dy || dz) match = buckets.get(`${x + dx},${y + dy},${z + dz}`)?.find(q => q.distanceToSquared(p) <= weldSize * weldSize);
    }
    if (match) return match;
    own.push(p); buckets.set(bucketKey, own); return p;
  };
  for (let i = 0; i < vertices.length; i++) vertices[i] = weld(vertices[i], weldBuckets);
  const plane = Math.fround(coordinate ?? (bounds.min[axis] + bounds.max[axis]) * .5);
  if (!Number.isFinite(plane) || plane <= bounds.min[axis] + epsilon || plane >= bounds.max[axis] - epsilon) return null;
  const key = (p: THREE.Vector3): string => [p.x, p.y, p.z].map(v => Math.round(v / epsilon)).join(',');
  const degenerate = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): boolean => {
    const areaSq = b.clone().sub(a).cross(c.clone().sub(a)).lengthSq();
    // Use altitude: rotation can give an originally collinear cap sliver a
    // tiny nonzero area proportional to its long edge, rather than epsilon².
    return areaSq <= epsilon * epsilon * 16 * Math.max(a.distanceToSquared(b), b.distanceToSquared(c), c.distanceToSquared(a));
  };
  const inputPoints = new Map(vertices.map(p => [key(p), p]));
  const edgeCounts = new Map<string, number>();
  const countEdge = (map: Map<string, number>, a: string, b: string, amount = 1): void => {
    if (a === b) return;
    const k = a < b ? a + ':' + b : b + ':' + a;
    map.set(k, (map.get(k) ?? 0) + (a < b ? amount : -amount));
  };
  const closedEdges = (edges: Map<string, number>, points: Map<string, THREE.Vector3>): boolean => {
  let residual = [...edges].filter(([, count]) => count !== 0);
    for (let pass = 0; residual.length && pass < 3; pass++) {
      if (residual.length > MAX_CUT_SEGMENTS) return false;
      const endpoints = new Map<string, THREE.Vector3>();
      for (const [edge] of residual) for (const k of edge.split(':')) endpoints.set(k, points.get(k)!);
      const repaired = new Map<string, number>();
      // A previous cap may subdivide a straight shell edge. Rotation and
      // Float32 recentering preserve that surface, but not identical edge lists.
      // Compare the same geometric subedges before declaring the mesh open.
      for (const [edge, count] of residual) {
        const [ak, bk] = edge.split(':'), a = endpoints.get(ak)!, b = endpoints.get(bk)!;
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, lengthSq = dx * dx + dy * dy + dz * dz;
        const tolerance = epsilon * 4 / Math.sqrt(lengthSq), chain: Array<{ key: string; t: number }> = [];
        for (const [k, p] of endpoints) {
          const px = p.x - a.x, py = p.y - a.y, pz = p.z - a.z, t = (px * dx + py * dy + pz * dz) / lengthSq;
          if (t < -tolerance || t > 1 + tolerance) continue;
          if ((px - dx * t) ** 2 + (py - dy * t) ** 2 + (pz - dz * t) ** 2 < epsilon * epsilon * 16) chain.push({ key: k, t });
        }
        chain.sort((a, b) => a.t - b.t);
        for (let i = 1; i < chain.length; i++) countEdge(repaired, chain[i - 1].key, chain[i].key, count);
      }
      residual = [...repaired].filter(([, count]) => count !== 0);
    }
    if (residual.length) return false;
  return true;
  };
  let triangles: Triangle[] = [];
  const trianglePairs = new Map<string, { triangle: Triangle; balance: number }>();
  for (let i = 0; i < vertices.length; i += 3) {
    const tri = vertices.slice(i, i + 3) as Triangle;
    if (tri[1].clone().sub(tri[0]).cross(tri[2].clone().sub(tri[0])).lengthSq() < epsilon ** 4) continue;
    triangles.push(tri);
    const keys = tri.map(key);
    for (let j = 0; j < 3; j++) countEdge(edgeCounts, keys[j], keys[(j + 1) % 3]);
    const winding = (keys[0] > keys[1] ? 1 : 0) + (keys[0] > keys[2] ? 1 : 0) + (keys[1] > keys[2] ? 1 : 0);
    const triangleKey = keys.slice().sort().join(':'), direction = winding % 2 ? -1 : 1;
    const old = trianglePairs.get(triangleKey);
    if (old) { old.balance += direction; if (old.balance === direction) old.triangle = tri; }
    else trianglePairs.set(triangleKey, { triangle: tri, balance: direction });
  }
  // Directed balance admits the internal tetra faces in real masonry debris,
  // while rejecting exposed edges before inventing a cap for an open shell.
  if (!closedEdges(edgeCounts, inputPoints)) return null;
  // Original fragments contain the closed faces of every removed tetrahedron.
  // Paired internal faces contribute zero volume and need no clipping work.
  if ([...trianglePairs.values()].some(pair => Math.abs(pair.balance) > 1 && !degenerate(...pair.triangle))) return null;
  triangles = [...trianglePairs.values()].filter(pair => pair.balance !== 0 && (Math.abs(pair.balance) === 1 || !degenerate(...pair.triangle))).map(pair => pair.triangle);
  const reference = bounds.getCenter(new THREE.Vector3());
  const signedVolume = (tris: Triangle[]): number => {
    let volume = 0;
    for (const [a, b, c] of tris) volume += a.clone().sub(reference).dot(b.clone().sub(reference).cross(c.clone().sub(reference))) / 6;
    return volume;
  };
  const originalVolume = signedVolume(triangles);
  if (!(originalVolume > epsilon ** 3)) return null;
  const halves: [Triangle[], Triangle[]] = [[], []];
  const push = (output: Triangle[], a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void => {
    if (!degenerate(a, b, c)) output.push([a, b, c]);
  };
  for (const triangle of triangles) {
    const tri = triangle.map(p => { const q = p.clone(); if (Math.abs(q[axis] - plane) < epsilon) q[axis] = plane; return q; });
    const coplanar = tri.every(p => p[axis] === plane);
    if (coplanar) {
      const normal = tri[1].clone().sub(tri[0]).cross(tri[2].clone().sub(tri[0]));
      push(halves[normal[axis] > 0 ? 0 : 1], tri[0], tri[1], tri[2]);
      continue;
    }
    for (let side = 0; side < 2; side++) {
      const polygon: THREE.Vector3[] = [], sign = side === 0 ? 1 : -1;
      for (let i = 0; i < 3; i++) {
        const a = tri[i], b = tri[(i + 1) % 3], da = (a[axis] - plane) * sign, db = (b[axis] - plane) * sign;
        if (da <= 0) polygon.push(a);
        if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
          const cut = a.clone().lerp(b, da / (da - db)); cut[axis] = plane; polygon.push(cut);
        }
      }
      for (let i = 1; i + 1 < polygon.length; i++) push(halves[side], polygon[0], polygon[i], polygon[i + 1]);
    }
  }
  const axes: [Axis, Axis] = axis === 'x' ? ['y', 'z'] : axis === 'y' ? ['z', 'x'] : ['x', 'y'];
  const project = (p: THREE.Vector3): THREE.Vector2 => new THREE.Vector2(p[axes[0]], p[axes[1]]);
  for (let side = 0; side < 2; side++) {
    const segments: Array<[THREE.Vector3, THREE.Vector3]> = [], points = new Map<string, THREE.Vector3>();
    const cutBuckets = new Map<string, THREE.Vector3[]>();
    for (const tri of halves[side]) for (let i = 0; i < 3; i++) if (tri[i][axis] === plane) tri[i] = weld(tri[i], cutBuckets);
    halves[side] = halves[side].filter(tri => !degenerate(...tri));
    for (const tri of halves[side]) for (let i = 0; i < 3; i++) {
      const a = tri[i], b = tri[(i + 1) % 3];
      if (a[axis] !== plane || b[axis] !== plane || key(a) === key(b)) continue;
      segments.push([a, b]); points.set(key(a), a); points.set(key(b), b);
    }
    if (!segments.length || segments.length > MAX_CUT_SEGMENTS) return null;
    const cutEdges = new Map<string, number>(), entries = [...points.entries()];
    // Adjacent clipped tetra faces can subdivide the same straight edge
    // differently. Split at all existing cut vertices before cancellation.
    const along = (a: THREE.Vector3, b: THREE.Vector3): Array<{ key: string; point: THREE.Vector3; t: number }> => {
      a = points.get(key(a)) ?? a; b = points.get(key(b)) ?? b;
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, lengthSq = dx * dx + dy * dy + dz * dz;
      const chain: Array<{ key: string; point: THREE.Vector3; t: number }> = [];
      for (const [k, p] of entries) {
        const px = p.x - a.x, py = p.y - a.y, pz = p.z - a.z, t = (px * dx + py * dy + pz * dz) / lengthSq;
        if (t < -epsilon || t > 1 + epsilon) continue;
        if ((px - dx * t) ** 2 + (py - dy * t) ** 2 + (pz - dz * t) ** 2 < epsilon * epsilon * 4) chain.push({ key: k, point: p, t });
      }
      return chain.sort((a, b) => a.t - b.t);
    };
    const conforming: Triangle[] = [];
    for (const tri of halves[side]) {
      const boundary: THREE.Vector3[] = []; let subdivided = false;
      for (let i = 0; i < 3; i++) {
        const a = tri[i], b = tri[(i + 1) % 3];
        const chain = a[axis] === plane && b[axis] === plane ? along(a, b) : [];
        if (chain.length > 2) { subdivided = true; boundary.push(...chain.slice(0, -1).map(p => p.point)); }
        else boundary.push(a);
      }
      if (!subdivided) { conforming.push(tri); continue; }
      const center = tri[0].clone().add(tri[1]).add(tri[2]).multiplyScalar(1 / 3);
      for (let i = 0; i < boundary.length; i++) push(conforming, center, boundary[i], boundary[(i + 1) % boundary.length]);
    }
    // The shell and cap share identical subdivisions. The next strike can
    // reuse this boundary after Float32 recentering without accumulating gaps.
    halves[side] = conforming;
    for (const [a, b] of segments) {
      const chain = along(a, b);
      for (let i = 1; i < chain.length; i++) countEdge(cutEdges, chain[i - 1].key, chain[i].key);
    }
    const outgoing = new Map<string, string[]>(), incoming = new Map<string, number>();
    for (const [edge, count] of cutEdges) {
      if (!count) continue;
      if (Math.abs(count) !== 1) return null;
      const pair = edge.split(':'), [a, b] = count > 0 ? pair : pair.reverse();
      const list = outgoing.get(a) ?? []; list.push(b); outgoing.set(a, list);
      incoming.set(b, (incoming.get(b) ?? 0) + 1);
    }
    if (!outgoing.size || [...outgoing].some(([key, list]) => list.length !== incoming.get(key))) return null;
    const visited = new Set<string>(), loops: THREE.Vector3[][] = [];
    for (const [start, targets] of outgoing) for (const first of targets) {
      if (visited.has(start + ':' + first)) continue;
      const loop: THREE.Vector3[] = []; let previous = start, current = first;
      visited.add(start + ':' + first); loop.push(points.get(start)!);
      do {
        if (current === start) break;
        loop.push(points.get(current)!);
        const p = project(points.get(previous)!), q = project(points.get(current)!);
        const direction = q.clone().sub(p);
        // Distinct tetra lobes can touch at a single cut vertex. Follow the
        // tight outward turn rather than merging their outlines into a bowtie.
        const options = outgoing.get(current)!.map(next => {
          const d = project(points.get(next)!).sub(q);
          return { next, angle: Math.atan2(direction.cross(d), direction.dot(d)) };
        }).sort((a, b) => (a.angle - b.angle) * (side === 0 ? 1 : -1));
        const next = options[0].next, edge = current + ':' + next;
        if (visited.has(edge)) return null;
        visited.add(edge); previous = current; current = next;
      } while (current !== start);
      if (loop.length < 3) return null;
      loops.push(loop);
    }
    const projected = loops.map(loop => loop.map(project));
    const inside = (p: THREE.Vector2, polygon: THREE.Vector2[]): boolean => {
      let result = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i], b = polygon[j];
        if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) result = !result;
      }
      return result;
    };
    const depths = projected.map((loop, i) => projected.filter((other, j) => j !== i && inside(loop[0], other)).length);
    for (let i = 0; i < loops.length; i++) {
      if (depths[i] % 2) continue;
      const holeIds = loops.map((_, j) => j).filter(j => depths[j] === depths[i] + 1 && inside(projected[j][0], projected[i]));
      const polygons = [loops[i], ...holeIds.map(j => loops[j])], flat = polygons.flat();
      const faces = THREE.ShapeUtils.triangulateShape(projected[i], holeIds.map(j => projected[j]));
      if (!faces.length) return null;
      let capArea = 0;
      for (const face of faces) {
        const [a, b, c] = face.map(index => flat[index]);
        const cross = b.clone().sub(a).cross(c.clone().sub(a)); capArea += Math.abs(cross[axis]) * .5;
        const center = a.clone().add(b).add(c).multiplyScalar(1 / 3); center[axis] = plane;
        // Earcut may discard collinear boundary vertices. Restore them on each
        // triangle edge so caps meet the clipped shell without T-junctions.
        for (const [u, v] of [[a, b], [b, c], [c, a]]) {
          const chain = along(u, v);
          for (let j = 1; j < chain.length; j++) {
            const first = chain[j - 1].point, second = chain[j].point;
            const facing = first.clone().sub(center).cross(second.clone().sub(center))[axis];
            if (facing * (side === 0 ? 1 : -1) > 0) push(halves[side], center, first, second);
            else push(halves[side], center, second, first);
          }
        }
      }
      const expectedArea = Math.abs(THREE.ShapeUtils.area(projected[i])) - holeIds.reduce((sum, j) => sum + Math.abs(THREE.ShapeUtils.area(projected[j])), 0);
      if (Math.abs(capArea - expectedArea) > Math.max(epsilon ** 2 * 20, expectedArea * 1e-5)) return null;
    }
  }
  const volumes = halves.map(signedVolume);
  if (volumes.some(v => v <= originalVolume * 1e-6) || Math.abs(volumes[0] + volumes[1] - originalVolume) > originalVolume * 2e-5) return null;
  const pieces = halves.map((triangles, i) => {
    const result = new THREE.BufferGeometry();
    result.setAttribute('position', new THREE.Float32BufferAttribute(triangles.flatMap(tri => tri.flatMap(p => p.toArray())), 3));
    result.computeVertexNormals(); result.computeBoundingBox(); result.computeBoundingSphere();
    return { geometry: result, volume: volumes[i] };
  }) as [DebrisGeometryPiece, DebrisGeometryPiece];
  for (const piece of pieces) {
    const array = piece.geometry.getAttribute('position'), edges = new Map<string, number>(), points = new Map<string, THREE.Vector3>();
    for (let i = 0; i < array.count; i += 3) {
      const tri = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(array, i + j));
      for (let j = 0; j < 3; j++) { points.set(key(tri[j]), tri[j]); countEdge(edges, key(tri[j]), key(tri[(j + 1) % 3])); }
    }
    if (!closedEdges(edges, points)) { for (const p of pieces) p.geometry.dispose(); return null; }
  }
  return { pieces, originalVolume };
}
