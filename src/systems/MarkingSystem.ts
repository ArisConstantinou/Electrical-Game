import * as THREE from 'three';
import type { InstallationPoint } from '../electrical/InstallationPoint';
import type { BrickWall } from '../world/BrickWall';

export class MarkingSystem {
  constructor(private readonly wall: BrickWall) {}
  spray(camera: THREE.Camera, point: InstallationPoint): boolean {
    const hit = this.wall.spray(camera, point.definition.id);
    if (!hit) return false;
    if (point.stage === 'inspect') {
      point.placeAt(hit.x, hit.y);
      point.setStage('marked');
    }
    return true;
  }
}
