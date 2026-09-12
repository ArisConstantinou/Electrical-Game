/** Fixed-edge marching tetrahedra. Changing occupancy changes topology, never bends retained material. */
export interface MeshData { positions: Float32Array; normals: Float32Array; colors: Float32Array }
export interface MasonryMeshJob {
  key: string; x0: number; x1: number; y0: number; y1: number; nx: number; ny: number; nz: number;
  xCoordinates: Float32Array; yCoordinates: Float32Array; zCoordinates: Float32Array;
  materials: Uint8Array; exposed: Uint8Array; nodeColors: Float32Array;
}
export function buildMeshJob(job: MasonryMeshJob): MeshData {
  const sx = job.x1 - job.x0 + 1, sz = job.nz + 2;
  const at = (x: number, y: number, z: number): number => ((y - job.y0) * sx + x - job.x0) * sz + z;
  return meshVolume({
    nx: job.nx, ny: job.ny, nz: job.nz,
    nodePosition: (x, y, z) => ({ x: job.xCoordinates[x - job.x0], y: job.yCoordinates[y - job.y0], z: job.zCoordinates[z] }),
    nodeMaterial: (x, y, z) => job.materials[at(x, y, z)],
    nodeAirExposed: (x, y, z) => job.exposed[at(x, y, z)] !== 0,
    materialColor: (_material, x, y, z) => { const i = at(x, y, z) * 3; return [job.nodeColors[i], job.nodeColors[i + 1], job.nodeColors[i + 2]]; },
  }, job.x0, job.x1, job.y0, job.y1);
}
export interface MeshSource {
  nx: number; ny: number; nz: number;
  nodePosition(x: number, y: number, z: number): { x: number; y: number; z: number };
  nodeMaterial(x: number, y: number, z: number): number;
  nodeAirExposed?(x: number, y: number, z: number): boolean;
  materialColor(material: number, x: number, y: number, z: number): readonly number[];
}
export const CORNERS = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
export const TETRA = [[0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6]];
type Point = { x: number; y: number; z: number };
interface CutVertex { point: Point; before: number; after: number }
type Polyhedron = CutVertex[][];
function clipPolyhedron(faces: Polyhedron, distance: (vertex: CutVertex) => number): Polyhedron {
  let hasInside = false, hasOutside = false;
  for (const face of faces) for (const vertex of face) { const d = distance(vertex); if (d > 1e-12) hasInside = true; if (d < -1e-12) hasOutside = true; }
  if (!hasOutside) return faces;
  if (!hasInside) return [];
  const output: Polyhedron = [], intersections: CutVertex[] = [];
  for (const face of faces) {
    const polygon: CutVertex[] = [];
    for (let i = 0; i < face.length; i++) {
      const a = face[i], b = face[(i + 1) % face.length], da = distance(a), db = distance(b);
      if (da >= -1e-12) polygon.push(a);
      if ((da > 1e-12 && db < -1e-12) || (da < -1e-12 && db > 1e-12)) {
        const t = da / (da - db);
        const v: CutVertex = { point: { x: a.point.x + (b.point.x - a.point.x) * t, y: a.point.y + (b.point.y - a.point.y) * t, z: a.point.z + (b.point.z - a.point.z) * t }, before: a.before + (b.before - a.before) * t, after: a.after + (b.after - a.after) * t };
        polygon.push(v);
        if (!intersections.some(c => Math.abs(c.point.x - v.point.x) + Math.abs(c.point.y - v.point.y) + Math.abs(c.point.z - v.point.z) < 1e-10)) intersections.push(v);
      } else if (Math.abs(da) <= 1e-12 && !intersections.some(c => c === a)) intersections.push(a);
    }
    if (polygon.length >= 3) output.push(polygon);
  }
  if (intersections.length >= 3) {
    const center = { x: 0, y: 0, z: 0 };
    for (const v of intersections) { center.x += v.point.x / intersections.length; center.y += v.point.y / intersections.length; center.z += v.point.z / intersections.length; }
    const first = intersections[0].point, u = { x: first.x - center.x, y: first.y - center.y, z: first.z - center.z };
    let normal = { x: 0, y: 0, z: 0 };
    for (let i = 1; i < intersections.length; i++) {
      const v = intersections[i].point, d = { x: v.x - center.x, y: v.y - center.y, z: v.z - center.z };
      normal = { x: u.y * d.z - u.z * d.y, y: u.z * d.x - u.x * d.z, z: u.x * d.y - u.y * d.x };
      if (Math.hypot(normal.x, normal.y, normal.z) > 1e-12) break;
    }
    const nLength = Math.hypot(normal.x, normal.y, normal.z);
    if (nLength > 1e-12) {
      normal.x /= nLength; normal.y /= nLength; normal.z /= nLength;
      const v = { x: normal.y * u.z - normal.z * u.y, y: normal.z * u.x - normal.x * u.z, z: normal.x * u.y - normal.y * u.x };
      const angle = (p: CutVertex): number => Math.atan2((p.point.x - center.x) * v.x + (p.point.y - center.y) * v.y + (p.point.z - center.z) * v.z, (p.point.x - center.x) * u.x + (p.point.y - center.y) * u.y + (p.point.z - center.z) * u.z);
      intersections.sort((a, b) => angle(a) - angle(b)); output.push(intersections);
    }
  }
  return output;
}
/** Exact intersection of a tetra with the before-solid and optional after-air halfspaces. */
export function clippedTetra(points: Point[], before: number[], after?: number[], box?: { min: Point; max: Point }): { faces: Point[][]; volume: number } {
  const vertices = points.map((point, i) => ({ point, before: before[i], after: after?.[i] ?? 0 }));
  let faces = [[vertices[0], vertices[1], vertices[2]], [vertices[0], vertices[3], vertices[1]], [vertices[0], vertices[2], vertices[3]], [vertices[1], vertices[3], vertices[2]]];
  faces = clipPolyhedron(faces, v => v.before - .5);
  if (after && faces.length) faces = clipPolyhedron(faces, v => .5 - v.after);
  if (box) for (const axis of ['x', 'y', 'z'] as const) {
    if (!faces.length) break;
    faces = clipPolyhedron(faces, v => v.point[axis] - box.min[axis]);
    faces = clipPolyhedron(faces, v => box.max[axis] - v.point[axis]);
  }
  if (!faces.length) return { faces: [], volume: 0 };
  const all = faces.flat(), center = { x: 0, y: 0, z: 0 };
  for (const v of all) { center.x += v.point.x / all.length; center.y += v.point.y / all.length; center.z += v.point.z / all.length; }
  let volume = 0;
  for (const face of faces) for (let i = 1; i < face.length - 1; i++) {
    const a = face[0].point, b = face[i].point, c = face[i + 1].point;
    const ax = a.x - center.x, ay = a.y - center.y, az = a.z - center.z;
    const bx = b.x - center.x, by = b.y - center.y, bz = b.z - center.z;
    const cx = c.x - center.x, cy = c.y - center.y, cz = c.z - center.z;
    volume += Math.abs(ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
  }
  return { faces: faces.map(face => face.map(v => v.point)), volume };
}
export class MeshBuilder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly colors: number[] = [];
  triangle(a: Point, b: Point, c: Point, color: readonly number[], outward?: Point): void {
    let nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
    let ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    let nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (outward && nx * outward.x + ny * outward.y + nz * outward.z < 0) {
      const swap = b; b = c; c = swap; nx = -nx; ny = -ny; nz = -nz;
    }
    const length = Math.hypot(nx, ny, nz);
    if (length < 1e-14) return;
    nx /= length; ny /= length; nz /= length;
    for (const p of [a, b, c]) {
      this.positions.push(p.x, p.y, p.z);
      this.normals.push(nx, ny, nz);
      this.colors.push(color[0], color[1], color[2]);
    }
  }
  quad(a: Point, b: Point, c: Point, d: Point, color: readonly number[], outward?: Point): void {
    this.triangle(a, b, c, color, outward); this.triangle(a, c, d, color, outward);
  }
  finish(): MeshData {
    return { positions: new Float32Array(this.positions), normals: new Float32Array(this.normals), colors: new Float32Array(this.colors) };
  }
}

