import * as THREE from 'three';

/** Local-space circular wall segment. The UV distance stays continuous across editable sections. */
export type CurvedWallShape = {
  center: [number, number];
  radius: number;
  startAngle: number;
  sweep: number;
  uvStart: number;
  capStart?: boolean;
  capEnd?: boolean;
};

export function curvedWallGeometry(shape: CurvedWallShape, height = 3, thickness = .24): THREE.BufferGeometry {
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [];
  type Vertex = { point: THREE.Vector3; normal: THREE.Vector3; uv: [number, number] };
  const vertex = (point: THREE.Vector3, normal: THREE.Vector3, u: number, v: number): Vertex => ({ point, normal, uv: [u, v] });
  const triangle = (a: Vertex, b: Vertex, c: Vertex): void => {
    for (const item of [a, b, c]) {
      positions.push(item.point.x, item.point.y, item.point.z);
      normals.push(item.normal.x, item.normal.y, item.normal.z);
      uvs.push(item.uv[0], item.uv[1]);
    }
  };
  const quad = (a: Vertex, b: Vertex, c: Vertex, d: Vertex): void => { triangle(a, b, c); triangle(a, c, d); };
  const point = (angle: number, distance: number, y: number): THREE.Vector3 =>
    new THREE.Vector3(shape.center[0] + Math.cos(angle) * distance, y, shape.center[1] + Math.sin(angle) * distance);
  const radial = (angle: number, sign = 1): THREE.Vector3 =>
    new THREE.Vector3(Math.cos(angle) * sign, 0, Math.sin(angle) * sign);
  const up = new THREE.Vector3(0, 1, 0), down = new THREE.Vector3(0, -1, 0);
  const inner = Math.max(.02, shape.radius - thickness / 2), outer = shape.radius + thickness / 2;
  const count = Math.max(3, Math.ceil(Math.abs(shape.sweep) / .035));
  for (let index = 0; index < count; index++) {
    const t0 = index / count, t1 = (index + 1) / count;
    const a0 = shape.startAngle + shape.sweep * t0, a1 = shape.startAngle + shape.sweep * t1;
    const u0 = (shape.uvStart + Math.abs(shape.sweep) * shape.radius * t0) / 2;
    const u1 = (shape.uvStart + Math.abs(shape.sweep) * shape.radius * t1) / 2;
    quad(vertex(point(a0, inner, height), up, u0, 0), vertex(point(a1, inner, height), up, u1, 0),
      vertex(point(a1, outer, height), up, u1, .12), vertex(point(a0, outer, height), up, u0, .12));
    quad(vertex(point(a0, inner, 0), down, u0, 0), vertex(point(a0, outer, 0), down, u0, .12),
      vertex(point(a1, outer, 0), down, u1, .12), vertex(point(a1, inner, 0), down, u1, 0));
    quad(vertex(point(a0, outer, 0), radial(a0), u0, 0), vertex(point(a1, outer, 0), radial(a1), u1, 0),
      vertex(point(a1, outer, height), radial(a1), u1, 1.5), vertex(point(a0, outer, height), radial(a0), u0, 1.5));
    quad(vertex(point(a0, inner, 0), radial(a0, -1), u0, 0), vertex(point(a0, inner, height), radial(a0, -1), u0, 1.5),
      vertex(point(a1, inner, height), radial(a1, -1), u1, 1.5), vertex(point(a1, inner, 0), radial(a1, -1), u1, 0));
  }
  const caps: [number, number][] = [];
  if (shape.capStart) caps.push([shape.startAngle, -1]);
  if (shape.capEnd) caps.push([shape.startAngle + shape.sweep, 1]);
  for (const [angle, sign] of caps) {
    const normal = new THREE.Vector3(-Math.sin(angle) * sign, 0, Math.cos(angle) * sign);
    quad(vertex(point(angle, inner, 0), normal, 0, 0), vertex(point(angle, outer, 0), normal, .12, 0),
      vertex(point(angle, outer, height), normal, .12, 1.5), vertex(point(angle, inner, height), normal, 0, 1.5));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
