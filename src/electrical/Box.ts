import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { INSTALLATION_RULES, type BoxKind } from '../data/installationRules';

const whitePlastic = new THREE.MeshStandardMaterial({ color: 0xe7e4d9, roughness: 0.78, metalness: 0.02 });
const innerPlastic = new THREE.MeshStandardMaterial({ color: 0xcfcbbf, roughness: 0.84, side: THREE.DoubleSide });
whitePlastic.userData.referenceLaserReceiver=true;
innerPlastic.userData.referenceLaserReceiver=true;

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
    const entryXs = this.kind === '2G' ? [-this.width * .25, this.width * .25] : [0];
    const backShape = new THREE.Shape();
    const backHalfWidth = this.width / 2 - wall, backHalfHeight = this.height / 2 - wall;
    backShape.moveTo(-backHalfWidth, -backHalfHeight);
    backShape.lineTo(backHalfWidth, -backHalfHeight);
    backShape.lineTo(backHalfWidth, backHalfHeight);
    backShape.lineTo(-backHalfWidth, backHalfHeight);
    backShape.closePath();
    for (const x of entryXs) {
      const opening = new THREE.Path();
      opening.absarc(x, -this.height * .22, .0075, 0, Math.PI * 2, true);
      backShape.holes.push(opening);
    }
    const backGeometry = new THREE.ExtrudeGeometry(backShape, { depth: wall, bevelEnabled: false, curveSegments: 20 });
    backGeometry.translate(0, 0, -wall / 2);
    backGeometry.clearGroups();
    backGeometry.addGroup(0, backGeometry.getAttribute('position').count, 0);
    const back = mesh(backGeometry, innerPlastic);
    back.position.z = -this.depth + wall / 2;
    back.name = 'Moulded box back with open cable entries';
    back.userData.cableEntryCount = entryXs.length;
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

    const horizontalRim = new RoundedBoxGeometry(this.width + rim * 2, rim, rimDepth, 2, .001);
    const verticalRim = new RoundedBoxGeometry(rim, this.height, rimDepth, 2, .001);
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
    for (const x of entryXs) {
      const knockout = mesh(knockoutGeometry, knockoutMaterial);
      knockout.position.set(x, -this.height * 0.22, -this.depth + wall + 0.0006);
      knockout.name = '20 mm knockout';
      this.add(knockout);
    }

    // The shallow moulding is kept inside the established fitting envelope.
    // None of these non-interactive surfaces changes placement, level or reach.
    const moulded: THREE.BufferGeometry[] = [];
    const recessed: THREE.BufferGeometry[] = [];
    const hardware: THREE.BufferGeometry[] = [];
    const detail = (parts: THREE.BufferGeometry[], geometry: THREE.BufferGeometry,
      x: number, y: number, z: number, rotation = new THREE.Euler()): void => {
      geometry.applyMatrix4(new THREE.Matrix4().compose(
        new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(rotation),
        new THREE.Vector3(1, 1, 1)));
      parts.push(geometry);
    };
    const screwX = this.width / 2 - .009;
    for (const side of [-1, 1]) {
      const x = side * screwX;
      detail(moulded, new THREE.CylinderGeometry(.0051, .0063, .016, 14), x, 0, -.013,
        new THREE.Euler(Math.PI / 2, 0, 0));
      detail(moulded, new THREE.BoxGeometry(.008, .008, .019), side * (this.width / 2 - .006), 0, -.015);
      detail(hardware, new THREE.CylinderGeometry(.0031, .0031, .0014, 16), x, 0, -.0041,
        new THREE.Euler(Math.PI / 2, 0, 0));
      detail(recessed, new THREE.BoxGeometry(.0034, .00055, .0004), x, 0, -.00325);
      detail(recessed, new THREE.BoxGeometry(.00055, .0034, .0004), x, 0, -.00325);
      for (const y of [-.021, .021]) {
        detail(moulded, new THREE.BoxGeometry(.002, .008, .016),
          side * (this.width / 2 - .0046), y, -.019);
        detail(recessed, new THREE.TorusGeometry(.0064, .00075, 5, 16),
          side * (this.width / 2 - wall - .0004), y, -.021,
          new THREE.Euler(0, Math.PI / 2, 0));
      }
    }
    for (const y of [-1, 1]) {
      detail(moulded, new THREE.BoxGeometry(this.width - .019, .0021, .0033),
        0, y * (this.height / 2 - .008), -.018);
      for (const x of this.kind === '2G' ? [-this.width * .24, this.width * .24] : [0])
        detail(recessed, new THREE.TorusGeometry(.008, .0007, 5, 20),
          x, y * .020, -this.depth + wall + .0007);
    }
    if (this.kind === '2G') {
      detail(moulded, new THREE.BoxGeometry(.003, this.height - .020, .012), 0, 0, -this.depth + .010);
      for (const y of [-.021, .021])
        detail(moulded, new THREE.BoxGeometry(.010, .003, .016), 0, y, -.020);
    }
    const darkDetail = new THREE.MeshStandardMaterial({ color: 0xa6a399, roughness: .94 });
    const screwSteel = new THREE.MeshStandardMaterial({ color: 0x888b89, metalness: .56, roughness: .48 });
    for (const [name, parts, material] of [
      ['Moulded electrical box bosses and ribs', moulded, innerPlastic],
      ['Recessed electrical box entry rings and screw slots', recessed, darkDetail],
      ['Electrical box fitting screws', hardware, screwSteel],
    ] as const) {
      const geometry = mergeGeometries(parts, false);
      parts.forEach(part => part.dispose());
      if (!geometry) throw new Error(`Cannot merge ${name}`);
      const fitted = mesh(geometry, material);
      fitted.name = name;
      fitted.userData.visualBoxDetail = true;
      fitted.userData.levelEditorPickThrough = true;
      fitted.raycast = () => undefined;
      fitted.castShadow = false;
      this.add(fitted);
    }
  }
}
