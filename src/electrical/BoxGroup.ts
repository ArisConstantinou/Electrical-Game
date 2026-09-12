import * as THREE from 'three';
import { buildToolModel } from '../player/ToolModels';
import { INSTALLATION_RULES, type BoxKind } from '../data/installationRules';
import { ElectricalBox } from './Box';

export class BoxGroup extends THREE.Group {
  readonly boxes: ElectricalBox[] = [];
  readonly groupWidth: number;
  readonly groupHeight = INSTALLATION_RULES.box.oneGang.height;
  readonly levelBar: THREE.Group;

  constructor(kinds: BoxKind[], stableId: string) {
    super();
    this.name = `Recessed box group ${kinds.join(' + ')}`;
    this.userData.studioEntityId = stableId;
    this.groupWidth = kinds.reduce((total, kind) => total + (kind === '1G' ? INSTALLATION_RULES.box.oneGang.width : INSTALLATION_RULES.box.twoGang.width), 0)
      + Math.max(0, kinds.length - 1) * INSTALLATION_RULES.box.groupGap;
    let cursor = -this.groupWidth / 2;
    kinds.forEach((kind, index) => {
      const box = new ElectricalBox(kind, `${stableId}:box-${index}`);
      box.position.x = cursor + box.width / 2;
      cursor += box.width + INSTALLATION_RULES.box.groupGap;
      this.boxes.push(box);
      this.add(box);
    });
    this.levelBar = this.buildLevelBar(stableId);
    this.levelBar.visible = false;
    this.add(this.levelBar);
  }

  setInitialError(tiltDegrees: number, depthMetres: number): void {
    this.rotation.z = THREE.MathUtils.degToRad(tiltDegrees);
    this.position.z = depthMetres;
  }

  adjustTilt(direction: -1 | 1): void {
    this.rotation.z += THREE.MathUtils.degToRad(INSTALLATION_RULES.leveling.tiltStepDegrees * direction);
  }

  adjustDepth(direction: -1 | 1): void {
    this.position.z += INSTALLATION_RULES.leveling.depthStepMetres * direction;
  }

  get tiltDegrees(): number { return THREE.MathUtils.radToDeg(this.rotation.z); }
  get depthError(): number { return this.position.z; }
  get isLevel(): boolean { return Math.abs(this.tiltDegrees) <= INSTALLATION_RULES.leveling.tiltToleranceDegrees; }
  get isFlush(): boolean { return Math.abs(this.depthError) <= INSTALLATION_RULES.leveling.depthToleranceMetres; }

  private buildLevelBar(stableId: string): THREE.Group {
    const bar = new THREE.Group();
    bar.name = 'Full-group spirit level';
    bar.userData.studioEntityId = `${stableId}:spirit-level`;
    bar.position.set(0, this.groupHeight / 2 + 0.055, 0.05);
    const model=buildToolModel('level');model.position.set(-.005,.02,.075);
    const bubble=model.getObjectByName('level-bubble');
    bar.userData.bubble=bubble;bar.add(model);
    return bar;
  }

  updateBubble(): void {
    const bubble = this.levelBar.userData.bubble as THREE.Mesh | undefined;
    if (bubble) bubble.position.x = THREE.MathUtils.clamp(-this.tiltDegrees * 0.008, -0.038, 0.038);
  }
}
