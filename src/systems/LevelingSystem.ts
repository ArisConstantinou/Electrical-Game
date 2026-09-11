import type { InstallationPoint } from '../electrical/InstallationPoint';

export type LevelDirection = 'left' | 'right' | 'in' | 'out';

export class LevelingSystem {
  begin(point: InstallationPoint): void {
    point.boxGroup.levelBar.visible = true;
    point.boxGroup.updateBubble();
    point.setStage('leveling');
  }
  adjust(point: InstallationPoint, direction: LevelDirection): void {
    if (point.stage !== 'leveling') return;
    if (direction === 'left') point.boxGroup.adjustTilt(-1);
    if (direction === 'right') point.boxGroup.adjustTilt(1);
    if (direction === 'in') point.boxGroup.adjustDepth(-1);
    if (direction === 'out') point.boxGroup.adjustDepth(1);
    point.boxGroup.updateBubble();
  }
  confirm(point: InstallationPoint): boolean {
    if (!point.boxGroup.isLevel || !point.boxGroup.isFlush) return false;
    point.boxGroup.levelBar.visible = false;
    point.setStage('leveled');
    return true;
  }
  cancel(point: InstallationPoint): void {
    if (point.stage !== 'leveling') return;
    point.boxGroup.levelBar.visible = false;
    point.setStage('mortared');
  }
}
