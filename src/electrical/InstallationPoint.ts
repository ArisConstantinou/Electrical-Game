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
    this.hotspot.visible = false;
  }

  placeAt(x: number, centreY: number): void {
    const halfWidth = this.boxGroup.groupWidth / 2 + 0.12;
    this.position.x = THREE.MathUtils.clamp(x, -GAME_CONFIG.room.width / 2 + halfWidth, GAME_CONFIG.room.width / 2 - halfWidth);
    this.position.y = THREE.MathUtils.clamp(centreY, this.boxGroup.groupHeight / 2 + 0.06, GAME_CONFIG.room.height - this.boxGroup.groupHeight / 2 - 0.08);
  }

  setStage(stage: InstallationStage): void {
    this.stage = stage;
    this.hotspot.visible = false;
  }

}
