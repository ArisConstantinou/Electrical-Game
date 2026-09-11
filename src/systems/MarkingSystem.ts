import type { InstallationPoint } from '../electrical/InstallationPoint';
import type { BrickWall } from '../world/BrickWall';

export class MarkingSystem {
  constructor(private readonly wall: BrickWall) {}
  mark(point: InstallationPoint): void {
    this.wall.showMarks(point.definition.id);
    point.setStage('marked');
  }
}
