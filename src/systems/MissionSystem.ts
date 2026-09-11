import * as THREE from 'three';
import { GAME_CONFIG } from '../data/gameConfig';
import { INSTALLATION_POINTS, type InstallationStage } from '../data/installationRules';
import { InstallationPoint } from '../electrical/InstallationPoint';

const stageProgress: Record<InstallationStage, number> = {
  inspect: 0, marked: 1, chasing: 1.5, chased: 2, fitted: 3, mortared: 4, leveling: 4.5, leveled: 5, conduit: 5.5, complete: 7,
};

export class MissionSystem {
  readonly points = INSTALLATION_POINTS.map(definition => new InstallationPoint(definition));
  readonly root = new THREE.Group();

  constructor(scene: THREE.Scene) {
    this.root.name = 'Living room first-fix mission';
    this.root.userData.studioEntityId = 'mission:living-room-first-fix';
    this.points.forEach(point => this.root.add(point));
    scene.add(this.root);
  }

  get activePoint(): InstallationPoint | null { return this.points.find(point => point.stage !== 'complete') ?? null; }
  get complete(): boolean { return this.activePoint === null; }
  get progress(): number { return Math.round(this.points.reduce((sum, point) => sum + stageProgress[point.stage], 0) / (this.points.length * 7) * 100); }

  target(camera: THREE.Camera): InstallationPoint | null {
    const point = this.activePoint;
    if (!point) return null;
    const position = new THREE.Vector3();
    point.getWorldPosition(position);
    const toPoint = position.sub(camera.position);
    const distance = toPoint.length();
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    const dot = direction.dot(toPoint.normalize());
    return distance <= GAME_CONFIG.interaction.maxDistance && dot >= GAME_CONFIG.interaction.minAimDot ? point : null;
  }
}
