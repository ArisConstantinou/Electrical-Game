import * as THREE from 'three';
import { GAME_CONFIG } from '../data/gameConfig';
import { INSTALLATION_POINTS, type InstallationStage, type BoxKind } from '../data/installationRules';
import { InstallationPoint } from '../electrical/InstallationPoint';

const stageProgress: Record<InstallationStage, number> = {
  inspect: 0, marked: 1, chasing: 1.5, chased: 2, fitted: 3, mortared: 4, leveling: 4.5, leveled: 5, conduit: 5.5, complete: 7,
};

export class MissionSystem {
  readonly points = INSTALLATION_POINTS.map(definition => new InstallationPoint(definition));
  readonly root = new THREE.Group();
  boxPreset: '1G' | '2G' | '2G+1G' = '2G+1G';
  private selectedPoint: InstallationPoint | null = null;
  private nextBoxId = 1;

  constructor(scene: THREE.Scene) {
    this.root.name = 'Living room first-fix mission';
    this.root.userData.studioEntityId = 'mission:living-room-first-fix';
    this.points.forEach(point => this.root.add(point));
    scene.add(this.root);
  }

  private get requiredPoints(): InstallationPoint[] { return this.points.filter(point=>!point.definition.id.startsWith('extra-')||point.boxGroup.visible); }

  get activePoint(): InstallationPoint | null { return (this.selectedPoint?.stage!=='complete'?this.selectedPoint:null) ?? this.requiredPoints.find(point => point.stage !== 'complete') ?? null; }
  get complete(): boolean { return this.requiredPoints.every(point => point.stage === 'complete'); }
  get progress(): number { return Math.round(this.requiredPoints.reduce((sum, point) => sum + stageProgress[point.stage], 0) / (this.requiredPoints.length * 7) * 100); }

  select(point: InstallationPoint): void { this.selectedPoint = point; }

  /** Keep the shared points array alive for mortar, physics and Studio traversal. */
  placementCandidate(): InstallationPoint | null {
    if(this.points.filter(point=>point.boxGroup.visible).length>=24)return null;
    const boxes=this.boxPreset.split('+') as BoxKind[];
    const matches=(point:InstallationPoint)=>!point.boxGroup.visible&&point.definition.boxes.join('+')===this.boxPreset;
    const reusable=this.activePoint && matches(this.activePoint)?this.activePoint:this.points.find(matches);
    if(reusable)return reusable;
    const point=new InstallationPoint({id:`extra-${this.nextBoxId++}`,label:`Box ${this.nextBoxId-1} · ${this.boxPreset}`,kind:'socket',boxes,x:0,bottom:.3});
    this.points.push(point);this.root.add(point);
    return point;
  }

  target(camera: THREE.Camera): InstallationPoint | null {
    const point = this.activePoint;
    if (!point) return null;
    const position = new THREE.Vector3();
    (point.boxGroup.visible ? point.boxGroup : point).getWorldPosition(position);
    const toPoint = position.sub(camera.position);
    const distance = toPoint.length();
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    const dot = direction.dot(toPoint.normalize());
    return distance <= GAME_CONFIG.interaction.maxDistance && dot >= GAME_CONFIG.interaction.minAimDot ? point : null;
  }
}
