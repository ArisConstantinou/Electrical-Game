import * as THREE from 'three';

// Cut faces follow the live wall's four longitudinal bores (two by two).
const clay = new THREE.Color('#aa593b');
const clayShadow = new THREE.Color('#703a2b');
const recess = new THREE.Color('#261a17');
const cement = new THREE.Color('#84796c');
const wetCement = new THREE.Color('#605a52');
export const hollowClayEndMaterial = new THREE.MeshStandardMaterial({ name: 'Rough hollow clay cut and mortar', vertexColors: true, roughness: 1, side: THREE.DoubleSide });

function makeEnd(variant: number, torn = false): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  // Broken outer shell: independent missing corners and small web chips make
  // the exposed section read as fired clay rather than a factory-cut tile.
  const edge = [
    [-.5, -.43 + variant * .015], [-.43 + variant * .025, -.5],
    [-.10, -.5], [-.045, -.465 + variant * .011], [.13, -.5],
    [.43 - variant * .012, -.5], [.5, -.41 + variant * .018],
    [.5, -.12], [.462 - variant * .009, -.05], [.5, .21],
    [.5, .42 - variant * .012], [.40 - variant * .017, .5],
    [.08, .5], [.015, .468 - variant * .012], [-.24, .5],
    [-.43 + variant * .011, .5], [-.5, .40 - variant * .012],
    [-.5, .13], [-.46 + variant * .008, .04], [-.5, -.25],
  ];
  shape.moveTo(edge[0][0], edge[0][1]);
  for (let i = 1; i < edge.length; i++) shape.lineTo(edge[i][0], edge[i][1]);
  shape.closePath();
  const rings: { points: THREE.Vector2[]; cx: number; cy: number }[] = [];
  for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) {
    const cx = col ? .25 : -.25, cy = row ? .25 : -.25;
    const points: THREE.Vector2[] = [], path = new THREE.Path();
    for (let i = 0; i < 12; i++) {
      const angle = -i * Math.PI / 6;
      const cosine = Math.cos(angle), sine = Math.sin(angle);
      const nick = Math.sin(i * 13.1 + row * 9.3 + col * 5.7 + variant * 7.9) * .065;
      const squaredX = Math.sign(cosine) * Math.sqrt(Math.abs(cosine));
      const squaredY = Math.sign(sine) * Math.sqrt(Math.abs(sine));
      const point = new THREE.Vector2(cx + squaredX * .157 * (1 + nick), cy + squaredY * .151 * (1 + nick));
      points.push(point);
      if (i === 0) path.moveTo(point.x, point.y); else path.lineTo(point.x, point.y);
    }
    path.closePath(); shape.holes.push(path); rings.push({ points, cx, cy });
  }
  const positions: number[] = [], colors: number[] = [];
  const triangle = (a: number[], b: number[], c: number[], color: THREE.Color) => {
    positions.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) colors.push(color.r, color.g, color.b);
  };
  const quad = (a: number[], b: number[], c: number[], d: number[], color: THREE.Color) => {
    triangle(a, b, c, color); triangle(a, c, d, color);
  };
  const face = new THREE.ShapeGeometry(shape, 5);
  const front = face.index ? face.toNonIndexed() : face;
  const attribute = front.getAttribute('position');
  for (let i = 0; i < attribute.count; i += 3) triangle(
    [attribute.getX(i), attribute.getY(i), .012],
    [attribute.getX(i + 1), attribute.getY(i + 1), .012],
    [attribute.getX(i + 2), attribute.getY(i + 2), .012], clay);
  front.dispose(); if (front !== face) face.dispose();
  for (const { points, cx, cy } of rings) for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    quad([a.x, a.y, .013], [b.x, b.y, .013], [b.x, b.y, -.026], [a.x, a.y, -.026], clayShadow);
    triangle([cx, cy, -.027], [b.x, b.y, -.027], [a.x, a.y, -.027], recess);
  }
  // Rough mortar remains flush with the end, concentrated along the cut sides.
  for (let side = 0; side < 2; side++) for (let section = 0; section < 8; section++) {
    if ((section + variant * 3 + side * 5) % 5 === 0) continue;
    const y0 = -.5 + section / 8, y1 = y0 + .125;
    const w0 = .075 + ((section * 7 + variant * 5 + side) % 5) * .011;
    const w1 = .065 + ((section * 11 + variant * 3 + side) % 5) * .012;
    const outer = side ? .5 : -.5, inward = side ? -1 : 1;
    quad([outer, y0, .014], [outer + inward * w0, y0, .014],
      [outer + inward * w1, y1, .014], [outer, y1, .014], section % 3 ? cement : wetCement);
  }
  for (let edge = 0; edge < 2; edge++) for (let section = 0; section < 6; section++) {
    if ((section + variant + edge) % 4 === 0) continue;
    const x0 = -.5 + section / 6, x1 = x0 + 1 / 6;
    const width0 = .05 + ((section * 3 + variant + edge) % 4) * .01;
    const width1 = .04 + ((section * 5 + variant + edge) % 4) * .013;
    const outer = edge ? .5 : -.5, inward = edge ? -1 : 1;
    quad([x0, outer, .014], [x1, outer, .014],
      [x1, outer + inward * width1, .014], [x0, outer + inward * width0, .014], section % 2 ? cement : wetCement);
  }
  if (variant > 0) for (let i = 0; i < 3 + variant; i++) {
    const y = -.44 + i * .22, x = ((i * 7 + variant * 3) % 3 - 1) * .24;
    triangle([x - .035, y, .014], [x + .042, y + .013, .014], [x + .008, y + .043, .014], i % 2 ? cement : wetCement);
  }
  if (torn) {
    // The original fired-clay face is shortened behind this cap. Uneven lips
    // extend back into the opening, leaving visible missing bites along BOTH
    // outer faces instead of a straight, untouched brick edge.
    for (const outer of [-.5, .5]) for (let section = 0; section < 6; section++) {
      if ((section * 5 + variant * 3 + (outer > 0 ? 1 : 0)) % 7 === 0) continue;
      const y0 = -.5 + section / 6, y1 = y0 + 1 / 6;
      const tip0 = .010 + ((section * 11 + variant * 7 + (outer > 0 ? 3 : 0)) % 9) * .005;
      const tip1 = .010 + ((section * 7 + variant * 13 + (outer > 0 ? 5 : 0)) % 10) * .005;
      const edgeColor = section % 4 === 0 ? clayShadow : clay;
      quad([outer, y0, 0], [outer, y1, 0], [outer, y1, tip1], [outer, y0, tip0], edgeColor);
      const inward = outer > 0 ? -.038 : .038;
      quad([outer, y0, tip0], [outer, y1, tip1], [outer + inward, y1 - .012, tip1 * .72],
        [outer + inward, y0 + .009, tip0 * .70], clayShadow);
    }
    for (const outer of [-.504, .504]) for (let chip = 0; chip < 3; chip++) {
      const y = -.37 + chip * .34 + variant * .021;
      const inset = .032 + ((chip * 7 + variant * 5 + (outer > 0 ? 2 : 0)) % 5) * .009;
      // Shallow scars reach onto the formerly intact photographed face. Their
      // unequal outlines are tied to the cut, not mirrored across the gap.
      triangle([outer, y - .055, -.003], [outer, y + .061, -inset],
        [outer, y + .018, .012], clayShadow);
      triangle([outer, y - .041, -.008], [outer, y + .039, -inset * .73],
        [outer, y + .002, -.001], clay);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export const hollowClayEndShapes = [makeEnd(0), makeEnd(1), makeEnd(2)];
export const brokenClayEndShapes = [makeEnd(0, true), makeEnd(1, true), makeEnd(2, true)];

export function hollowClayWallEnds(length: number, rows: number, course: number, gap: number, alongX: boolean, wallName: string): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Four-chamber exposed hollow clay block ends';
  const seed = [...wallName].reduce((value, char) => Math.imul(value ^ char.charCodeAt(0), 16777619), 2166136261) >>> 0;
  const batches: { row: number; end: number }[][] = [[], [], []];
  for (let row = 0; row < rows; row++) for (let end = 0; end < 2; end++) {
    const pick = ((Math.imul(row + 1, 2654435761) ^ Math.imul(end + 1, 2246822519) ^ seed) >>> 0) % 7;
    batches[pick < 3 ? 0 : pick < 6 ? 1 : 2].push({ row, end });
  }
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3(.24, course - gap, 1), tint = new THREE.Color();
  for (let variant = 0; variant < batches.length; variant++) {
    if (!batches[variant].length) continue;
    const mesh = new THREE.InstancedMesh(hollowClayEndShapes[variant], hollowClayEndMaterial, batches[variant].length);
    mesh.name = `Cut clay ends with mortar, variant ${variant}`;
    for (const [index, { row, end }] of batches[variant].entries()) {
      const side = end ? 1 : -1;
      position.set(alongX ? side * (length / 2 - gap / 2) : 0, (row + .5) * course,
        alongX ? 0 : side * (length / 2 - gap / 2));
      rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), alongX ? side * Math.PI / 2 : end ? 0 : Math.PI);
      mesh.setMatrixAt(index, matrix.compose(position, rotation, scale));
      const warmth = .88 + ((row * 7 + end * 3 + seed) % 11) * .016;
      mesh.setColorAt(index, tint.setRGB(warmth, warmth * .98, warmth * .96));
    }
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.computeBoundingSphere(); group.add(mesh);
  }
  return group;
}
