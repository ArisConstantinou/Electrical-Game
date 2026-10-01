import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import type { SprayMode } from '../world/BrickWall';
import { sprayGeometryPieces } from './SprayGeometry';

export interface SpraySurface {
  object: THREE.Object3D;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  instanceId?: number;
}

interface PaintBatch {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  count: number;
  capacity: number;
}

export function sprayVisible(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent)
    if (!node.visible || node.userData.levelEditorDeleted) return false;
  return Boolean(object.parent);
}

/** Project onto actual surface triangles, including instanced geometry. Each surface
 * shares one growing geometry buffer, rather than creating a draw call per dab. */
export class SurfaceSpray {
  private readonly batches = new WeakMap<THREE.Object3D, PaintBatch>();
  private readonly proxy = new THREE.Mesh();
  private readonly instance = new THREE.Matrix4();
  private readonly world = new THREE.Matrix4();
  private readonly bounds = new THREE.Box3();
  private readonly colour = new THREE.Color();
  private brush: THREE.CanvasTexture | null = null;
  private previous: { surface: SpraySurface; colour: number; coats: number; moving: boolean } | null = null;
  count = 0;
  materialRevision = 0;

  endStroke(): void {
    const previous = this.previous;
    this.previous = null;
    // Round only the final tip. Repeated full circles inside a continuous
    // stroke would leave visible rims at every input sample.
    if (previous?.moving) this.spray(previous.surface, 'live', previous.colour);
    this.previous = null;
  }

