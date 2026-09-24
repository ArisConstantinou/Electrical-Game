import * as THREE from 'three';
import type { InstallationPoint } from '../electrical/InstallationPoint';
import type { RigTool } from '../player/FPSRig';
import type { ChasingSystem } from './ChasingSystem';
import type { ConduitSystem } from './ConduitSystem';
import type { LevelingSystem } from './LevelingSystem';
import type { MortarSystem } from './MortarSystem';
import type { MarkingSystem } from './MarkingSystem';
import type { BoxPlacementSystem } from './BoxPlacementSystem';

export interface InteractionResult { success: boolean; message: string }
export type HammerMode = 'chase' | 'demolish';

export class InteractionSystem {
  placementSystem?:BoxPlacementSystem;
  hammerMode: HammerMode = 'chase';
  constructor(
    private readonly marking: MarkingSystem,
    private readonly chasing: ChasingSystem,
    private readonly leveling: LevelingSystem,
    private readonly mortar: MortarSystem,
    private readonly conduit: ConduitSystem,
  ) {}

  setSpray(mode: 'dots' | 'live', color: number): void {
    this.marking.mode = mode;
    this.marking.color = color;
  }
  endSprayStroke(): void { this.marking.endStroke(); }
  setHammerMode(mode: HammerMode): void { this.hammerMode = mode; }

  action(point: InstallationPoint, tool: RigTool, camera: THREE.Camera, continuing = false): InteractionResult {
    if(tool==='fitting'&&this.placementSystem)return this.placementSystem.place(point,camera);
    if(['spring','cutter'].includes(tool)&&point.boxGroup.userData.placement&&!point.boxGroup.userData.placement.secured)return{success:false,message:'The box is loose. Support and secure it with mortar before continuing.'};
    if (tool === 'spray') {
      const firstMark = point.stage === 'inspect';
      const painted = this.marking.spray(camera, point);
      return { success: painted, message: !painted ? 'Aim the spray at brick.' : firstMark ? `Point ${point.definition.id}: free mark started.` : '' };
    }
    if (tool === 'hammer') {
      if (this.hammerMode === 'chase') {
        const hit = this.chasing.hit(camera, point);
        return { success:hit, message: !hit ? 'Place the chisel against the masonry.' : point.stage === 'chased' ? 'Cavity clear. The back boxes fit.' : '' };
      }
      const impact = this.chasing.freeHit(camera, continuing);
      if (impact) {
        if (point.stage === 'inspect' && impact.points[0]) point.placeAt(impact.points[0].x, impact.points[0].y);
        point.chaseHits++;
        this.chasing.refreshProgress(point);
      }
      return {success:Boolean(impact), message: !impact ? 'Place the chisel against the masonry.' : point.stage === 'chased' ? 'Cavity clear. The back boxes fit.' : ''};
    }
    if (tool === 'fitting' && ['inspect', 'marked', 'chasing', 'chased'].includes(point.stage)) {
      if (!this.chasing.positionBoxAtAim(point, camera)) return {success:false,message:'Aim at the wall cavity where you want the box.'};
      if (!this.chasing.canFitBoxes(point)) return {success:false,message:`The box touches remaining masonry. This group needs about ${Math.round((point.boxGroup.groupWidth + .016) * 1000)} × 94 × 49 mm of clear cavity.`};
      point.boxGroup.visible = true;
      const direction = point.definition.id === 'B' ? -1 : 1;
      point.boxGroup.setInitialError(direction * (2.25 + point.definition.id.charCodeAt(0) % 2), direction * 0.006);
      point.setStage('fitted');
      return { success: true, message: 'Box group fitted into the recess with a small alignment error.' };
    }
    if (tool === 'fitting' && point.stage === 'fitted') {
      return { success: false, message: 'Mist the masonry with the hose (8), then cast mortar with the trowel (7). Fill all four sides.' };
    }
    if (tool === 'level' && point.stage !== 'leveling') {
      const begun=this.leveling.begin(point);
      return { success: begun, message: begun ? 'Level on selected box. Rotate left / right and adjust depth.' : 'Support the box in the chase before placing the level. A falling or floor box cannot be leveled.' };
    }
    if (tool === 'level' && point.stage === 'leveling') {
      if(point.boxGroup.isLevel&&point.boxGroup.isFlush&&!this.mortar.ready(point)){
        point.boxGroup.levelBar.visible=false;point.setStage('fitted');
        return {success:false,message:'Alignment is correct. Pack the remaining mortar gaps, then recheck the level.'};
      }
      const passed = this.leveling.confirm(point);
      return { success: passed, message: passed ? 'LEVEL and FLUSH passed.' : 'Not yet: bubble and depth must both be inside tolerance.' };
    }
    if ((tool === 'spring' || tool === 'cutter') && (point.stage === 'leveled' || point.stage === 'conduit')) {
      if (!this.mortar.ready(point)) {
        point.boxGroup.levelBar.visible = false;
        point.setStage('fitted');
        return {success:false,message:'Water or movement has opened the mortar bed. Repack and recheck the box first.'};
      }
      this.conduit.selectTool(tool);
      const result = this.conduit.action(point);
      return { success: result.changed, message: result.message };
    }
    const required: Record<string, string> = { inspect: 'HAMMER · SPRAY MARKS OPTIONAL', marked: 'HAMMER OR FIT A CLEARED CAVITY', chasing: 'HAMMER OR FIT A CLEARED CAVITY', chased: 'FITTING TOOL', fitted: 'HOSE / TROWEL', mortared: 'SPIRIT LEVEL', leveling: 'SPIRIT LEVEL', leveled: 'SPRING / CUTTER', conduit: 'SPRING / CUTTER', complete: 'NONE' };
    return { success: false, message: `Select ${required[point.stage]} for this step.` };
  }
}
