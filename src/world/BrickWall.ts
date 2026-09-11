import * as THREE from 'three';
import { GAME_CONFIG } from '../data/gameConfig';
import type { InstallationDefinition } from '../data/installationRules';

interface RemovableBrick {
  mesh: THREE.Mesh;
  marker: THREE.Group;
}

const brickGeometry = new THREE.BoxGeometry(0.286, 0.125, 0.18);
const brickMaterial = new THREE.MeshStandardMaterial({ color: 0xb84b2a, roughness: 0.96, metalness: 0, vertexColors: false });
const removableMaterial = new THREE.MeshStandardMaterial({ color: 0xb94d2b, roughness: 0.97, metalness: 0 });

export class BrickWall extends THREE.Group {
  private readonly removableByPoint = new Map<string, RemovableBrick[]>();

  constructor(definitions: InstallationDefinition[]) {
    super();
    this.name = 'Unplastered hollow clay brick wall';
    this.userData.studioEntityId = 'world:brick-wall';
    const cols = 21;
    const rows = 23;
    const brickW = GAME_CONFIG.room.width / cols;
    const brickH = GAME_CONFIG.room.height / rows;
    const fixedTransforms: THREE.Matrix4[] = [];

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const stagger = row % 2 === 0 ? 0 : brickW / 2;
        const x = -GAME_CONFIG.room.width / 2 + brickW / 2 + col * brickW + stagger;
        if (x > GAME_CONFIG.room.width / 2 - 0.02) continue;
        const y = brickH / 2 + row * brickH;
        const owner = definitions.find(definition => this.inChaseZone(definition, x, y, brickW, brickH));
        const position = new THREE.Vector3(x + Math.sin(row * 4.7 + col) * 0.004, y, -2.5 + Math.sin(col * 2.1 + row) * 0.006);
        const scale = new THREE.Vector3(brickW / 0.286 * 0.985, brickH / 0.125 * 0.965, 1);
        const matrix = new THREE.Matrix4().compose(position, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.sin(col * 1.9 + row) * 0.007)), scale);
        if (!owner) {
          fixedTransforms.push(matrix);
          continue;
        }
        const brick = new THREE.Mesh(brickGeometry, removableMaterial.clone());
        brick.applyMatrix4(matrix);
        brick.castShadow = true;
        brick.receiveShadow = true;
        brick.name = `Removable brick section ${owner.id}`;
        brick.userData.studioEntityId = `point-${owner.id}:removable-brick-${row}-${col}`;
        const marker = this.createMarker(owner.id);
        marker.visible = false;
        brick.add(marker);
        const list = this.removableByPoint.get(owner.id) ?? [];
        list.push({ mesh: brick, marker });
        this.removableByPoint.set(owner.id, list);
        this.add(brick);
      }
    }

    const fixed = new THREE.InstancedMesh(brickGeometry, brickMaterial, fixedTransforms.length);
    fixed.name = 'Optimized permanent brick field';
    fixed.userData.studioEntityId = 'world:brick-wall:permanent-field';
    fixed.castShadow = true;
    fixed.receiveShadow = true;
    fixedTransforms.forEach((matrix, index) => { fixed.setMatrixAt(index, matrix); });
    fixed.instanceMatrix.needsUpdate = true;
    this.add(fixed);
  }

  showMarks(pointId: string): void {
    this.removableByPoint.get(pointId)?.forEach(item => { item.marker.visible = true; });
  }

  removeFraction(pointId: string, fraction: number): THREE.Vector3[] {
    const bricks = this.removableByPoint.get(pointId) ?? [];
    const target = Math.ceil(bricks.length * THREE.MathUtils.clamp(fraction, 0, 1));
    const debris: THREE.Vector3[] = [];
    bricks.forEach((item, index) => {
      if (index < target && item.mesh.visible) {
        item.mesh.getWorldPosition(new THREE.Vector3());
        const position = new THREE.Vector3();
        item.mesh.getWorldPosition(position);
        debris.push(position);
        item.mesh.visible = false;
      }
    });
    return debris;
  }

  remaining(pointId: string): number {
    return (this.removableByPoint.get(pointId) ?? []).filter(item => item.mesh.visible).length;
  }

  private inChaseZone(definition: InstallationDefinition, x: number, y: number, brickW: number, brickH: number): boolean {
    const boxWidth = definition.boxes.reduce((sum, kind) => sum + (kind === '1G' ? 0.074 : 0.134), 0) + (definition.boxes.length - 1) * 0.008;
    const centerY = definition.bottom + 0.037;
    const opening = Math.abs(x - definition.x) < (boxWidth + 0.18) / 2 + brickW / 2
      && Math.abs(y - centerY) < 0.13 + brickH / 2;
    const route = Math.abs(x - definition.x) < 0.12 + brickW / 2 && y < definition.bottom + 0.06;
    return opening || route;
  }

  private createMarker(pointId: string): THREE.Group {
    const group = new THREE.Group();
    group.name = `Blue construction mark ${pointId}`;
    const material = new THREE.MeshBasicMaterial({ color: 0x1687d0, depthTest: true });
    const geometry = new THREE.BoxGeometry(0.14, 0.014, 0.004);
    const a = new THREE.Mesh(geometry, material);
    const b = new THREE.Mesh(geometry, material);
    a.rotation.z = Math.PI / 4;
    b.rotation.z = -Math.PI / 4;
    a.position.z = b.position.z = 0.094;
    group.add(a, b);
    return group;
  }
}
