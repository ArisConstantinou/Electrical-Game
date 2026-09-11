import * as THREE from 'three';
import { INSTALLATION_RULES } from '../data/installationRules';
import type { InstallationPoint } from './InstallationPoint';

export class Conduit extends THREE.Group {
  constructor(point: InstallationPoint) {
    super();
    this.name = `20 mm rigid PVC conduit · Point ${point.definition.id}`;
    this.userData.studioEntityId = `point-${point.definition.id}:rigid-pvc`;
    const radius = INSTALLATION_RULES.conduit.firstMissionDiameter / 2;
    const startY = point.definition.bottom - 0.012;
    const worldX = point.definition.x;
    const wallZ = -2.37;
    const floorZ = -2.18;
    const path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(worldX, startY, wallZ),
      new THREE.Vector3(worldX, Math.max(0.16, startY * 0.58), wallZ),
      new THREE.Vector3(worldX, 0.055, wallZ + 0.025),
      new THREE.Vector3(worldX + (point.definition.id === 'A' ? -0.42 : 0.38), 0.025, floorZ),
      new THREE.Vector3(worldX + (point.definition.id === 'A' ? -0.78 : 0.72), 0.025, floorZ + 0.32),
    ], false, 'centripetal');
    const material = new THREE.MeshStandardMaterial({ color: 0xe8e7dc, roughness: 0.56, metalness: 0.04 });
    const pipe = new THREE.Mesh(new THREE.TubeGeometry(path, 36, radius, 9, false), material);
    pipe.name = 'Visible solid PVC pipe';
    pipe.castShadow = true;
    pipe.receiveShadow = true;
    this.add(pipe);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.35, radius * 1.35, 0.035, 10), material);
    collar.rotation.x = Math.PI / 2;
    collar.position.set(worldX, startY, wallZ + 0.005);
    collar.name = 'Box conduit entry';
    this.add(collar);
  }
}
