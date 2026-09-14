import type { InstallationPoint } from '../electrical/InstallationPoint';
import type { BoxPlacementSystem } from './BoxPlacementSystem';
import type { InstallationStage } from '../data/installationRules';

export type LevelDirection = 'left' | 'right' | 'in' | 'out';

export class LevelingSystem {
  placementSystem?:BoxPlacementSystem;
  private readonly previousStages=new WeakMap<InstallationPoint,InstallationStage>();
  begin(point: InstallationPoint): boolean {
    if(!point.boxGroup.visible)return false;
    const placement=point.boxGroup.userData.placement;
    if(placement&&placement.state!=='supported'&&placement.state!=='bonded')return false;
    if(this.placementSystem&&!this.placementSystem.canAdjust(point))return false;
    if(point.stage!=='leveling')this.previousStages.set(point,point.stage);
    point.boxGroup.levelBar.visible = true;
    point.boxGroup.updateBubble();
    point.setStage('leveling');
    return true;
  }
  adjust(point: InstallationPoint, direction: LevelDirection): boolean {
    if (point.stage !== 'leveling') return false;
    if(this.placementSystem&&!this.placementSystem.canAdjust(point))return false;
    const previousPosition=point.boxGroup.position.clone(),previousTilt=point.boxGroup.rotation.z;
    if (direction === 'left') point.boxGroup.adjustTilt(-1);
    if (direction === 'right') point.boxGroup.adjustTilt(1);
    if (direction === 'in') point.boxGroup.adjustDepth(-1);
    if (direction === 'out') point.boxGroup.adjustDepth(1);
    const accepted=this.placementSystem?.constrainAdjustment(point,previousPosition,previousTilt);
    point.boxGroup.updateBubble();
    return accepted!==false;
  }
  confirm(point: InstallationPoint): boolean {
    if(point.stage!=='leveling'||!point.boxGroup.visible)return false;
    const placement=point.boxGroup.userData.placement;
    if(placement&&!placement.secured)return false;
    if (!point.boxGroup.isLevel || !point.boxGroup.isFlush) return false;
    point.boxGroup.levelBar.visible = false;
    const previous=this.previousStages.get(point);
    this.previousStages.delete(point);
    point.setStage(previous==='conduit'||previous==='complete'?previous:'leveled');
    return true;
  }
  cancel(point: InstallationPoint): void {
    if (point.stage !== 'leveling') return;
    point.boxGroup.levelBar.visible = false;
    point.setStage(this.previousStages.get(point)??(point.boxGroup.userData.placement?.secured?'mortared':'fitted'));
    this.previousStages.delete(point);
  }
}
