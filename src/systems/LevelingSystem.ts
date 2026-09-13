import type { InstallationPoint } from '../electrical/InstallationPoint';
import type { BoxPlacementSystem } from './BoxPlacementSystem';

export type LevelDirection = 'left' | 'right' | 'in' | 'out';

export class LevelingSystem {
  placementSystem?:BoxPlacementSystem;
  begin(point: InstallationPoint): void {
    if(point.boxGroup.userData.placement&&!point.boxGroup.userData.placement.secured)return;
    point.boxGroup.levelBar.visible = true;
    point.boxGroup.updateBubble();
    point.setStage('leveling');
  }
  adjust(point: InstallationPoint, direction: LevelDirection): void {
    if (point.stage !== 'leveling') return;
    if(this.placementSystem&&!this.placementSystem.canAdjust(point))return;
    const previousPosition=point.boxGroup.position.clone(),previousTilt=point.boxGroup.rotation.z;
    if (direction === 'left') point.boxGroup.adjustTilt(-1);
    if (direction === 'right') point.boxGroup.adjustTilt(1);
    if (direction === 'in') point.boxGroup.adjustDepth(-1);
    if (direction === 'out') point.boxGroup.adjustDepth(1);
    this.placementSystem?.constrainAdjustment(point,previousPosition,previousTilt);
    point.boxGroup.updateBubble();
  }
  confirm(point: InstallationPoint): boolean {
    const placement=point.boxGroup.userData.placement;
    if(placement&&!placement.secured)return false;
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