export function meshVolume(source: MeshSource, x0: number, x1: number, y0: number, y1: number,
  occupied?: (x: number, y: number, z: number) => number): MeshData {
  const mesh = new MeshBuilder();
  const sample = occupied ?? ((x: number, y: number, z: number) => source.nodeMaterial(x, y, z));
  const sx = x1 - x0 + 1, sy = y1 - y0 + 1, sz = source.nz + 2;
  const cached = new Uint8Array(sx * sy * sz), visible = new Uint8Array(cached.length);
  const at = (x: number, y: number, z: number): number => ((y - y0) * sx + x - x0) * sz + z;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let z = 0; z < sz; z++) {
    const i = at(x, y, z), material = sample(x, y, z); cached[i] = material;
    if (!material && (occupied !== undefined || !source.nodeAirExposed || source.nodeAirExposed(x, y, z))) visible[i] = 1;
  }
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) for (let z = 0; z <= source.nz; z++) {
    const indices = CORNERS.map(c => at(x + c[0], y + c[1], z + c[2]));
    const materials = indices.map(i => cached[i]);
    let count = 0;
    for (const m of materials) if (m !== 0) count++;
    if (count === 0 || count === 8) continue;
    const exposed = indices.map(i => visible[i] !== 0);
    if (!exposed.some(Boolean)) continue;
    const points = CORNERS.map(c => source.nodePosition(x + c[0], y + c[1], z + c[2]));
    // Four occupied coplanar corners define an exact plane. Preserve it with two triangles,
    // instead of the eight coplanar triangles produced by six tetrahedra.
    const planes = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 3, 7, 4], [1, 2, 6, 5], [0, 1, 5, 4], [3, 2, 6, 7]];
    let planar = false;
    if (count === 4) for (const face of planes) {
      if (!face.every(i => materials[i] !== 0)) continue;
      const other = CORNERS.map((_, i) => i).filter(i => !face.includes(i));
      if (!other.every(i => materials[i] === 0 && exposed[i])) continue;
      const solid = face[0], color = source.materialColor(materials[solid], x + CORNERS[solid][0], y + CORNERS[solid][1], z + CORNERS[solid][2]);
      const mids = face.map(i => {
        const j = other.find(k => CORNERS[i].reduce((sum, v, axis) => sum + Math.abs(v - CORNERS[k][axis]), 0) === 1)!;
        return { x: (points[i].x + points[j].x) * .5, y: (points[i].y + points[j].y) * .5, z: (points[i].z + points[j].z) * .5 };
      });
      const outward = { x: points[other[0]].x - points[solid].x, y: points[other[0]].y - points[solid].y, z: points[other[0]].z - points[solid].z };
      mesh.quad(mids[0], mids[1], mids[2], mids[3], color, outward); planar = true; break;
    }
    if (planar) continue;
    for (const tetra of TETRA) {
      const inside = tetra.filter(i => materials[i] !== 0);
      if (inside.length === 0 || inside.length === 4) continue;
      const outside = tetra.filter(i => materials[i] === 0);
      if (!outside.some(i => exposed[i])) continue;
      const normal = { x: 0, y: 0, z: 0 };
      for (const i of outside) { normal.x += points[i].x / outside.length; normal.y += points[i].y / outside.length; normal.z += points[i].z / outside.length; }
      for (const i of inside) { normal.x -= points[i].x / inside.length; normal.y -= points[i].y / inside.length; normal.z -= points[i].z / inside.length; }
      const solid = inside[0];
      const corner = CORNERS[solid];
      const color = source.materialColor(materials[solid], x + corner[0], y + corner[1], z + corner[2]);
      const mid = (a: number, b: number): Point => ({ x: (points[a].x + points[b].x) * .5, y: (points[a].y + points[b].y) * .5, z: (points[a].z + points[b].z) * .5 });
      if (inside.length === 1) {
        mesh.triangle(mid(inside[0], outside[0]), mid(inside[0], outside[1]), mid(inside[0], outside[2]), color, normal);
      } else if (inside.length === 3) {
        mesh.triangle(mid(outside[0], inside[0]), mid(outside[0], inside[1]), mid(outside[0], inside[2]), color, normal);
      } else {
        const a = mid(inside[0], outside[0]), b = mid(inside[0], outside[1]);
        const c = mid(inside[1], outside[1]), d = mid(inside[1], outside[0]);
        mesh.quad(a, b, c, d, color, normal);
      }
    }
  }
  return mesh.finish();
}