  spray(surface: SpraySurface, mode: SprayMode, colour: number): boolean {
    const previous = this.previous;
    const continuous = mode === 'live' && previous?.surface.object === surface.object &&
      previous.surface.instanceId === surface.instanceId &&
      previous.colour === colour && previous.surface.normal.dot(surface.normal) > .5 &&
      previous.surface.point.distanceTo(surface.point) < .5;
    if (!continuous && previous?.moving) this.endStroke();
    const stationary = previous?.surface.object === surface.object && previous.colour === colour &&
      previous.surface.instanceId === surface.instanceId &&
      previous.surface.point.distanceToSquared(surface.point) < 1e-8;
    // Six coats have already saturated the same tiny patch. Holding still
    // must not keep allocating overlapping triangles for minutes at a time.
    if (continuous && stationary && (previous.coats >= 6 || previous.moving)) { this.count++; return true; }
    const start = continuous ? previous.surface.point : surface.point;
    const centre = start.clone().add(surface.point).multiplyScalar(.5);
    const tangent = surface.point.clone().sub(start);
    tangent.addScaledVector(surface.normal, -tangent.dot(surface.normal));
    const length = tangent.length();
    if (length < .0001) tangent.crossVectors(
      new THREE.Vector3(Math.abs(surface.normal.y) > .9 ? 1 : 0, Math.abs(surface.normal.y) > .9 ? 0 : 1, 0), surface.normal);
    tangent.normalize();
    const up = surface.normal.clone().cross(tangent).normalize();
    const orientation = new THREE.Euler().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(tangent, up, surface.normal));
    const width = mode === 'dots' ? .035 : .025;
    const size = new THREE.Vector3(length + width, width, .04);
    const radius = size.length() / 2;
    const positions: number[] = [], uvs: number[] = [];
    surface.object.updateWorldMatrix(true, true);
    const inverse = surface.object.matrixWorld.clone().invert();
    const local = new THREE.Vector3();
    const project = (mesh: THREE.Mesh, world: THREE.Matrix4): void => {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (!materials.some(material => material.visible)) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      this.bounds.copy(mesh.geometry.boundingBox!).applyMatrix4(world);
      if (this.bounds.distanceToPoint(centre) > radius) return;
      this.proxy.matrixWorld.copy(world);
      const stamp = (at: THREE.Vector3, dimensions: THREE.Vector3, strip: boolean): void => {
        for (const geometry of sprayGeometryPieces(mesh.geometry)) {
          if (!materials[Array.isArray(mesh.material) ? geometry.groups[0]?.materialIndex ?? 0 : 0]?.visible) continue;
          this.bounds.copy(geometry.boundingBox!).applyMatrix4(world);
          if (this.bounds.distanceToPoint(centre) > radius) continue;
          this.proxy.geometry = geometry;
          const decal = new DecalGeometry(this.proxy, at, orientation, dimensions);
          const p = decal.getAttribute('position'), uv = decal.getAttribute('uv');
          for (let i = 0; i < p.count; i++) {
            local.fromBufferAttribute(p, i).applyMatrix4(inverse);
            positions.push(local.x, local.y, local.z);
            // Left atlas half is the round brush; right half is constant along
            // a strip, so long movements never stretch it into tapered ovals.
            uvs.push(strip ? .75 : uv.getX(i) * .5, uv.getY(i));
          }
          decal.dispose();
        }
      };
      if (continuous && length > .0001) {
        stamp(centre, new THREE.Vector3(length, width, size.z), true);
      } else stamp(surface.point, new THREE.Vector3(width, width, size.z), false);
    };
    surface.object.traverse(object => {
      if (!(object instanceof THREE.Mesh) || object.userData.sprayPaint ||
          object.userData.levelEditorPickProxy || !sprayVisible(object)) return;
      if (object instanceof THREE.InstancedMesh) {
        const first = object === surface.object && surface.instanceId !== undefined ? surface.instanceId : 0;
        const end = object === surface.object && surface.instanceId !== undefined ? first + 1 : object.count;
        for (let i = first; i < end; i++) {
          object.getMatrixAt(i, this.instance);
          if (Math.abs(this.instance.determinant()) < 1e-9) continue;
          project(object, this.world.multiplyMatrices(object.matrixWorld, this.instance));
        }
      } else project(object, object.matrixWorld);
    });
    if (!positions.length) { this.endStroke(); return false; }
    let batch = this.batches.get(surface.object);
    if (!batch) {
      const material = new THREE.MeshBasicMaterial({ map: this.brushTexture(), vertexColors: true,
        transparent: true, opacity: 1, depthWrite: false, polygonOffset: true,
        polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
      mesh.name = 'Player spray marks';
      mesh.userData.sprayPaint = true;
      mesh.raycast = () => {};
      mesh.frustumCulled = false;
      surface.object.add(mesh);
      batch = { mesh, count: 0, capacity: 0 };
      this.batches.set(surface.object, batch);
      this.materialRevision++;
    }
    const geometry = batch.mesh.geometry, added = positions.length / 3;
    if (batch.count + added > batch.capacity) {
      batch.capacity = Math.max(2048, 2 ** Math.ceil(Math.log2(batch.count + added)));
      // Release replaced GPU buffers when a long stroke outgrows the batch.
      geometry.dispose();
      for (const [name, size] of [['position', 3], ['uv', 2], ['color', 3]] as const) {
        const old = geometry.getAttribute(name);
        const array = new Float32Array(batch.capacity * size);
        if (old) array.set(old.array);
        geometry.setAttribute(name, new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage));
      }
    }
    this.colour.setHex(colour);
    const colours = new Float32Array(added * 3);
    for (let i = 0; i < colours.length; i += 3) this.colour.toArray(colours, i);
    for (const [name, values, size] of [['position', positions, 3], ['uv', uvs, 2], ['color', colours, 3]] as const) {
      const attribute = geometry.getAttribute(name) as THREE.BufferAttribute;
      (attribute.array as Float32Array).set(values, batch.count * size);
      attribute.addUpdateRange(batch.count * size, values.length);
      attribute.needsUpdate = true;
    }
    batch.count += added;
    geometry.setDrawRange(0, batch.count);
    this.previous = mode === 'live' ? { surface, colour, coats: stationary ? previous.coats + 1 : 1,
      moving: Boolean(continuous && length > .0001) } : null;
    this.count++;
    return true;
  }

  private brushTexture(): THREE.CanvasTexture {
    if (this.brush) return this.brush;
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 64;
    const context = canvas.getContext('2d')!;
    const gradient = context.createRadialGradient(32, 32, 21, 32, 32, 32);
    gradient.addColorStop(0, 'white'); gradient.addColorStop(1, 'transparent');
    context.fillStyle = gradient; context.fillRect(0, 0, 64, 64);
    const strip = context.createLinearGradient(0, 0, 0, 64);
    strip.addColorStop(0, 'transparent'); strip.addColorStop(11 / 64, 'white');
    strip.addColorStop(53 / 64, 'white'); strip.addColorStop(1, 'transparent');
    context.fillStyle = strip; context.fillRect(64, 0, 64, 64);
    this.brush = new THREE.CanvasTexture(canvas);
    this.brush.colorSpace = THREE.SRGBColorSpace;
    return this.brush;
  }
}
