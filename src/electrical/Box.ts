import * as THREE from 'three';
import { INSTALLATION_RULES, type BoxKind } from '../data/installationRules';

const whitePlastic = new THREE.MeshStandardMaterial({ color: 0xe7e4d9, roughness: 0.78, metalness: 0.02 });
const innerPlastic = new THREE.MeshStandardMaterial({ color: 0xcfcbbf, roughness: 0.84, side: THREE.DoubleSide });

const mesh = (geometry: THREE.BufferGeometry, material = whitePlastic): THREE.Mesh => {
  const result = new THREE.Mesh(geometry, material);
  result.castShadow = true;
  result.receiveShadow = true;
  return result;
};

export class ElectricalBox extends THREE.Group {
  readonly width: number;
  readonly height: number;
  readonly depth: number;

  constructor(readonly kind: BoxKind, stableId: string) {
    super();
    const dimensions = kind === '1G' ? INSTALLATION_RULES.box.oneGang : INSTALLATION_RULES.box.twoGang;
    this.width = dimensions.width;
    this.height = dimensions.height;
    this.depth = dimensions.depth;
    this.name = `${kind} recessed box`;
    this.userData.studioEntityId = stableId;

    const wall = 0.004;
    const rim = 0.006;
    const rimDepth = 0.006;
    const bodyDepth = this.depth - rimDepth;
    const back = mesh(new THREE.BoxGeometry(this.width - wall * 2, this.height - wall * 2, wall), innerPlastic);
    back.position.z = -this.depth + wall / 2;
    back.name = 'Box back wall';
    this.add(back);

    const sideGeometry = new THREE.BoxGeometry(wall, this.height - wall * 2, bodyDepth);
    const topGeometry = new THREE.BoxGeometry(this.width - wall * 2, wall, bodyDepth);
    const left = mesh(sideGeometry, innerPlastic);
    const right = mesh(sideGeometry, innerPlastic);
    left.position.set(-this.width / 2 + wall / 2, 0, -bodyDepth / 2 - rimDepth);
    right.position.set(this.width / 2 - wall / 2, 0, -bodyDepth / 2 - rimDepth);
    const top = mesh(topGeometry, innerPlastic);
    const bottom = mesh(topGeometry, innerPlastic);
    top.position.set(0, this.height / 2 - wall / 2, -bodyDepth / 2 - rimDepth);
    bottom.position.set(0, -this.height / 2 + wall / 2, -bodyDepth / 2 - rimDepth);
    this.add(left, right, top, bottom);

    const horizontalRim = new THREE.BoxGeometry(this.width + rim * 2, rim, rimDepth);
    const verticalRim = new THREE.BoxGeometry(rim, this.height, rimDepth);
    const rimTop = mesh(horizontalRim);
    const rimBottom = mesh(horizontalRim);
    const rimLeft = mesh(verticalRim);
    const rimRight = mesh(verticalRim);
    rimTop.position.set(0, this.height / 2 + rim / 2, rimDepth / 2);
    rimBottom.position.set(0, -this.height / 2 - rim / 2, rimDepth / 2);
    rimLeft.position.set(-this.width / 2 - rim / 2, 0, rimDepth / 2);
    rimRight.position.set(this.width / 2 + rim / 2, 0, rimDepth / 2);
    rimTop.name = rimBottom.name = rimLeft.name = rimRight.name = 'Flush front rim';
    this.add(rimTop, rimBottom, rimLeft, rimRight);

    const knockoutMaterial = new THREE.MeshStandardMaterial({ color: 0xb8b4a9, roughness: 0.88 });
    const knockoutGeometry = new THREE.TorusGeometry(0.009, 0.0015, 6, 16);
    for (const x of this.kind === '2G' ? [-this.width * 0.25, this.width * 0.25] : [0]) {
      const knockout = mesh(knockoutGeometry, knockoutMaterial);
      knockout.position.set(x, -this.height * 0.22, -this.depth + wall + 0.0006);
      knockout.name = '20 mm knockout';
      this.add(knockout);
    }
  }
}
