import * as THREE from 'three';
import { GAME_CONFIG } from '../data/gameConfig';
import type { InstallationDefinition, InstallationStage, PipeStep } from '../data/installationRules';
import { BoxGroup } from './BoxGroup';

export class InstallationPoint extends THREE.Group {
  stage: InstallationStage = 'inspect';
  pipeStep: PipeStep = 'measure';
  chaseHits = 0;
  readonly boxGroup: BoxGroup;
  readonly hotspot: THREE.Mesh;
  mortar: THREE.Mesh | null = null;
  conduit: THREE.Group | null = null;

  constructor(readonly definition: InstallationDefinition) {
    super();
    this.name = definition.label;
    this.userData.studioEntityId = `installation-point-${definition.id}`;
    this.position.set(definition.x, definition.bottom + 0.037, GAME_CONFIG.room.wallFrontZ);

    this.boxGroup = new BoxGroup(definition.boxes, `point-${definition.id}:box-group`);
    this.boxGroup.visible = false;
    this.add(this.boxGroup);

    const hotspotMaterial = new THREE.MeshBasicMaterial({ color: 0x4bb4e6, transparent: true, opacity: 0.2, depthWrite: false });
    this.hotspot = new THREE.Mesh(new THREE.RingGeometry(0.08, 0.105, 24), hotspotMaterial);
    this.hotspot.name = `Interaction target ${definition.id}`;
    this.hotspot.userData.installationPoint = this;
    this.hotspot.position.z = 0.018;
    this.add(this.hotspot);
  }

  setStage(stage: InstallationStage): void {
    this.stage = stage;
    this.hotspot.visible = stage !== 'complete' && stage !== 'leveling';
  }

  createMortar(): THREE.Mesh {
    const padWidth = this.boxGroup.groupWidth + 0.19;
    const padHeight = this.boxGroup.groupHeight + 0.18;
    const shape = new THREE.Shape();
    shape.moveTo(-padWidth / 2, -padHeight / 2);
    shape.lineTo(padWidth / 2, -padHeight / 2);
    shape.lineTo(padWidth / 2, padHeight / 2);
    shape.lineTo(-padWidth / 2, padHeight / 2);
    shape.closePath();
    for (const box of this.boxGroup.boxes) {
      const clearance = 0.002;
      const hole = new THREE.Path();
      hole.moveTo(box.position.x - box.width / 2 + clearance, -box.height / 2 + clearance);
      hole.lineTo(box.position.x - box.width / 2 + clearance, box.height / 2 - clearance);
      hole.lineTo(box.position.x + box.width / 2 - clearance, box.height / 2 - clearance);
      hole.lineTo(box.position.x + box.width / 2 - clearance, -box.height / 2 + clearance);
      hole.closePath();
      shape.holes.push(hole);
    }
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.003, bevelSegments: 1 });
    const material = new THREE.MeshStandardMaterial({ color: 0x77736a, roughness: 1, metalness: 0 });
    const mortar = new THREE.Mesh(geometry, material);
    mortar.name = 'Continuous flush mortar bed';
    mortar.userData.studioEntityId = `point-${this.definition.id}:mortar`;
    mortar.position.z = -0.006;
    mortar.receiveShadow = true;
    this.mortar = mortar;
    this.add(mortar);
    return mortar;
  }
}
